import { useEffect, useRef, useState } from 'react'
import { azimuth, clampToRadius, distance, screenToStage, type StagePoint } from '../audio/coords'
import { positionAt, type Keyframe } from '../audio/path'
import { STAGE_RADIUS, type OrbitDoc, type VoiceDoc } from '../state/document'
import type { OrbitEngine } from '../audio/engine'
import { CENTER, SCALE, VIEW, toScreen } from './geometry'
import { mergeRecording, strokeToPath } from './gestures'
import { shapeOf, shapePath } from './identity'
import { fmtWhere } from './format'

export type Tool = 'place' | 'draw' | 'perform'

/** A Perform gesture in progress: which voice, and the piece time it started at. */
export interface Recording {
  id: string
  from: number
}

interface StageProps {
  doc: OrbitDoc
  engine: OrbitEngine
  playing: boolean
  selected: string | null
  tool: Tool
  /** `open` asks for the sound's card (a deliberate pick), not just selection */
  onSelect: (id: string, open: boolean) => void
  onPreviewPath: (id: string, path: Keyframe[]) => void
  onCommitPath: (id: string, path: Keyframe[]) => void
  onTime: (t: number) => void
  onRecording: (r: Recording | null, recordedSeconds?: number) => void
  onHint: (text: string) => void
  /** when paused, the time to draw at (changes on seek so the stage redraws) */
  stillTime: number
}

const R = STAGE_RADIUS * SCALE
const TRAIL_SECONDS = 1.4
const RECORD_SPACING = 0.04
/** a press on a source in Place mode only moves it after this much travel (px), so a click just selects */
const DRAG_SLOP = 4
const CHEVRON_EVERY = 64

type Gesture =
  /** `at` is the latest placed point: committed as-is, never re-read from a document that may not have re-rendered yet */
  | { kind: 'place'; id: string; moved: boolean; x0: number; y0: number; at: StagePoint | null }
  /** points live on the gesture so a fast flick commits everything, rendered or not */
  | { kind: 'draw'; id: string; points: StagePoint[] }
  | { kind: 'perform'; id: string; rec: Keyframe[]; lastT: number }

export function Stage({ doc, engine, playing, selected, tool, onSelect, onPreviewPath, onCommitPath, onTime, onRecording, onHint, stillTime }: StageProps) {
  const svg = useRef<SVGSVGElement>(null)
  const nodes = useRef(new Map<string, SVGGElement>())
  const trails = useRef(new Map<string, SVGPolylineElement>())
  const readout = useRef<SVGTextElement>(null)
  const [stroke, setStroke] = useState<StagePoint[] | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const docRef = useRef(doc)
  docRef.current = doc
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  // Draw loop: reads the engine clock and the same path interpolation the audio uses.
  useEffect(() => {
    let raf = 0
    const frame = () => {
      const d = docRef.current
      const t = engine.time()
      for (const v of d.voices) {
        const p = engine.position(v, t)
        const s = toScreen(p)
        nodes.current.get(v.id)?.setAttribute('transform', `translate(${s.px.toFixed(1)} ${s.py.toFixed(1)})`)
        if (v.id === selectedRef.current && readout.current) readout.current.textContent = fmtWhere(p)
        const trail = trails.current.get(v.id)
        if (trail) {
          const pts: string[] = []
          if (playing && v.path.length > 1) {
            for (let k = 0; k <= 24; k++) {
              const tt = t - TRAIL_SECONDS * (1 - k / 24)
              if (tt < 0) continue
              const q = toScreen(positionAt(v.path, tt))
              pts.push(`${q.px.toFixed(1)},${q.py.toFixed(1)}`)
            }
          }
          trail.setAttribute('points', pts.join(' '))
        }
      }
      onTime(t)
      if (playing || gesture.current) raf = requestAnimationFrame(frame)
    }
    frame()
    return () => cancelAnimationFrame(raf)
  }, [engine, playing, doc, onTime, stillTime, selected])

  const pointAt = (clientX: number, clientY: number): StagePoint => {
    const r = svg.current!.getBoundingClientRect()
    const px = ((clientX - r.left) / r.width) * VIEW
    const py = ((clientY - r.top) / r.height) * VIEW
    const p = clampToRadius(screenToStage(px, py, CENTER, CENTER, SCALE), STAGE_RADIUS)
    return { x: +p.x.toFixed(3), y: +p.y.toFixed(3) }
  }

  const startPerform = (id: string, p: StagePoint) => {
    const t = engine.time()
    gesture.current = { kind: 'perform', id, rec: [{ t, ...p }], lastT: t }
    engine.grab(id, p)
    onRecording({ id, from: t })
  }

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const hit = (e.target as Element).closest('[data-voice]')?.getAttribute('data-voice') ?? null
    const switching = hit !== null && hit !== selected
    // Picking a sound in Place opens its card; in Draw/Perform a press just selects (the card would cover the floor).
    if (hit) onSelect(hit, tool === 'place')
    const id = hit ?? selected
    if (!id) {
      onHint('Select a sound first: click one on the stage or a lane in the score.')
      return
    }
    const p = pointAt(e.clientX, e.clientY)
    if (tool === 'place') {
      e.currentTarget.setPointerCapture(e.pointerId)
      // A press on empty space places the selected sound there at once.
      gesture.current = { kind: 'place', id, moved: hit === null, x0: e.clientX, y0: e.clientY, at: hit === null ? p : null }
      if (hit === null) onPreviewPath(id, [{ t: 0, ...p }])
    } else if (tool === 'draw') {
      if (switching) return // first press on another sound selects it
      e.currentTarget.setPointerCapture(e.pointerId)
      gesture.current = { kind: 'draw', id, points: [p] }
      setStroke([p])
    } else if (playing) {
      e.currentTarget.setPointerCapture(e.pointerId)
      startPerform(id, p)
    } else {
      onHint('Perform records against the music: press play first.')
    }
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    if (!g) return
    const p = pointAt(e.clientX, e.clientY)
    if (g.kind === 'place') {
      if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < DRAG_SLOP) return
      g.moved = true
      g.at = p
      onPreviewPath(g.id, [{ t: 0, ...p }])
    } else if (g.kind === 'draw') {
      g.points.push(p)
      setStroke([...g.points])
    }
    else {
      const t = engine.time()
      engine.grab(g.id, p)
      // A loop wrapped mid-gesture: keep what was recorded up to the end.
      if (t < g.lastT) return finish()
      if (t - g.lastT >= RECORD_SPACING) {
        g.rec.push({ t: +t.toFixed(4), ...p })
        g.lastT = t
      }
    }
  }

  const finish = () => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    const v = docRef.current.voices.find((x) => x.id === g.id)
    if (g.kind === 'perform') {
      engine.release()
      const seconds = g.rec.length > 1 ? g.rec[g.rec.length - 1]!.t - g.rec[0]!.t : 0
      onRecording(null, seconds)
      if (v && g.rec.length > 1) onCommitPath(g.id, mergeRecording(v.path, g.rec))
      return
    }
    if (!v) return
    if (g.kind === 'place') {
      if (g.at) onCommitPath(g.id, [{ t: 0, ...g.at }])
    } else {
      const path = strokeToPath(g.points, docRef.current.duration)
      setStroke(null)
      if (path.length) onCommitPath(g.id, path)
    }
  }

  // Keyboard: Enter opens a focused source's card; arrows nudge a fixed source. Held arrows are one undo step.
  const nudging = useRef<{ id: string; path: Keyframe[] } | null>(null)
  const onKey = (e: React.KeyboardEvent) => {
    const id = (e.target as Element).closest('[data-voice]')?.getAttribute('data-voice')
    const v = docRef.current.voices.find((x) => x.id === id)
    if (!v) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(v.id, true)
      return
    }
    const step = e.shiftKey ? 0.5 : 0.1
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
    if (!d) return
    e.preventDefault()
    if (v.id !== selected) onSelect(v.id, false)
    if (v.path.length > 1) {
      onHint(`${v.name} follows a path. Use “Hold here” on its card to fix it in place, then nudge.`)
      return
    }
    const cur = nudging.current?.id === v.id ? nudging.current.path[0]! : v.path[0]!
    const p = clampToRadius({ x: cur.x + d[0]!, y: cur.y + d[1]! }, STAGE_RADIUS)
    const path = [{ t: 0, x: +p.x.toFixed(3), y: +p.y.toFixed(3) }]
    nudging.current = { id: v.id, path }
    onPreviewPath(v.id, path)
  }
  const onKeyUp = () => {
    const n = nudging.current
    nudging.current = null
    if (n) onCommitPath(n.id, n.path)
  }

  const t = playing ? engine.time() : Math.max(0, stillTime)

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={`stage stage--${tool}${tool === 'perform' && !playing ? ' stage--idle' : ''}`}
      role="group"
      aria-roledescription="soundstage"
      aria-label="Soundstage, seen from above. The listener is at the centre facing the top; rings every metre to 5 m."
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={() => gesture.current && finish()}
      onKeyDown={onKey}
      onKeyUp={onKeyUp}
      onBlur={onKeyUp}
      data-testid="stage"
    >
      <defs>
        <radialGradient id="field" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1a1f3a" />
          <stop offset="70%" stopColor="#121530" />
          <stop offset="100%" stopColor="#0f1126" />
        </radialGradient>
      </defs>
      <Calibration />
      {doc.voices.map((v) => <PathLine key={v.id} voice={v} selected={v.id === selected} />)}
      <Listener />
      {stroke && stroke.length > 1 && (
        <polyline points={stroke.map((p) => { const s = toScreen(p); return `${s.px.toFixed(1)},${s.py.toFixed(1)}` }).join(' ')} className="stroke" />
      )}
      {doc.voices.map((v) => (
        <polyline key={`trail-${v.id}`} ref={(el) => { if (el) trails.current.set(v.id, el); else trails.current.delete(v.id) }} className="trail" style={{ stroke: v.color }} />
      ))}
      {doc.voices.map((v, i) => {
        const p = positionAt(v.path, t)
        const shape = shapePath(shapeOf(v, i), 9)
        const isSel = v.id === selected
        return (
          <g key={v.id} ref={(el) => { if (el) nodes.current.set(v.id, el); else nodes.current.delete(v.id) }}
            data-voice={v.id} data-testid={`node-${v.name}`} tabIndex={0} role="button"
            aria-pressed={isSel}
            aria-label={`${v.name}${v.mute ? ', muted' : ''}${v.solo ? ', solo' : ''}: ${distance(p).toFixed(1)} metres at ${Math.round(azimuth(p))} degrees${v.path.length > 1 ? ', moving' : ''}`}
            className={`source${isSel ? ' is-selected' : ''}${v.mute ? ' is-muted' : ''}`}>
            <circle r="22" className="source__hit" />
            {isSel && <circle r="17" className="source__ring" />}
            <path d={shape} className="source__shape" style={{ fill: v.mute ? 'none' : v.color, stroke: v.mute ? v.color : undefined }} />
            <text y="-24" className="source__label">{v.name}{v.solo ? ' · S' : ''}</text>
            {isSel && <text ref={readout} y="34" className="source__readout">{fmtWhere(p)}</text>}
          </g>
        )
      })}
    </svg>
  )
}

/** Rings every metre, azimuth scale every 10°, axes. Pure geometry, drawn once per render. */
function Calibration() {
  const ticks = Array.from({ length: 36 }, (_, i) => i * 10)
  const label = (deg: number) => (deg === 0 ? 'FRONT' : deg === 180 ? 'BACK' : deg === 90 ? 'R 90°' : deg === 270 ? 'L 90°' : deg < 180 ? `+${deg}°` : `−${360 - deg}°`)
  return (
    <g className="calibration" aria-hidden="true">
      <circle cx={CENTER} cy={CENTER} r={R + 26} className="field-halo" />
      <circle cx={CENTER} cy={CENTER} r={R} fill="url(#field)" />
      <line x1={CENTER} y1={CENTER - R} x2={CENTER} y2={CENTER + R} className="axis" />
      <line x1={CENTER - R} y1={CENTER} x2={CENTER + R} y2={CENTER} className="axis" />
      {[1, 2, 3, 4, 5].map((m) => (
        <g key={m}>
          <circle cx={CENTER} cy={CENTER} r={m * SCALE} className={m === STAGE_RADIUS ? 'ring ring--edge' : 'ring'} />
          <text x={CENTER + 5} y={CENTER - m * SCALE - 4} className="ring-label">{m} m</text>
        </g>
      ))}
      {ticks.map((deg) => {
        const a = (deg * Math.PI) / 180
        const major = deg % 30 === 0
        const r0 = R + 3
        const r1 = R + (major ? 11 : 6)
        const lr = R + 26
        return (
          <g key={deg}>
            <line x1={CENTER + Math.sin(a) * r0} y1={CENTER - Math.cos(a) * r0} x2={CENTER + Math.sin(a) * r1} y2={CENTER - Math.cos(a) * r1} className={major ? 'tick tick--major' : 'tick'} />
            {major && (
              <text x={CENTER + Math.sin(a) * lr} y={CENTER - Math.cos(a) * lr + 3.5} className={`azimuth-label${deg % 90 === 0 ? ' azimuth-label--cardinal' : ''}`}>{label(deg)}</text>
            )}
          </g>
        )
      })}
    </g>
  )
}

/** The listener: head, ears and a nose pointing forward (−Z, the top of the stage), with a faint facing wedge. */
function Listener() {
  const wedge = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180
    return `${(CENTER + Math.sin(a) * r).toFixed(1)} ${(CENTER - Math.cos(a) * r).toFixed(1)}`
  }
  const reach = 1.4 * SCALE
  return (
    <g className="listener" aria-hidden="true">
      <path d={`M${CENTER} ${CENTER} L${wedge(-28, reach)} A${reach} ${reach} 0 0 1 ${wedge(28, reach)} Z`} className="listener__facing" />
      <g transform={`translate(${CENTER} ${CENTER})`}>
        <ellipse cx="-13" cy="0" rx="3" ry="6" className="listener__ear" />
        <ellipse cx="13" cy="0" rx="3" ry="6" className="listener__ear" />
        <path d="M-5 -12.5 L0 -21 L5 -12.5" className="listener__nose" />
        <ellipse rx="12" ry="14" className="listener__head" />
        <text y="32" className="listener__label">LISTENER</text>
      </g>
    </g>
  )
}

function PathLine({ voice, selected }: { voice: VoiceDoc; selected: boolean }) {
  if (voice.path.length < 2) return null
  const pts = voice.path.map((k) => toScreen(k))
  const line = pts.map((s) => `${s.px.toFixed(1)},${s.py.toFixed(1)}`).join(' ')
  // Direction chevrons spaced along the path, so the drawing says which way the sound travels.
  const chevrons: Array<{ x: number; y: number; deg: number }> = []
  if (selected) {
    let carry = CHEVRON_EVERY / 2
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!
      const b = pts[i]!
      const len = Math.hypot(b.px - a.px, b.py - a.py)
      let d = carry
      while (d < len) {
        const f = d / len
        chevrons.push({ x: a.px + (b.px - a.px) * f, y: a.py + (b.py - a.py) * f, deg: (Math.atan2(b.py - a.py, b.px - a.px) * 180) / Math.PI })
        d += CHEVRON_EVERY
      }
      carry = d - len
    }
  }
  const first = pts[0]!
  return (
    <g className={`path${selected ? ' is-selected' : ''}`} style={{ stroke: voice.color }} data-testid={`path-${voice.name}`}>
      <polyline points={line} />
      {selected && <circle cx={first.px} cy={first.py} r="3.5" className="path__start" style={{ fill: voice.color }} />}
      {chevrons.map((c, i) => <path key={i} d="M-3.5 -3.5 L1.5 0 L-3.5 3.5" transform={`translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) rotate(${c.deg.toFixed(1)})`} className="path__chevron" />)}
    </g>
  )
}
