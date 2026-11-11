import { clamp } from './protocol'

export const KNOB_SIZE = 52
export function axisFraction(value: number, reversed = false, vertical = false): number {
  const fraction = ((reversed ? 3000 - value : value) - 1000) / 1000
  return vertical ? 1 - fraction : fraction
}
export function axisPosition(value: number, reversed = false, vertical = false): string {
  const fraction = axisFraction(value, reversed, vertical)
  return `calc(${fraction * 100}% + ${KNOB_SIZE / 2 * (1 - 2 * fraction)}px)`
}

export type Axes = { horizontal: number; vertical: number }

// Both axes span 1000–2000 µs across the full handle travel. Starting from
// the grabbed handle position avoids a jump when the pointer lands off-center.
export function dragChannels(start: Axes, dx: number, dy: number, size: number, reverseHorizontal: boolean, reverseVertical: boolean): Axes {
  const travel = Math.max(1, size - KNOB_SIZE)
  return {
    horizontal: clamp(start.horizontal + (reverseHorizontal ? -1 : 1) * dx * 1000 / travel),
    vertical: clamp(start.vertical + (reverseVertical ? 1 : -1) * dy * 1000 / travel),
  }
}

export function releasedAxes(): Axes {
  return { horizontal: 1500, vertical: 1500 }
}
