import { describe, expect, it } from 'vitest'
import { applyReversal, CENTER, formatRC, isCentered, isNeutral, parseResponse, SAFE, validChannels } from '../lib/protocol'
import { dragChannels, releasedAxes } from '../lib/joystick'

describe('joystick', () => {
  it('maps right stick directions and diagonals from the grab point', () => {
    const center = { horizontal: 1500, vertical: 1500 }
    expect(dragChannels(center, 0, 0, 200, false, false)).toEqual(center)
    expect(dragChannels(center, 74, -74, 200, false, false)).toEqual({ horizontal: 2000, vertical: 2000 })
    expect(dragChannels(center, -74, 74, 200, false, false)).toEqual({ horizontal: 1000, vertical: 1000 })
    expect(dragChannels(center, 500, -500, 200, false, false)).toEqual({ horizontal: 2000, vertical: 2000 })
  })
  it('centers all requested axes on release', () => {
    expect(releasedAxes()).toEqual({ horizontal: 1500, vertical: 1500 })
  })
  it('maps the full left vertical travel proportionally around 1500', () => {
    const center = { horizontal: 1500, vertical: 1500 }
    expect(dragChannels(center, 0, 0, 200, false, false)).toEqual(center)
    expect(dragChannels(center, 0, -37, 200, false, false).vertical).toBe(1750)
    expect(dragChannels(center, 0, 37, 200, false, false).vertical).toBe(1250)
    expect(dragChannels(center, 74, -74, 200, false, false)).toEqual({ horizontal: 2000, vertical: 2000 })
    expect(dragChannels(center, -74, 74, 200, false, false)).toEqual({ horizontal: 1000, vertical: 1000 })
    expect(dragChannels(center, 0, 74, 200, false, true).vertical).toBe(2000)
  })
  it('reverses channels without altering others', () => {
    expect(applyReversal({ roll: 1200, pitch: 1600, throttle: 1300, yaw: 1400 }, { roll: true, pitch: false, throttle: false, yaw: true })).toEqual({ roll: 1800, pitch: 1600, throttle: 1300, yaw: 1600 })
  })
})
describe('serial protocol', () => {
  it('separates the centered request from minimum safe output', () => { expect(CENTER).toEqual({ roll: 1500, pitch: 1500, throttle: 1500, yaw: 1500 }); expect(isCentered(CENTER)).toBe(true); expect(SAFE).toEqual({ roll: 1500, pitch: 1500, throttle: 1000, yaw: 1500 }); expect(isNeutral(SAFE)).toBe(true); expect(isNeutral(CENTER)).toBe(false) })
  it('formats fixed order with newline', () => expect(formatRC({ roll: 1700, pitch: 1500, throttle: 1200, yaw: 1500 })).toBe('RC,1700,1500,1200,1500\n'))
  it('rejects invalid pulse widths', () => { expect(validChannels({ ...SAFE, roll: 999 })).toBe(false); expect(() => formatRC({ ...SAFE, pitch: 1500.5 })).toThrow() })
  it('parses acknowledgements and state/errors', () => {
    expect(parseResponse('ACK,1700,1500,1200,1500')).toEqual({ kind: 'ACK', values: { roll: 1700, pitch: 1500, throttle: 1200, yaw: 1500 } })
    expect(parseResponse('STATE,FAILSAFE')).toEqual({ kind: 'STATE', state: 'FAILSAFE' })
    expect(parseResponse('ERR,INVALID_RC')).toEqual({ kind: 'ERR', message: 'INVALID_RC' })
    expect(parseResponse('ACK,999,1500,1000,1500')).toBeNull()
  })
})
