import { isNeutral, SAFE, validChannels, type Channels } from './protocol'
export type SimState = 'SAFE' | 'ACTIVE' | 'FAILSAFE' | 'STOPPED'
export type Simulation = { state: SimState; applied: Channels; lastValidAt: number; neutralRcSeen: boolean }
export function createSimulation(now: number): Simulation { return { state: 'SAFE', applied: SAFE, lastValidAt: now, neutralRcSeen: false } }
function ack(c: Channels) { return `ACK,${c.roll},${c.pitch},${c.throttle},${c.yaw}` }
export function tickSimulation(model: Simulation, now: number): { model: Simulation; responses: string[] } {
  if ((model.state === 'SAFE' || model.state === 'ACTIVE') && now - model.lastValidAt >= 300) {
    return { model: { ...model, state: 'FAILSAFE', applied: SAFE, neutralRcSeen: false }, responses: ['STATE,FAILSAFE', ack(SAFE)] }
  }
  return { model, responses: [] }
}
export function simulate(model: Simulation, command: string, now: number): { model: Simulation; responses: string[] } {
  const tick = tickSimulation(model, now)
  let current = tick.model
  const responses = tick.responses
  const line = command.trim()
  if (line.startsWith('PREVIEW,')) {
    const parts = line.split(',')
    const values = { roll: Number(parts[1]), pitch: Number(parts[2]), throttle: Number(parts[3]), yaw: Number(parts[4]) }
    responses.push(parts.length === 5 && parts.slice(1).every(x => /^\d{4}$/.test(x)) && validChannels(values)
      ? `PREVIEW_ACK,${parts.slice(1).join(',')}` : 'ERR,INVALID_PREVIEW')
  }
  else if (line === 'STOP') { current = { ...current, state: 'STOPPED', applied: SAFE, neutralRcSeen: false }; responses.push('STATE,STOPPED', ack(SAFE)) }
  else if (line.startsWith('RESET,')) {
    if (line === 'RESET,1500,1500,1000,1500') { current = createSimulation(now); responses.push('STATE,SAFE', ack(SAFE)) }
    else responses.push('ERR,RESET_REQUIRES_NEUTRAL')
  } else if (line === 'ENABLE') {
    if (current.state === 'SAFE' && current.neutralRcSeen && isNeutral(current.applied) && now - current.lastValidAt < 300) { current = { ...current, state: 'ACTIVE' }; responses.push('STATE,ACTIVE') }
    else responses.push('ERR,ENABLE_REQUIRES_FRESH_NEUTRAL')
  } else if (line.startsWith('RC,')) {
    const parts = line.split(',')
    const values = { roll: Number(parts[1]), pitch: Number(parts[2]), throttle: Number(parts[3]), yaw: Number(parts[4]) }
    if (parts.length !== 5 || parts.slice(1).some(x => !/^\d{4}$/.test(x)) || !validChannels(values)) responses.push('ERR,INVALID_RC')
    else if (current.state === 'FAILSAFE' || current.state === 'STOPPED') responses.push('ERR,LATCHED')
    else if (current.state === 'SAFE' && !isNeutral(values)) responses.push('ERR,SAFE_REQUIRES_NEUTRAL')
    else { current = { ...current, applied: values, lastValidAt: now, neutralRcSeen: current.state === 'SAFE' || current.neutralRcSeen }; responses.push(ack(values)) }
  } else responses.push('ERR,UNKNOWN_COMMAND')
  return { model: current, responses }
}
