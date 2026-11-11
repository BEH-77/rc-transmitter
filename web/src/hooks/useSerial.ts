import { useCallback, useEffect, useRef, useState } from 'react'
import { ENABLE, formatPreview, formatRC, parseRCCommand, parseResponse, RESET, sameChannels, SAFE, STOP, type Channels } from '../lib/protocol'
import { SerialWriter, bounded } from '../lib/serialWriter'
import { createLineReader } from '../lib/serialLines'
import { createSimulation, simulate, tickSimulation } from '../lib/simulation'

type SerialPort = { open(options: { baudRate: number }): Promise<void>; close(): Promise<void>; readable: ReadableStream<Uint8Array> | null; writable: WritableStream<Uint8Array> | null; addEventListener(type: 'disconnect', listener: () => void): void; removeEventListener(type: 'disconnect', listener: () => void): void }
type SerialAPI = { requestPort(): Promise<SerialPort> }
type Entry = { id: number; time: number; direction: 'TX' | 'RX' | 'SYS' | 'ERR'; text: string }
type Mode = 'hardware' | 'simulation'
const serialAPI = () => (navigator as Navigator & { serial?: SerialAPI }).serial

export function useSerial() {
  const [mode, setModeState] = useState<Mode>('hardware')
  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState('DISCONNECTED')
  const [deviceState, setDeviceState] = useState('UNKNOWN')
  const [ack, setAck] = useState<Channels | null>(null)
  const [ackAt, setAckAt] = useState<number | null>(null)
  const [lastCommand, setLastCommand] = useState('—')
  const [lastSentValues, setLastSentValues] = useState<Channels | null>(null)
  const [previewSent, setPreviewSent] = useState<Channels | null>(null)
  const [previewAck, setPreviewAck] = useState<Channels | null>(null)
  const [log, setLog] = useState<Entry[]>([])
  const port = useRef<SerialPort | null>(null)
  const writer = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null)
  const reader = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const transport = useRef<SerialWriter | null>(null)
  const mounted = useRef(true)
  const closing = useRef(false)
  const retiredPorts = useRef(new WeakSet<SerialPort>())
  const connecting = useRef(false)
  const disconnecting = useRef(false)
  const session = useRef(0)
  const modeRef = useRef<Mode>('hardware')
  const simState = useRef(createSimulation(Date.now()))
  const stopRequested = useRef(false)
  const logId = useRef(0)
  const logLine = useCallback((direction: Entry['direction'], text: string) => {
    const entry = { id: ++logId.current, time: Date.now(), direction, text }
    setLog(old => [...old.slice(-119), entry])
  }, [])

  const receive = useCallback((line: string, simulated = false) => {
    logLine('RX', simulated ? `${line} [SIMULATED]` : line)
    const result = parseResponse(line)
    if (!result) { logLine('ERR', `Unrecognized response: ${line}`); return }
    if (result.kind === 'PREVIEW_ACK') { setPreviewAck(result.values) }
    else if (result.kind === 'ACK') {
      if (stopRequested.current && !sameChannels(result.values, SAFE)) { logLine('SYS', 'Ignored pre-STOP ACK for older active output'); return }
      setAck(result.values); setAckAt(Date.now())
    }
    else if (result.kind === 'STATE') {
      setDeviceState(result.state)
      logLine('SYS', result.state === 'ACTIVE' ? 'Communication started: joystick output authorized' : `Safety state: ${result.state}; outputs restricted to safe values`)
      if (result.state === 'SAFE' || result.state === 'FAILSAFE' || result.state === 'STOPPED') { setAck(null); setAckAt(null) }
    }
    else if (result.kind === 'ERR') logLine('ERR', result.message)
  }, [logLine])

  const close = useCallback(async (reason = 'Disconnected') => {
    if (closing.current) return
    closing.current = true
    ++session.current
    const p = port.current; port.current = null
    setConnected(false); setStatus(/error|failed|timed out/i.test(reason) ? 'COMMUNICATION ERROR' : 'DISCONNECTED'); setDeviceState('UNKNOWN'); setAck(null); setAckAt(null); setLastSentValues(null); setPreviewSent(null); setPreviewAck(null); stopRequested.current = false; disconnecting.current = false
    transport.current?.close(); transport.current = null
    const r = reader.current; reader.current = null
    const w = writer.current; writer.current = null
    if (p) { retiredPorts.current.add(p); p.removeEventListener('disconnect', disconnectListener.current) }
    // Both operations start immediately. Keep the port quarantined if its driver
    // never settles; a late cleanup must never close a newly reopened session.
    const cleanup = (async () => {
      await Promise.allSettled([
        Promise.resolve().then(() => r?.cancel()),
        Promise.resolve().then(() => w?.abort('Transport closed')),
      ])
      try { r?.releaseLock() } catch { /* removed */ }
      try { w?.releaseLock() } catch { /* removed */ }
      if (p) {
        try { await p.close(); retiredPorts.current.delete(p) }
        catch { /* keep quarantined; USB reconnection may be needed */ }
      }
    })()
    await bounded(cleanup, 700)
    closing.current = false
    logLine('SYS', reason)
  }, [logLine])
  const closeRef = useRef(close)
  closeRef.current = close
  const disconnectListener = useRef(() => { void closeRef.current('USB device disconnected; Arduino watchdog must enter FAILSAFE') })

  const connect = useCallback(async () => {
    if (port.current || connecting.current || closing.current || modeRef.current !== 'hardware') return
    const api = serialAPI()
    if (!api) { setStatus('WEB SERIAL UNAVAILABLE'); logLine('ERR', 'Use Chromium on localhost or HTTPS'); return }
    setStatus('SELECTING PORT')
    connecting.current = true
    let selected: SerialPort | null = null
    const attempt = session.current
    let openedSession = 0
    try {
      selected = await api.requestPort()
      if (!mounted.current || attempt !== session.current) { connecting.current = false; return }
      if (retiredPorts.current.has(selected)) throw new Error('Previous USB operations are still pending; reconnect the USB device before selecting this port')
      await selected.open({ baudRate: 115200 })
      if (!mounted.current || attempt !== session.current) { connecting.current = false; await bounded(selected.close()); return }
      if (!selected.readable || !selected.writable) throw new Error('Port has no readable or writable stream')
      port.current = selected
      writer.current = selected.writable.getWriter()
      transport.current = new SerialWriter(writer.current, command => {
        const line = command.trim()
        const values = parseRCCommand(command)
        if (values) setLastSentValues(values)
        if (line.startsWith('PREVIEW,')) setPreviewSent(parseRCCommand(command.replace(/^PREVIEW,/, 'RC,')))
        setLastCommand(line); logLine('TX', line)
      }, error => {
        logLine('ERR', error instanceof Error ? error.message : String(error))
        void closeRef.current('Communication error — transport retired; RESET required after reconnect')
      })
      const mySession = ++session.current; openedSession = mySession
      selected.addEventListener('disconnect', disconnectListener.current)
      setConnected(true); setStatus('CONNECTED'); setDeviceState('UNKNOWN'); setAck(null); setAckAt(null); setLastSentValues(null); setPreviewSent(null); setPreviewAck(null); stopRequested.current = false
      connecting.current = false
      logLine('SYS', 'Port opened at 115200 baud; wait for firmware state, then RESET if needed')
      const read = selected.readable.getReader(); reader.current = read
      const decoder = new TextDecoder()
      const consume = createLineReader(line => receive(line), () => logLine('ERR', 'Receive line exceeded limit'))
      while (mySession === session.current) {
        const { value, done } = await read.read()
        if (done || mySession !== session.current || !mounted.current) break
        consume(decoder.decode(value, { stream: true }))
      }
      if (mySession === session.current) void closeRef.current('Serial stream ended unexpectedly')
    } catch (error) {
      connecting.current = false
      if (openedSession && openedSession !== session.current) return
      const msg = error instanceof Error ? error.message : String(error)
      if ((error as Error).name !== 'NotFoundError') logLine('ERR', msg)
      setStatus((error as Error).name === 'NotFoundError' ? 'DISCONNECTED' : 'COMMUNICATION ERROR')
      if (selected && !port.current && !retiredPorts.current.has(selected)) try { await bounded(selected.close()) } catch { /* no open port */ }
      if (port.current) void closeRef.current(`Serial error: ${msg}`)
    }
  }, [logLine, receive])

  const send = useCallback((command: string): Promise<void> => {
    const line = command.trim()
    if (line === 'STOP') { stopRequested.current = true; setAck(null); setAckAt(null) }
    if (line.startsWith('RESET,')) { stopRequested.current = false; setAck(null); setAckAt(null) }
    if (line.startsWith('RC,') && stopRequested.current) return Promise.resolve()
    if (modeRef.current === 'simulation') {
      setLastCommand(line); logLine('TX', `${line} [SIMULATED]`)
      const values = parseRCCommand(command)
      if (values) setLastSentValues(values)
      if (line.startsWith('PREVIEW,')) setPreviewSent(parseRCCommand(command.replace(/^PREVIEW,/, 'RC,')))
      const result = simulate(simState.current, line, Date.now())
      simState.current = result.model
      result.responses.forEach(response => receive(response, true))
      return Promise.resolve()
    }
    if (!port.current || !transport.current || closing.current) return Promise.resolve()
    if (disconnecting.current && line !== 'STOP') return Promise.resolve()
    return transport.current.send(command)
  }, [logLine, receive])

  const setMode = useCallback((next: Mode) => {
    if (port.current || connecting.current || closing.current) return
    modeRef.current = next; setModeState(next); simState.current = createSimulation(Date.now())
    setDeviceState(next === 'simulation' ? 'SAFE' : 'UNKNOWN'); setAck(null); setAckAt(null); setLastSentValues(null); setLastCommand('—'); setPreviewSent(null); setPreviewAck(null); stopRequested.current = false
    logLine('SYS', next === 'simulation' ? 'Simulation enabled — no hardware connected' : 'Hardware mode selected')
  }, [logLine])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; void closeRef.current('Page unmounted') }
  }, [])
  useEffect(() => {
    if (mode !== 'simulation') return
    const timer = window.setInterval(() => {
      const result = tickSimulation(simState.current, Date.now())
      simState.current = result.model
      result.responses.forEach(line => receive(line, true))
    }, 20)
    return () => window.clearInterval(timer)
  }, [mode, receive])
  const disconnect = async () => { disconnecting.current = true; if (port.current && writer.current) await send(STOP); await close('Disconnected by user; STOP requested before port close') }
  return { mode, setMode, connected, status, deviceState, ack, ackAt, ackMatchesLatest: !!ack && !!lastSentValues && sameChannels(ack, lastSentValues), lastCommand, lastSentValues, previewSent, previewAck, log, clearLog: () => setLog([]), connect, disconnect, send, sendPreview: (c: Channels) => send(formatPreview(c)), sendRC: (c: Channels) => send(formatRC(c)), stop: () => send(STOP), reset: () => send(RESET), enable: () => send(ENABLE) }
}
