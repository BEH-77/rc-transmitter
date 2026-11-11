import { describe, expect, it } from 'vitest'
import { createSimulation, simulate } from '../lib/simulation'
describe('simulation safety state machine', () => {
  it('starts safe, requires enable and acknowledges actual values', () => {
    let model = createSimulation(0)
    expect(model.state).toBe('SAFE')
    let result = simulate(model, 'RC,1700,1500,1200,1500', 20)
    expect(result.responses).toEqual(['ERR,SAFE_REQUIRES_NEUTRAL'])
    result = simulate(model, 'RC,1500,1500,1000,1500', 40); model = result.model
    result = simulate(model, 'ENABLE', 50); model = result.model
    expect(model.state).toBe('ACTIVE')
    result = simulate(model, 'RC,1700,1500,1200,1500', 60)
    expect(result.responses).toEqual(['ACK,1700,1500,1200,1500'])
  })
  it('latches STOP and watchdog timeout until neutral RESET', () => {
    let model = simulate(createSimulation(0), 'RC,1500,1500,1000,1500', 5).model
    model = simulate(model, 'ENABLE', 10).model
    model = simulate(model, 'RC,1700,1500,1400,1500', 20).model
    let result = simulate(model, 'RC,1700,1500,1400,1500', 321)
    expect(result.model.state).toBe('FAILSAFE')
    expect(result.model.applied.throttle).toBe(1000)
    expect(result.responses).toContain('ERR,LATCHED')
    result = simulate(result.model, 'RESET,1500,1500,1200,1500', 330)
    expect(result.model.state).toBe('FAILSAFE')
    result = simulate(result.model, 'RESET,1500,1500,1000,1500', 340)
    expect(result.model.state).toBe('SAFE')
    expect(simulate(result.model, 'ENABLE', 345).responses).toEqual(['ERR,ENABLE_REQUIRES_FRESH_NEUTRAL'])
    result = simulate(result.model, 'STOP', 350)
    expect(result.model.state).toBe('STOPPED')
    expect(simulate(result.model, 'RC,1500,1500,1000,1500', 360).model.state).toBe('STOPPED')
  })
  it('rejects invalid pulse widths', () => expect(simulate(createSimulation(0), 'RC,999,1500,1000,1500', 10).responses).toEqual(['ERR,INVALID_RC']))
})
