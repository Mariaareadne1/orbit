import { useEffect, useMemo, useRef, useState } from 'react'
import { azimuth } from '../audio/coords'
import { positionAt } from '../audio/path'
import { BUILTINS, GAIN_LIMITS_DB, MAX_VOICES, type BuiltinId, type OrbitDoc } from '../state/document'
import type { Orbit } from '../state/useOrbit'
import type { Recording } from './Stage'
import { VoiceGlyph } from './VoiceGlyph'
import { fmtDb, fmtTime } from './format'

interface ScoreProps {
  orbit: Orbit
  time: number
  selected: string | null
  recording: Recording | null
  onSelect: (id: string, open?: boolean) => void
  onSeek: (t: number) => void
  onAddFile: () => void
  children?: React.ReactNode
}

/** SVG units; the plot stretches to the lane width, strokes stay crisp (non-scaling). */
const W = 1000
const LANE = 30
const SAMPLES = 240
const SCRUB_MS = 60

function rulerStep(duration: number) {
  return duration <= 20 ? 2 : duration <= 60 ? 5 : duration <= 120 ? 10 : 20
}

/** One lane's direction curve: azimuth over time, centre = ahead, up = right, split where it wraps behind. */
function directionSegments(path: OrbitDoc['voices'][number]['path'], duration: number, y0: number) {
  const segments: string[][] = [[]]
  let prev: number | null = null
  for (let k = 0; k <= SAMPLES; k++) {
    const t = (duration * k) / SAMPLES
    const az = azimuth(positionAt(path, t))
    if (prev !== null && Math.abs(az - prev) > 180) segments.push([])
    segments[segments.length - 1]!.push(`${((t / duration) * W).toFixed(1)},${(y0 - (az / 180) * (LANE / 2 - 3)).toFixed(1)}`)
    prev = az
  }
  return segments
}

/** The choreography score: six lanes, one per voice, plotting where each sound is heading over time. */
export function Score({ orbit, time, selected, recording, onSelect, onSeek, onAddFile, children }: ScoreProps) {
  const { doc, actions, missing } = orbit
  const plot = useRef<HTMLDivElement>(null)
  const lastSeek = useRef(0)
  const [adding, setAdding] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (doc.voices.length >= MAX_VOICES) setAdding(false)
  }, [doc.voices.length])

  // The curves depend only on the paths and length, not on the playhead: don't resample them every frame.
  const curves = useMemo(() => new Map(doc.voices.map((v, i) => [v.id, directionSegments(v.path, doc.duration, i * LANE + LANE / 2)])), [doc.voices, doc.duration])
  const H = MAX_VOICES * LANE
  const x = (t: number) => (t / doc.duration) * W
  const step = rulerStep(doc.duration)
  const marks = Array.from({ length: Math.floor(doc.duration / step) + 1 }, (_, i) => i * step)

  const seekFrom = (clientX: number) => {
    const r = plot.current!.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(doc.duration, ((clientX - r.left) / r.width) * doc.duration)))
  }
  const laneAt = (clientY: number) => {
    const lanes = plot.current!.querySelector('.lanes')!.getBoundingClientRect()
    const i = Math.floor(((clientY - lanes.top) / lanes.height) * MAX_VOICES)
    return doc.voices[i]?.id ?? null
  }
  const add = (id: BuiltinId) => {
    const nid = actions.addVoice(id)
    setAdding(false)
    if (nid) onSelect(nid)
  }

  return (
    <section className="score" aria-label="Choreography score">
      <div className="score__bar">
        <p className="score__title">Score <span className="mono">direction over time · centre = ahead · up = right · down = left</span></p>
        {children}
      </div>
      <div className="score__grid">
        <div className="score__corner mono" aria-hidden="true">{doc.voices.length}/{MAX_VOICES} voices</div>
        <ol className="score__heads" aria-label="Voices">
          {Array.from({ length: MAX_VOICES }, (_, i) => {
            const v = doc.voices[i]
            if (!v) {
              const firstEmpty = i === doc.voices.length
              return (
                <li key={`empty-${i}`} className="head head--empty">
                  {firstEmpty ? (
                    <div className="add">
                      <button ref={addButton} type="button" className="link" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>+ Add sound</button>
                      {adding && (
                        <div className="add__menu" role="group" aria-label="Add a sound" onKeyDown={(e) => { if (e.key === 'Escape') { setAdding(false); addButton.current?.focus() } }}>
                          {(Object.keys(BUILTINS) as BuiltinId[]).map((id) => (
                            <button key={id} type="button" className="chip" onClick={() => add(id)}>{BUILTINS[id]}</button>
                          ))}
                          <button type="button" className="chip" onClick={() => { setAdding(false); onAddFile() }}>Audio file…</button>
                        </div>
                      )}
                    </div>
                  ) : <span className="head__index mono" aria-hidden="true">{i + 1}</span>}
                </li>
              )
            }
            return (
              <li key={v.id} className={`head${v.id === selected ? ' is-selected' : ''}${v.mute ? ' is-muted' : ''}`} style={{ ['--voice' as string]: v.color }}>
                <button type="button" className="head__name" aria-pressed={v.id === selected} onClick={() => onSelect(v.id)} title={`${v.name} (${i + 1})`}>
                  <VoiceGlyph voice={v} index={i} />
                  <span>{v.name}</span>
                  {missing.includes(v.id) && <span className="warn mono"> audio missing</span>}
                </button>
                <button type="button" className="chip chip--square" aria-pressed={v.mute} aria-label={`Mute ${v.name}`} onClick={() => actions.patchVoice(v.id, { mute: !v.mute })}>M</button>
                <button type="button" className="chip chip--square" aria-pressed={v.solo} aria-label={`Solo ${v.name}`} onClick={() => actions.patchVoice(v.id, { solo: !v.solo })}>S</button>
                <label className="head__level">
                  <span className="visually-hidden">{v.name} level</span>
                  <input type="range" min={GAIN_LIMITS_DB.min} max={GAIN_LIMITS_DB.max} step={0.5} value={v.gainDb}
                    onChange={(e) => actions.patchVoice(v.id, { gainDb: Number(e.target.value) }, 'preview')}
                    onPointerUp={actions.commit} onKeyUp={actions.commit} onBlur={actions.commit} />
                  <span className="mono">{fmtDb(v.gainDb)}</span>
                </label>
              </li>
            )
          })}
        </ol>
        <div
          ref={plot}
          className="score__plot"
          role="slider"
          tabIndex={0}
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={doc.duration}
          aria-valuenow={+time.toFixed(1)}
          aria-valuetext={`${fmtTime(time)} of ${fmtTime(doc.duration)}`}
          data-testid="timeline"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.currentTarget.setPointerCapture(e.pointerId)
            seekFrom(e.clientX)
            const id = laneAt(e.clientY)
            if (id) onSelect(id, false)
          }}
          onPointerMove={(e) => {
            // Scrubbing while playing restarts sources; at most every SCRUB_MS.
            if (!e.currentTarget.hasPointerCapture(e.pointerId) || performance.now() - lastSeek.current < SCRUB_MS) return
            lastSeek.current = performance.now()
            seekFrom(e.clientX)
          }}
          onKeyDown={(e) => {
            const s = e.shiftKey ? 5 : 1
            if (e.key === 'ArrowRight') onSeek(Math.min(doc.duration, time + s))
            else if (e.key === 'ArrowLeft') onSeek(Math.max(0, time - s))
            else if (e.key === 'Home') onSeek(0)
            else if (e.key === 'End') onSeek(doc.duration)
            else return
            e.preventDefault()
          }}
        >
          <div className="ruler" aria-hidden="true">
            {marks.map((m) => (
              <span key={m} className="ruler__mark mono" style={{ left: `${(m / doc.duration) * 100}%` }}>{m}s</span>
            ))}
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="lanes" aria-hidden="true">
            {Array.from({ length: MAX_VOICES }, (_, i) => {
              const v = doc.voices[i]
              const y0 = i * LANE + LANE / 2
              return (
                <g key={v?.id ?? `empty-${i}`} className={`lane${v ? '' : ' lane--empty'}${v && v.id === selected ? ' is-selected' : ''}${v?.mute ? ' is-muted' : ''}`}>
                  <rect x={0} y={i * LANE} width={W} height={LANE} className="lane__bg" />
                  <line x1={0} x2={W} y1={y0} y2={y0} className="lane__ahead" />
                  {v && recording?.id === v.id && time > recording.from && (
                    <rect x={x(recording.from)} y={i * LANE + 1} width={x(time) - x(recording.from)} height={LANE - 2} className="lane__recording" />
                  )}
                  {v && curves.get(v.id)?.map((pts, s) => <polyline key={s} points={pts.join(' ')} style={{ stroke: v.color }} className="lane__line" />)}
                </g>
              )
            })}
            {marks.map((m) => <line key={m} x1={x(m)} x2={x(m)} y1={0} y2={H} className="lane__grid" />)}
          </svg>
          <span className="playhead" style={{ left: `${(time / doc.duration) * 100}%` }} aria-hidden="true" />
        </div>

      </div>
    </section>
  )
}
