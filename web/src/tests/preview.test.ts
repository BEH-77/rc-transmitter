import { expect, it } from 'vitest'
import { CENTER, SAFE, formatPreview, parseResponse } from '../lib/protocol'
import { createSimulation, simulate, tickSimulation } from '../lib/simulation'
it('formats and validates preview independently of applied ACKs', () => {
  expect(formatPreview({ roll: 1750, pitch: 1300, throttle: 1900, yaw: 1600 })).toBe('PREVIEW,1750,1300,1900,1600\n')
  expect(parseResponse('PREVIEW_ACK,1750,1300,1900,1600')).toEqual({ kind: 'PREVIEW_ACK', values: { roll: 1750, pitch: 1300, throttle: 1900, yaw: 1600 } })
  expect(parseResponse('PREVIEW_ACK,999,1300,1900,1600')).toBeNull()
  expect(() => formatPreview({ ...CENTER, yaw: NaN })).toThrow()
})
it('previews every channel in SAFE without applying or refreshing control watchdog', () => {
  for (const key of ['roll', 'pitch', 'throttle', 'yaw'] as const) {
    const values = { ...CENTER, [key]: 1750 }
    const model = createSimulation(0)
    const result = simulate(model, formatPreview(values), 200)
    expect(result.model).toEqual(model)
    expect(result.responses).toEqual([formatPreview(values).trim().replace('PREVIEW,', 'PREVIEW_ACK,')])
    expect(tickSimulation(result.model, 300).model.state).toBe('FAILSAFE')
  }
})
it('ticks watchdog without processing a command and preview cannot revive latched states', () => {
  let model = simulate(createSimulation(0), 'RC,1500,1500,1000,1500', 10).model
  model = simulate(model, 'ENABLE', 20).model
  const expired = tickSimulation(model, 310)
  expect(expired.responses).toEqual(['STATE,FAILSAFE', 'ACK,1500,1500,1000,1500'])
  for (const latched of [expired.model, simulate(model, 'STOP', 30).model]) {
    const preview = simulate(latched, formatPreview(CENTER), 320)
    expect(preview.model).toEqual(latched); expect(preview.model.applied).toEqual(SAFE)
    expect(preview.responses).toEqual(['PREVIEW_ACK,1500,1500,1500,1500'])
  }
})
it('preview does not replace ACTIVE output and rejects malformed commands', () => {
  let model = simulate(createSimulation(0), 'RC,1500,1500,1000,1500', 10).model
  model = simulate(model, 'ENABLE', 20).model
  model = simulate(model, 'RC,1700,1300,1800,1600', 30).model
  expect(simulate(model, formatPreview(CENTER), 40).model).toEqual(model)
  for (const command of ['PREVIEW,999,1500,1500,1500', 'PREVIEW,1500,1500,1500', 'PREVIEW,1500,1500,1500,1500,0', 'PREVIEW,1500,1500,1500,2001']) {
    const result = simulate(model, command, 40)
    expect(result.responses).toEqual(['ERR,INVALID_PREVIEW']); expect(result.model).toEqual(model)
  }
})
