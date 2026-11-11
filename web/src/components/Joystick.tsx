import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { axisPosition, dragChannels, releasedAxes } from '../lib/joystick'

type Props = {
  side: 'left' | 'right'; horizontal: number; vertical: number
  horizontalLabel: string; verticalLabel: string; throttleAxis?: boolean
  reverseHorizontal: boolean; reverseVertical: boolean; disabled: boolean
  cancelEpoch: number; onRelease?: () => void; onChange: (horizontal: number, vertical: number) => void
}
type Drag = { id: number; x: number; y: number; horizontal: number; vertical: number }

export function Joystick({ side, horizontal, vertical, horizontalLabel, verticalLabel, throttleAxis = false, reverseHorizontal, reverseVertical, disabled, cancelEpoch, onRelease, onChange }: Props) {
  const pad = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const expectedCaptureLoss = useRef(new Map<number, number>())
  const latest = useRef({ horizontal, vertical })
  const propsAxes = useRef({ horizontal, vertical })
  propsAxes.current = { horizontal, vertical }
  const releaseRef = useRef(onRelease); releaseRef.current = onRelease
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  if (!drag.current) latest.current = { horizontal, vertical }

  const finish = useCallback((id: number | null, emit: boolean) => {
    const session = drag.current
    if (!session || (id !== null && session.id !== id)) return
    drag.current = null
    try {
      if (pad.current?.hasPointerCapture(session.id)) {
        // lostpointercapture may arrive after a new press reuses the mouse pointer ID.
        // Record our own release before calling it so that event cannot end the new drag.
        expectedCaptureLoss.current.set(session.id, (expectedCaptureLoss.current.get(session.id) ?? 0) + 1)
        pad.current.releasePointerCapture(session.id)
      }
    } catch { /* capture already gone */ }
    if (!emit) return
    releaseRef.current?.()
    const next = releasedAxes()
    latest.current = next
    onChangeRef.current(next.horizontal, next.vertical)
  }, [])

  // A reset or safety lock invalidates the gesture before the next pointer event.
  useLayoutEffect(() => { finish(null, false); latest.current = propsAxes.current }, [cancelEpoch, disabled, finish])
  useEffect(() => {
    const onBlur = () => finish(null, true)
    const onVisibility = () => { if (document.hidden) finish(null, true) }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { window.removeEventListener('blur', onBlur); document.removeEventListener('visibilitychange', onVisibility); finish(null, false) }
  }, [finish])

  function start(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled || drag.current || !pad.current) return
    const knob = pad.current.querySelector('.pad-dot')?.getBoundingClientRect()
    if (!knob || Math.hypot(event.clientX - knob.x - knob.width / 2, event.clientY - knob.y - knob.height / 2) > 40) return
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, ...latest.current }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { drag.current = null }
  }
  function move(event: React.PointerEvent<HTMLDivElement>) {
    const session = drag.current
    if (disabled || !session || session.id !== event.pointerId || !pad.current) return
    const next = dragChannels(session, event.clientX - session.x, event.clientY - session.y, pad.current.clientWidth, reverseHorizontal, reverseVertical)
    if (next.horizontal === latest.current.horizontal && next.vertical === latest.current.vertical) return
    latest.current = next
    onChangeRef.current(next.horizontal, next.vertical)
  }

  const x = axisPosition(horizontal, reverseHorizontal)
  const y = axisPosition(vertical, reverseVertical, true)

  return <div className={`stick-card ${disabled ? 'stick-disabled' : ''}`}>
    <div className="stick-heading"><div><span className="eyebrow">{side === 'left' ? '01 / LEFT GIMBAL' : '02 / RIGHT GIMBAL'}</span><h3>{side === 'left' ? 'Throttle & Yaw' : 'Pitch & Roll'}</h3></div><span className="mode-tag">MODE 2</span></div>
    <div className="stick-row"><div className="axis-vertical"><span>{verticalLabel}</span><span className="axis-number">{vertical}</span></div>
      <div ref={pad} role="slider" aria-label={`${verticalLabel} and ${horizontalLabel} joystick`} aria-valuemin={1000} aria-valuemax={2000} aria-valuenow={vertical} tabIndex={disabled ? -1 : 0} aria-valuetext={`${horizontalLabel} ${horizontal}, ${verticalLabel} ${vertical}`} onBlur={() => { if (drag.current?.id === -1) finish(null, true) }} onKeyDown={e => {
        if (disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
        e.preventDefault()
        if (drag.current && drag.current.id !== -1) return
        drag.current = { id: -1, x: 0, y: 0, ...latest.current }
        const next = dragChannels(latest.current, e.key === 'ArrowLeft' ? -10 : e.key === 'ArrowRight' ? 10 : 0, e.key === 'ArrowUp' ? -10 : e.key === 'ArrowDown' ? 10 : 0, 252, reverseHorizontal, reverseVertical)
        latest.current = next; onChangeRef.current(next.horizontal, next.vertical)
      }} onKeyUp={e => { if (e.key.startsWith('Arrow') && drag.current?.id === -1) finish(null, true) }} className="stick-pad" onPointerDown={start} onPointerMove={move} onPointerUp={e => finish(e.pointerId, true)} onPointerCancel={e => finish(e.pointerId, true)} onLostPointerCapture={e => {
        const expected = expectedCaptureLoss.current.get(e.pointerId) ?? 0
        if (expected) {
          if (expected === 1) expectedCaptureLoss.current.delete(e.pointerId)
          else expectedCaptureLoss.current.set(e.pointerId, expected - 1)
        } else finish(e.pointerId, true)
      }}>
        <div className="crosshair crosshair-x"/><div className="crosshair crosshair-y"/><div className="pad-ring"/><div className="pad-dot" style={{ left: x, top: y }}><div className="pad-dot-inner"/></div>
        <span className="pad-corner tl">+500</span><span className="pad-corner br">-500</span>
      </div>
    </div>
    <div className="axis-horizontal"><span>{horizontalLabel}</span><div className="axis-track"><span style={{ left: `${(horizontal - 1000) / 10}%` }}/></div><strong>{horizontal} <small>µs</small></strong></div>
    <p className="stick-note">{throttleAxis ? 'Handle, throttle & yaw center on release' : 'Drag knob · both axes center on release'}</p>
  </div>
}
