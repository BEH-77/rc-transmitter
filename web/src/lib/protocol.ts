export type Channels = { roll: number; pitch: number; throttle: number; yaw: number }
export type ChannelKey = keyof Channels
export const SAFE: Channels = { roll: 1500, pitch: 1500, throttle: 1000, yaw: 1500 }
export const CENTER: Channels = { roll: 1500, pitch: 1500, throttle: 1500, yaw: 1500 }
export const KEYS: ChannelKey[] = ['roll', 'pitch', 'throttle', 'yaw']
export const RESET = 'RESET,1500,1500,1000,1500\n'
export const STOP = 'STOP\n'
export const ENABLE = 'ENABLE\n'

export function validChannels(c: Channels): boolean {
  return KEYS.every(k => Number.isInteger(c[k]) && c[k] >= 1000 && c[k] <= 2000)
}
export function formatRC(c: Channels): string {
  if (!validChannels(c)) throw new Error('Channel values must be integer pulse widths from 1000 to 2000 µs')
  return `RC,${c.roll},${c.pitch},${c.throttle},${c.yaw}\n`
}
export function formatPreview(c: Channels): string {
  return formatRC(c).replace(/^RC,/, 'PREVIEW,')
}
export function isNeutral(c: Channels): boolean { return KEYS.every(k => c[k] === SAFE[k]) }
export function isCentered(c: Channels): boolean { return KEYS.every(k => c[k] === CENTER[k]) }
export function sameChannels(a: Channels, b: Channels): boolean { return KEYS.every(k => a[k] === b[k]) }
export function parseRCCommand(command: string): Channels | null {
  const match = /^RC,(\d{4}),(\d{4}),(\d{4}),(\d{4})\n$/.exec(command)
  if (!match) return null
  const values = { roll: +match[1], pitch: +match[2], throttle: +match[3], yaw: +match[4] }
  return validChannels(values) ? values : null
}
export function parseResponse(line: string): { kind: 'ACK' | 'PREVIEW_ACK'; values: Channels } | { kind: 'STATE'; state: string } | { kind: 'ERR'; message: string } | null {
  const parts = line.trim().split(',')
  if ((parts[0] === 'ACK' || parts[0] === 'PREVIEW_ACK') && parts.length === 5 && parts.slice(1).every(x => /^\d{4}$/.test(x))) {
    const values = { roll: +parts[1], pitch: +parts[2], throttle: +parts[3], yaw: +parts[4] }
    return validChannels(values) ? { kind: parts[0] as 'ACK' | 'PREVIEW_ACK', values } : null
  }
  if (parts[0] === 'STATE' && parts.length === 2 && ['SAFE', 'ACTIVE', 'FAILSAFE', 'STOPPED'].includes(parts[1])) return { kind: 'STATE', state: parts[1] }
  if (parts[0] === 'ERR' && parts.length >= 2) return { kind: 'ERR', message: parts.slice(1).join(',') }
  return null
}
export function applyReversal(c: Channels, reversed: Record<ChannelKey, boolean>): Channels {
  return { roll: reversed.roll ? 3000 - c.roll : c.roll, pitch: reversed.pitch ? 3000 - c.pitch : c.pitch, throttle: reversed.throttle ? 3000 - c.throttle : c.throttle, yaw: reversed.yaw ? 3000 - c.yaw : c.yaw }
}
export function clamp(v: number): number { return Math.max(1000, Math.min(2000, Math.round(v))) }
