import { expect, it } from 'vitest'
import { axisFraction, axisPosition, dragChannels, KNOB_SIZE } from '../lib/joystick'
it('maps intermediate pointer displacement to identical visual displacement for all axis directions and sizes', () => {
  for (const size of [176, 200, 230, 250]) for (const reversed of [false, true]) {
    for (const [dx, dy] of [[25,-30], [-25,30], [0,0]]) {
      const next = dragChannels({horizontal:1500,vertical:1500}, dx, dy, size, reversed, reversed)
      const x = KNOB_SIZE/2 + (size-KNOB_SIZE)*axisFraction(next.horizontal,reversed)
      const y = KNOB_SIZE/2 + (size-KNOB_SIZE)*axisFraction(next.vertical,reversed,true)
      expect(Math.abs(x-size/2-dx)).toBeLessThan(0.13)
      expect(Math.abs(y-size/2-dy)).toBeLessThan(0.13)
    }
    expect(axisPosition(1500,reversed)).toBe('calc(50% + 0px)')
  }
})
