import assert from 'node:assert/strict'
import { browser, wait } from './browser_helpers.mjs'
const b=await browser()
const {command,evaluate,click,press,move,release,values,point}=b
try {
  await command('Page.reload',{ignoreCache:true});await wait(400)
  assert.deepEqual(await values(),[1500,1500,1500,1500])
  for(let cycle=0;cycle<8;cycle++) for(const index of [0,1]){
    const p=await press(index)
    assert.equal(await evaluate(`document.querySelectorAll('.stick-pad')[${index}].hasPointerCapture(1)`),true)
    await move(p,25,-30);await wait(40)
    const knob=await point(index)
    assert.ok(Math.abs(knob.x-p.x-25)<2,'intermediate horizontal knob displacement matches pointer')
    assert.ok(Math.abs(knob.y-p.y+30)<2,'intermediate vertical knob displacement matches pointer')
    const requested=await values()
    assert.ok(requested[index===0?3:0]>1500&&requested[index===0?2:1]>1500)
    await release(p,25,-30);await wait(40)
    assert.deepEqual(await values(),[1500,1500,1500,1500])
    const centered=await point(index)
    assert.ok(Math.abs(centered.x-p.x)<1&&Math.abs(centered.y-p.y)<1)
  }
  // All four endpoints, outside release, and rapid reversal remain usable.
  for(const index of [0,1]){
    const p=await press(index)
    await move(p,1000,-1000);await wait(30)
    const v=await values();assert.equal(v[index===0?3:0],2000);assert.equal(v[index===0?2:1],2000)
    await move(p,-1000,1000);await wait(30)
    const low=await values();assert.equal(low[index===0?3:0],1000);assert.equal(low[index===0?2:1],1000)
    await release(p,-1000,1000);await wait(30);assert.deepEqual(await values(),[1500,1500,1500,1500])
  }
  // Reset, stop, and cancellation invalidate the drag; subsequent drag still works.
  for(const action of ['reset','stop','cancel','blur']){
    const p=await press(0);await move(p,30,-30);await wait(30)
    if(action==='reset')await click('.reset-button')
    if(action==='stop')await click('.stop-button')
    if(action==='cancel')await evaluate("document.querySelector('.stick-pad').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))")
    if(action==='blur')await evaluate("window.dispatchEvent(new Event('blur'))")
    await wait(40);assert.deepEqual(await values(),[1500,1500,1500,1500])
    await release(p,30,-30);await click('.reset-button');await wait(30)
  }
  for(const checkbox of [0,1,2,3])await evaluate(`document.querySelectorAll('.reverse-options input')[${checkbox}].click()`)
  for(const index of [0,1]){
    const p=await press(index);await move(p,25,-30);await wait(30)
    const v=await values();assert.ok(v[index===0?3:0]<1500&&v[index===0?2:1]<1500)
    const knob=await point(index);assert.ok(Math.abs(knob.x-p.x-25)<2&&Math.abs(knob.y-p.y+30)<2)
    await release(p,25,-30);await wait(30)
  }
  for(const checkbox of [0,1,2,3])await evaluate(`document.querySelectorAll('.reverse-options input')[${checkbox}].click()`)
  await command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2})
  const left=await point(0),right=await point(1)
  await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...left,id:1},{...right,id:2}]})
  await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:left.x+25,y:left.y-30,id:1},{x:right.x-25,y:right.y+30,id:2}]})
  await wait(50);const multi=await values();assert.ok(multi[0]<1500&&multi[1]<1500&&multi[2]>1500&&multi[3]>1500)
  await command('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await wait(50)
  assert.deepEqual(await values(),[1500,1500,1500,1500])
  await command('Emulation.setTouchEmulationEnabled',{enabled:false})
  // Keyboard movement, release, and focus loss.
  await evaluate("document.querySelector('.stick-pad').focus()")
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp'})
  await wait(30);assert.ok((await values())[2]>1500)
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp'})
  await wait(30);assert.deepEqual(await values(),[1500,1500,1500,1500])
  await click('[aria-label="Pause autoscroll"]');await click('[aria-label="Resume autoscroll"]');await click('[aria-label="Clear serial log"]')
  for(const width of [1440,800,390]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false})
    await wait(30)
    assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),'page must fit viewport')
  }
  await command('Page.reload',{ignoreCache:true});await wait(350)
  assert.deepEqual(await values(),[1500,1500,1500,1500])
  console.log('Chromium joystick tests passed: geometry, endpoints, repeated capture/release, cancellation/reset/stop/blur, reversal, multitouch, keyboard, monitor controls, responsive layout, reload')
} finally {b.close()}
