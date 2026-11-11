import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, ArrowUpRight, Cpu, RadioTower, SlidersHorizontal } from 'lucide-react'
import { Joystick } from './components/Joystick'
import { ChannelMonitor } from './components/ChannelMonitor'
import { ConnectionPanel } from './components/ConnectionPanel'
import { SafetyControls } from './components/SafetyControls'
import { SerialMonitor } from './components/SerialMonitor'
import { useSerial } from './hooks/useSerial'
import { CENTER, isNeutral, KEYS, SAFE, type ChannelKey, type Channels } from './lib/protocol'

const defaults: Record<ChannelKey, boolean> = { roll: false, pitch: false, throttle: false, yaw: false }
export default function App() {
  const serial = useSerial()
  const [channels, setChannels] = useState<Channels>(CENTER)
  const [gestureEpoch, setGestureEpoch] = useState(0)
  const [reversed, setReversed] = useState(defaults)
  const [stopped, setStopped] = useState(false)
  const [pendingEnable, setPendingEnable] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [now, setNow] = useState(Date.now())
  const channelsRef = useRef(channels)
  const requestChannels = useCallback((next: Channels) => { channelsRef.current = next; setChannels(next) }, [])
  const unlockedRef = useRef(unlocked); unlockedRef.current = unlocked
  const stateRef = useRef(serial.deviceState); stateRef.current = serial.deviceState
  const serialRef = useRef(serial); serialRef.current = serial
  const stoppedRef = useRef(stopped); stoppedRef.current = stopped
  const available = serial.mode === 'simulation' || serial.connected
  const latched = stopped || serial.deviceState === 'STOPPED' || serial.deviceState === 'FAILSAFE'
  const ackAge = serial.ackAt ? Math.max(0, now - serial.ackAt) : null

  useEffect(() => {
    let previewTick = 0
    const timer = window.setInterval(() => {
      const link = serialRef.current
      if (!available) return
      const active = unlockedRef.current && stateRef.current === 'ACTIVE' && !stoppedRef.current
      if (active) link.sendRC(channelsRef.current)
      else {
        if (!stoppedRef.current && stateRef.current !== 'STOPPED' && stateRef.current !== 'FAILSAFE') link.sendRC(SAFE)
        // 25 Hz preview, coalesced by the writer; never substitutes for the RC heartbeat.
        if (++previewTick % 2 === 0) link.sendPreview(channelsRef.current)
      }
    }, 20)
    return () => window.clearInterval(timer)
  }, [available])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 100); return () => window.clearInterval(timer) }, [])
  useEffect(() => { if (pendingEnable && serial.deviceState === 'ACTIVE') {
    if (isNeutral(channelsRef.current)) { unlockedRef.current = true; setUnlocked(true) }
    else { stoppedRef.current = true; setStopped(true); serialRef.current.stop() }
    setPendingEnable(false)
  } }, [pendingEnable, serial.deviceState])
  useEffect(() => { if (!pendingEnable) return; const timer = window.setTimeout(() => { setPendingEnable(false); stoppedRef.current = true; unlockedRef.current = false; setStopped(true); setUnlocked(false); serialRef.current.stop() }, 1000); return () => window.clearTimeout(timer) }, [pendingEnable])
  useEffect(() => { if (!serial.connected && serial.mode === 'hardware') { setUnlocked(false); setPendingEnable(false); requestChannels(CENTER); setGestureEpoch(n => n + 1) } }, [serial.connected, serial.mode, requestChannels])
  useEffect(() => {
    if (serial.deviceState !== 'ACTIVE') setUnlocked(false)
    if (serial.deviceState === 'FAILSAFE' || serial.deviceState === 'STOPPED') { setPendingEnable(false); requestChannels(CENTER); setGestureEpoch(n => n + 1) }
    if (serial.deviceState === 'SAFE') { requestChannels(CENTER); setGestureEpoch(n => n + 1) }
  }, [serial.deviceState, requestChannels])
  useEffect(() => {
    if (serial.connected && unlocked && ackAge !== null && ackAge > 500 && !stopped) {
      setStopped(true); setUnlocked(false); setPendingEnable(false); requestChannels(CENTER); setGestureEpoch(n => n + 1)
      serialRef.current.stop()
    }
  }, [serial.connected, unlocked, ackAge, stopped, requestChannels])

  function changeChannels(update: Partial<Channels>) {
    requestChannels({ ...channelsRef.current, ...update })
  }
  function emergencyStop() {
    stoppedRef.current = true; unlockedRef.current = false
    setStopped(true); setUnlocked(false); setPendingEnable(false); requestChannels(CENTER); setGestureEpoch(n => n + 1)
    serial.stop()
  }
  function reset() {
    unlockedRef.current = false; stoppedRef.current = false
    requestChannels(CENTER); setGestureEpoch(n => n + 1); setUnlocked(false); setPendingEnable(false); setStopped(false)
    if (available) serial.reset()
  }
  function toggleReverse(key: ChannelKey) {
    if (pendingEnable || unlocked || serial.deviceState === 'ACTIVE') return
    setReversed(old => ({ ...old, [key]: !old[key] }))
    requestChannels(CENTER); setGestureEpoch(n => n + 1)
  }
  const canEnable = available && serial.deviceState === 'SAFE' && !latched && !unlocked && !pendingEnable && isNeutral(channels) && !!serial.ack && isNeutral(serial.ack) && ackAge !== null && ackAge < 300
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark"><RadioTower size={22}/></div><div><span className="brand-name">VECTOR<span className="brand-slash">/</span>RC</span><span className="brand-sub">TRANSMITTER SYSTEM</span></div></div><div className="topbar-right"><span className="topbar-version">ARDUINO / KK V5.5</span><div className={`topbar-status ${serial.mode === 'simulation' ? 'sim' : serial.connected ? 'on' : ''}`}><span className="pulse-dot"/>{serial.mode === 'simulation' ? 'SIMULATION' : serial.connected ? 'USB CONNECTED' : 'USB OFFLINE'}</div></div></header>
    <main><div className="hero"><div><span className="eyebrow hero-eyebrow"><Activity size={14}/> CONTROL SURFACE / MODE 2</span><h1>Command center<span className="heading-period">.</span></h1><p>Four channel receiver signal control with independent Arduino failsafe protection.</p></div><div className="hero-right"><div className="hero-stat"><span>OUTPUT RATE</span><strong>50 <small>Hz</small></strong></div><div className="hero-stat"><span>WATCHDOG</span><strong>300 <small>ms</small></strong></div></div></div>
    <div className="alert-strip"><ShieldBadge/><div><strong>PROPELLERS OFF FOR SETUP</strong><span>Verify signals and flight controller behavior before connecting motors or propellers. The Arduino and KK V5.5 need a common ground.</span></div><ArrowUpRight size={17}/></div>
    <div className="dashboard-grid"><div className="main-column"><div className="section-heading"><div><span className="eyebrow">01 — INPUT CONTROL</span><h2>Virtual transmitter</h2></div><span className="subtle-label">{unlocked ? 'ACTIVE CONTROL' : 'LIVE PREVIEW · OUTPUT LOCKED'}</span></div><div className="joysticks"><Joystick side="left" horizontal={channels.yaw} vertical={channels.throttle} horizontalLabel="RUD / YAW" verticalLabel="THR" throttleAxis onRelease={() => { if (unlockedRef.current || pendingEnable) emergencyStop() }} cancelEpoch={gestureEpoch} reverseHorizontal={reversed.yaw} reverseVertical={reversed.throttle} disabled={false} onChange={(yaw, throttle) => changeChannels({ yaw, throttle })}/><Joystick side="right" horizontal={channels.roll} vertical={channels.pitch} horizontalLabel="AIL / ROLL" verticalLabel="ELE" cancelEpoch={gestureEpoch} reverseHorizontal={reversed.roll} reverseVertical={reversed.pitch} disabled={false} onChange={(roll, pitch) => changeChannels({ roll, pitch })}/></div>
    <div className="settings-row"><div className="settings-title"><SlidersHorizontal size={16}/><span>CHANNEL REVERSAL</span></div><div className="reverse-options">{KEYS.map(key => <label key={key} title={unlocked || serial.deviceState === 'ACTIVE' ? 'Reset to SAFE before changing reversal' : `Reverse ${key}`}><input type="checkbox" checked={reversed[key]} disabled={pendingEnable || unlocked || serial.deviceState === 'ACTIVE'} onChange={() => toggleReverse(key)}/><span className="switch"/>{key.toUpperCase()}</label>)}</div></div>
    <ChannelMonitor requested={channels} acknowledged={serial.ack} simulated={serial.mode === 'simulation'} outputActive={unlocked && serial.deviceState === 'ACTIVE'} connected={available}/><SerialMonitor entries={serial.log} clear={serial.clearLog} lastCommand={serial.lastCommand} previewSent={serial.previewSent} previewAck={serial.previewAck} controlSent={serial.lastSentValues} applied={serial.ack} firmwareState={serial.deviceState} communicationStatus={serial.status} requested={channels} limited={available && !(unlocked && serial.deviceState === 'ACTIVE')} simulated={serial.mode === 'simulation'}/></div>
    <aside className="side-column"><ConnectionPanel mode={serial.mode} setMode={serial.setMode} connected={serial.connected} status={serial.status} deviceState={serial.deviceState} ack={serial.ack} ackAge={ackAge} ackMatchesLatest={serial.ackMatchesLatest} connect={() => void serial.connect()} disconnect={() => void serial.disconnect()}/><SafetyControls connected={serial.connected} simulated={serial.mode === 'simulation'} state={serial.deviceState} unlocked={unlocked} stopped={stopped} canEnable={canEnable} reason={!available ? 'Disconnected' : latched ? `${serial.deviceState} — Reset required; preview remains available` : pendingEnable ? 'Enable pending — keep throttle at minimum' : unlocked ? 'ACTIVE — releasing left stick requests STOP' : serial.deviceState === 'UNKNOWN' ? 'Waiting for Arduino' : serial.deviceState !== 'SAFE' ? 'Reset required before enabling' : !isNeutral(channels) ? 'Hold throttle at 1000 µs and other channels at 1500 µs to enable. Release left stick locks output.' : !serial.ack || !isNeutral(serial.ack) || ackAge === null || ackAge >= 300 ? 'Waiting for fresh safe Arduino ACK' : 'Connected — SAFE. Hold minimum throttle and explicitly Enable.'} onEnable={() => { setPendingEnable(true); serial.enable() }} onReset={reset} onStop={emergencyStop}/><div className="info-card"><Cpu size={18}/><div><strong>Before first flight</strong><p>Arduino ACK reports pulses it applied. It cannot verify what the flight controller decoded or whether the controller is armed.</p></div></div></aside></div>
    </main><footer><span>VECTOR / RC · LOCAL CONTROL INTERFACE</span><span>USB SERIAL → ARDUINO → KK V5.5</span></footer>
  </div>
}
function ShieldBadge() { return <div className="alert-icon">!</div> }
