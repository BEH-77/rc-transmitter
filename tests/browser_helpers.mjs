import assert from 'node:assert/strict'
export const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
export async function browser() {
  const pages = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT ?? 9224}/json`)).json()
  const page = pages.find(item => item.type === 'page' && item.url.startsWith('http://127.0.0.1:4182/'))
  assert.ok(page, 'Start Vite on 4182 and Chromium CDP on 9224')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
  let next = 0; const pending = new Map()
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data); const promise = pending.get(message.id)
    if (!promise) return
    pending.delete(message.id)
    message.error ? promise.reject(new Error(message.error.message)) : promise.resolve(message.result)
  })
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`)
  const point = index => evaluate(`(() => { const r=document.querySelectorAll('.pad-dot')[${index}].getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
  const press = async index => {
    const p = await point(index)
    await command('Input.dispatchMouseEvent', { type:'mousePressed', ...p, button:'left', clickCount:1 })
    return p
  }
  const move = (p, dx, dy) => command('Input.dispatchMouseEvent', { type:'mouseMoved', x:p.x+dx, y:p.y+dy, buttons:1, button:'left' })
  const release = (p, dx=0, dy=0) => command('Input.dispatchMouseEvent', { type:'mouseReleased', x:p.x+dx,y:p.y+dy,button:'left',clickCount:1 })
  const values = () => evaluate(`Array.from(document.querySelectorAll('.channel-values b'), el=>Number(el.textContent))`)
  await command('Emulation.setDeviceMetricsOverride', { width:1440,height:1200,deviceScaleFactor:1,mobile:false })
  return { command,evaluate,click,text,point,press,move,release,values,close:()=>ws.close() }
}

// Executed inside Chromium. This is a USB mock, never a physical-device test.
export function installSerialMock() {
  const encoder = new TextEncoder(), decoder = new TextDecoder()
  const state = { raw:[], applied:[1500,1500,1000,1500], preview:null, mode:'SAFE', baud:0, opens:0, closes:0, active:0, maximum:0, delay:0, rejectNext:false, failOpen:false, fresh:Date.now(), neutral:false }
  let controller, releaseWrite
  const emit = line => { try { controller?.enqueue(encoder.encode(line+'\n')) } catch { /* closed */ } }
  const ack = () => emit('ACK,'+state.applied.join(','))
  const safe = () => { state.applied=[1500,1500,1000,1500]; state.neutral=false }
  class Port extends EventTarget {
    async open(options) {
      if (state.failOpen) { state.failOpen=false; throw new Error('Mock open failure') }
      state.opens++; state.baud=options.baudRate
      this.readable = new ReadableStream({start(c){controller=c;emit('STATE,'+state.mode)}})
      this.writable = new WritableStream({ async write(bytes) {
        state.active++; state.maximum=Math.max(state.maximum,state.active)
        try {
          if(state.rejectNext) { state.rejectNext=false; throw new Error('Mock rejected write') }
          if(state.delay === -1) await new Promise(resolve=>{releaseWrite=resolve})
          else if(state.delay) await new Promise(resolve=>setTimeout(resolve,state.delay))
          const raw=decoder.decode(bytes), line=raw.trim(); state.raw.push(raw)
          if(line.startsWith('PREVIEW,')){state.preview=line.split(',').slice(1).map(Number);emit('PREVIEW_ACK,'+state.preview.join(','));return}
          if(line==='STOP'){safe();state.mode='STOPPED';emit('STATE,STOPPED');ack();return}
          if(line.startsWith('RESET,')){safe();state.mode='SAFE';state.fresh=Date.now();emit('STATE,SAFE');ack();return}
          if(line==='ENABLE'){if(state.mode==='SAFE'&&state.neutral&&Date.now()-state.fresh<300){state.mode='ACTIVE';emit('STATE,ACTIVE')}else emit('ERR,ENABLE_REQUIRES_FRESH_NEUTRAL');return}
          if(line.startsWith('RC,')){
            const values=line.split(',').slice(1).map(Number)
            if(state.mode==='STOPPED'||state.mode==='FAILSAFE'){emit('ERR,LATCHED');return}
            if(state.mode==='SAFE'&&values.join(',')!=='1500,1500,1000,1500'){emit('ERR,SAFE_REQUIRES_NEUTRAL');return}
            state.applied=values;state.fresh=Date.now();state.neutral=true;ack()
          }
        } finally {state.active--}
      }})
    }
    async close(){state.closes++;controller=null}
  }
  const port=new Port()
  Object.defineProperty(navigator,'serial',{configurable:true,value:{requestPort:async()=>port}})
  const timer=setInterval(()=>{if((state.mode==='SAFE'||state.mode==='ACTIVE')&&Date.now()-state.fresh>=300){safe();state.mode='FAILSAFE';emit('STATE,FAILSAFE');ack()}},10)
  window.__serialMock={state,emit,release(){releaseWrite?.()},usbLoss(){port.dispatchEvent(new Event('disconnect'))},reboot(){safe();state.mode='SAFE';state.fresh=Date.now();emit('STATE,SAFE');ack()},dispose(){clearInterval(timer)}}
}
