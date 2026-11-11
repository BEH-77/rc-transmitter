import { afterEach, expect, it, vi } from 'vitest'
import { SerialWriter, bounded } from '../lib/serialWriter'
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
afterEach(() => vi.useRealTimers())
it('writes exact bytes, serializes, coalesces latest RC and preview, and prioritizes STOP', async () => {
  const bytes: string[] = []; const sent: string[] = []; const releases: (() => void)[] = []
  let active = 0, maximum = 0
  const transport = new SerialWriter({ write: async value => {
    active++; maximum = Math.max(maximum, active)
    bytes.push(new TextDecoder().decode(value))
    await new Promise<void>(resolve => releases.push(resolve)); active--
  } }, line => sent.push(line), error => { throw error })
  const initial = transport.send('RC,1500,1500,1000,1500\n')
  void transport.send('RC,1600,1500,1000,1500\n')
  void transport.send('RC,1750,1500,1000,1500\n')
  void transport.send('PREVIEW,1600,1300,1900,1600\n')
  void transport.send('PREVIEW,1750,1300,1900,1600\n')
  expect(sent).toEqual([])
  releases.shift()!(); await initial; await flush()
  expect(bytes[1]).toBe('PREVIEW,1750,1300,1900,1600\n')
  const stop = transport.send('STOP\n')
  void transport.send('RC,2000,2000,2000,2000\n')
  releases.shift()!(); await flush()
  expect(bytes[2]).toBe('STOP\n')
  releases.shift()!(); await stop; await flush()
  expect(bytes).toHaveLength(3); expect(maximum).toBe(1)
  expect(sent).toEqual(bytes)
})
it('sends latest channels after delayed writes without retaining intermediate frames', async () => {
  const calls: string[] = []; let release!: () => void
  const transport = new SerialWriter({ write: async bytes => {
    calls.push(new TextDecoder().decode(bytes))
    if (calls.length === 1) await new Promise<void>(resolve => { release = resolve })
  } }, () => {}, () => {})
  const first = transport.send('RC,1500,1500,1000,1500\n')
  for (let value = 1501; value <= 1750; value++) void transport.send(`RC,${value},1300,1900,1600\n`)
  release(); await first; await flush()
  expect(calls).toEqual(['RC,1500,1500,1000,1500\n', 'RC,1750,1300,1900,1600\n'])
})
it('retires stalled transports without overlapping or claiming late successful writes', async () => {
  vi.useFakeTimers()
  let resolve!: () => void
  const write = vi.fn(() => new Promise<void>(done => { resolve = done }))
  const sent = vi.fn(), failed = vi.fn()
  const transport = new SerialWriter({ write }, sent, failed, 50)
  const pending = transport.send('RC,1500,1500,1000,1500\n')
  const stop = transport.send('STOP\n')
  await vi.advanceTimersByTimeAsync(51); await pending; await stop
  expect(failed).toHaveBeenCalledOnce(); expect(sent).not.toHaveBeenCalled()
  resolve(); await flush(); await transport.send('RESET,1500,1500,1000,1500\n')
  expect(write).toHaveBeenCalledOnce(); expect(sent).not.toHaveBeenCalled()
})
it('does not report rejected writes as TX and discards queued work', async () => {
  const sent = vi.fn(), failed = vi.fn()
  const transport = new SerialWriter({ write: async () => { throw new Error('USB lost') } }, sent, failed)
  await transport.send('PREVIEW,1750,1300,1900,1600\n')
  expect(sent).not.toHaveBeenCalled(); expect(failed).toHaveBeenCalledOnce()
})
it('closes pending telemetry and bounds cleanup without claiming cancellation', async () => {
  vi.useFakeTimers()
  let release!: () => void
  const sent = vi.fn()
  const transport = new SerialWriter({ write: () => new Promise<void>(r => { release = r }) }, sent, () => {})
  const first = transport.send('RC,1500,1500,1000,1500\n')
  const queued = transport.send('PREVIEW,1750,1300,1900,1600\n')
  transport.close(); await queued; release(); await first
  expect(sent).not.toHaveBeenCalled()
  const cleanup = bounded(new Promise(() => {}), 50)
  await vi.advanceTimersByTimeAsync(51); await cleanup
})
it('retains STOP priority even if explicit RESET follows before the current write settles', async () => {
  let release!: () => void; const calls: string[] = []
  const transport = new SerialWriter({write: async bytes => {
    calls.push(new TextDecoder().decode(bytes))
    if(calls.length===1) await new Promise<void>(resolve=>{release=resolve})
  }},()=>{},()=>{})
  const first=transport.send('RC,1700,1300,1900,1600\n')
  void transport.send('PREVIEW,2000,2000,2000,2000\n')
  void transport.send('STOP\n')
  void transport.send('RESET,1500,1500,1000,1500\n')
  release();await first;await flush()
  expect(calls).toEqual(['RC,1700,1300,1900,1600\n','STOP\n','RESET,1500,1500,1000,1500\n'])
})
it('uses real WritableStream writer bytes with simulated receiver preview/control ACK separation', async () => {
  const {createSimulation,simulate}=await import('../lib/simulation')
  const {formatPreview,formatRC,SAFE}=await import('../lib/protocol')
  let model=createSimulation(0); const responses:string[]=[]; const raw:string[]=[]
  let now=0
  const writer=new WritableStream<Uint8Array>({write(bytes){
    const command=new TextDecoder().decode(bytes);raw.push(command)
    const result=simulate(model,command,++now);model=result.model;responses.push(...result.responses)
  }}).getWriter()
  const sent:string[]=[]
  const transport=new SerialWriter(writer,command=>sent.push(command),error=>{throw error})
  const requested={roll:1750,pitch:1300,throttle:1900,yaw:1600}
  await transport.send(formatPreview(requested))
  expect(model.applied).toEqual(SAFE)
  await transport.send(formatRC(SAFE));await transport.send('ENABLE\n');await transport.send(formatRC(requested))
  expect(model.applied).toEqual(requested)
  expect(responses).toEqual(['PREVIEW_ACK,1750,1300,1900,1600','ACK,1500,1500,1000,1500','STATE,ACTIVE','ACK,1750,1300,1900,1600'])
  expect(raw).toEqual(sent);expect(raw[0]).toBe('PREVIEW,1750,1300,1900,1600\n')
  transport.close();writer.releaseLock()
})
