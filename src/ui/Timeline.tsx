import { useEffect, useRef, useState } from 'react'
import { azimuth } from '../audio/coords'
import { positionAt } from '../audio/path'
import { DURATION_LIMITS, type OrbitDoc } from '../state/document'

interface TimelineProps {
  doc: OrbitDoc
  time: number
  playing: boolean
  selected: string | null
  onSeek: (t: number) => void
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onDuration: (d: number) => void
  onLoop: (loop: boolean) => void
  onSelect: (id: string) => void
}

const W = 1000
const LANE = 30

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`

/** Each lane plots the voice's azimuth over time: centre line = ahead, up = right, down = left. */
export function Timeline({ doc, time, playing, selected, onSeek, onPlay, onPause, onStop, onDuration, onLoop, onSelect }: TimelineProps) {
  const svg = useRef<SVGSVGElement>(null)
  const [lengthDraft, setLengthDraft] = useState<string | null>(null)
  useEffect(() => setLengthDraft(null), [doc.duration])
  const applyLength = () => {
    if (lengthDraft === null) return
    const v = Number(lengthDraft)
    if (Number.isFinite(v) && v >= DURATION_LIMITS.min && v <= DURATION_LIMITS.max) onDuration(Math.round(v))
    setLengthDraft(null)
  }
  const lastSeek = useRef(0)
  const H = Math.max(1, doc.voices.length) * LANE + 18
  const x = (t: number) => (t / doc.duration) * W
  const seekFrom = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(doc.duration, ((clientX - r.left) / r.width) * doc.duration)))
  }
  return (
    <section className="timeline" aria-label="Timeline">
      <div className="transport">
        <button type="button" className="round" onClick={playing ? onPause : onPlay} aria-label={playing ? 'Pause' : 'Play'} data-testid="play">
          {playing ? <svg viewBox="0 0 16 16"><rect x="4" y="3" width="3" height="10" /><rect x="9" y="3" width="3" height="10" /></svg>
            : <svg viewBox="0 0 16 16"><path d="M5 3 13 8 5 13z" /></svg>}
        </button>
        <button type="button" className="round round--small" onClick={onStop} aria-label="Stop and return to start">
          <svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" /></svg>
        </button>
        <output className="clock mono" data-testid="clock">{fmt(time)} / {fmt(doc.duration)}</output>
        <label className="toggle">
          <input type="checkbox" checked={doc.loop} onChange={(e) => onLoop(e.target.checked)} /> Loop
        </label>
        <label className="duration">
          Length
          <input type="number" min={DURATION_LIMITS.min} max={DURATION_LIMITS.max} step={1} value={lengthDraft ?? doc.duration}
            aria-label={`Length in seconds, ${DURATION_LIMITS.min} to ${DURATION_LIMITS.max}`}
            onChange={(e) => setLengthDraft(e.target.value)}
            onBlur={applyLength}
            onKeyDown={(e) => { if (e.key === 'Enter') applyLength(); if (e.key === 'Escape') setLengthDraft(null) }} /> s
        </label>
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="lanes"
        style={{ height: H }}
        role="slider"
        tabIndex={0}
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={doc.duration}
        aria-valuenow={+time.toFixed(1)}
        aria-valuetext={`${fmt(time)} of ${fmt(doc.duration)}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          seekFrom(e.clientX)
        }}
        onPointerMove={(e) => {
          // Scrubbing while playing restarts sources; at most every 60 ms.
          if (e.buttons !== 1 || performance.now() - lastSeek.current < 60) return
          lastSeek.current = performance.now()
          seekFrom(e.clientX)
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 5 : 1
          if (e.key === 'ArrowRight') onSeek(Math.min(doc.duration, time + step))
          else if (e.key === 'ArrowLeft') onSeek(Math.max(0, time - step))
          else if (e.key === 'Home') onSeek(0)
          else return
          e.preventDefault()
        }}
        data-testid="timeline"
      >
        {Array.from({ length: Math.floor(doc.duration) + 1 }, (_, s) => (
          <line key={s} x1={x(s)} x2={x(s)} y1={H - 14} y2={H - (s % 5 === 0 ? 4 : 9)} className="tl-tick" />
        ))}
        {doc.voices.map((v, i) => {
          const y0 = i * LANE + LANE / 2
          // Split the line where the direction wraps past ±180° (behind the listener).
          const segments: string[][] = [[]]
          let prevAz: number | null = null
          for (let k = 0; k <= 240; k++) {
            const t = (doc.duration * k) / 240
            const az = azimuth(positionAt(v.path, t))
            if (prevAz !== null && Math.abs(az - prevAz) > 180) segments.push([])
            segments[segments.length - 1]!.push(`${x(t).toFixed(1)},${(y0 - (az / 180) * (LANE / 2 - 3)).toFixed(1)}`)
            prevAz = az
          }
          return (
            <g key={v.id} className={`lane${v.id === selected ? ' is-selected' : ''}${v.mute ? ' is-muted' : ''}`} onPointerDown={() => onSelect(v.id)}>
              <rect x={0} y={i * LANE} width={W} height={LANE} className="lane__bg" />
              <line x1={0} x2={W} y1={y0} y2={y0} className="lane__ahead" />
              {segments.map((pts, s) => <polyline key={s} points={pts.join(' ')} style={{ stroke: v.color }} className="lane__line" />)}
            </g>
          )
        })}
        <line x1={x(time)} x2={x(time)} y1={0} y2={H} className="playhead" />
      </svg>
      <p className="lanes-key mono">each lane: direction over time · centre = ahead · up = right · down = left</p>
    </section>
  )
}
