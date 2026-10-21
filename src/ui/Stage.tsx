import { useEffect, useRef, useState } from 'react'
import { azimuth, clampToRadius, distance, screenToStage, stageToScreen, type StagePoint } from '../audio/coords'
import { positionAt, type Keyframe } from '../audio/path'
import { STAGE_RADIUS, type OrbitDoc, type VoiceDoc } from '../state/document'
import type { OrbitEngine } from '../audio/engine'

export type Tool = 'place' | 'draw' | 'perform'

interface StageProps {
  doc: OrbitDoc
  engine: OrbitEngine
  playing: boolean
  selected: string | null
  tool: Tool
  onSelect: (id: string) => void
  onPreviewPath: (id: string, path: Keyframe[]) => void
  onCommitPath: (id: string, path: Keyframe[]) => void
  onTime: (t: number) => void
  /** when paused, the time to draw at (changes on seek so the stage redraws) */
  stillTime: number
}

const SIZE = 640
const C = SIZE / 2
const SCALE = (SIZE / 2 - 46) / STAGE_RADIUS
const TRAIL_SECONDS = 1.4
const RECORD_SPACING = 0.04

const toScreen = (p: StagePoint) => stageToScreen(p, C, C, SCALE)

/** Resample a freehand stroke to evenly spaced keyframes across the piece. */
export function strokeToPath(points: StagePoint[], duration: number, count = 96): Keyframe[] {
  if (points.length < 2) return []
  const lengths = [0]
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y))
  const total = lengths[lengths.length - 1]!
  if (total < 0.2) return []
  const out: Keyframe[] = []
  let j = 1
  for (let i = 0; i <= count; i++) {
    const target = (total * i) / count
    while (j < lengths.length - 1 && lengths[j]! < target) j++
    const a = points[j - 1]!
    const b = points[j]!
    const span = lengths[j]! - lengths[j - 1]!
    const f = span > 0 ? (target - lengths[j - 1]!) / span : 0
    out.push({ t: +((duration * i) / count).toFixed(4), x: +(a.x + (b.x - a.x) * f).toFixed(3), y: +(a.y + (b.y - a.y) * f).toFixed(3) })
  }
  return out
}

/** Replace the part of `path` between the first and last recorded times with the recording. */
export function mergeRecording(path: readonly Keyframe[], rec: readonly Keyframe[]): Keyframe[] {
  if (rec.length === 0) return [...path]
  const t0 = rec[0]!.t
  const t1 = rec[rec.length - 1]!.t
  const before = path.filter((k) => k.t < t0)
  const after = path.filter((k) => k.t > t1)
  // Hold the old path's position right up to the recording, and resume it right
  // after, so the untouched stretches don't drift toward the recorded points.
  const lastBefore = before[before.length - 1]
  const anchorBefore = t0 > 0.002 && (!lastBefore || lastBefore.t < t0 - 0.002) ? [{ t: t0 - 0.001, ...positionAt(path, t0 - 0.001) }] : []
  const firstAfter = after[0]
  const anchorAfter = firstAfter && firstAfter.t > t1 + 0.002 ? [{ t: t1 + 0.001, ...positionAt(path, t1 + 0.001) }] : []
  return [...before, ...anchorBefore, ...rec, ...anchorAfter, ...after]
}

export function Stage({ doc, engine, playing, selected, tool, onSelect, onPreviewPath, onCommitPath, onTime, stillTime }: StageProps) {
  const svg = useRef<SVGSVGElement>(null)
  const nodes = useRef(new Map<string, SVGGElement>())
  const trails = useRef(new Map<string, SVGPolylineElement>())
  const [stroke, setStroke] = useState<StagePoint[] | null>(null)
  const gesture = useRef<{ kind: Tool; id: string; rec: Keyframe[]; lastT: number } | null>(null)
  const docRef = useRef(doc)
  docRef.current = doc

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
  }, [engine, playing, doc, onTime, stillTime])

  const pointFromEvent = (e: React.PointerEvent): StagePoint => {
    const r = svg.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * SIZE
    const py = ((e.clientY - r.top) / r.height) * SIZE
    const p = clampToRadius(screenToStage(px, py, C, C, SCALE), STAGE_RADIUS)
    return { x: +p.x.toFixed(3), y: +p.y.toFixed(3) }
  }

  const voice = doc.voices.find((v) => v.id === selected) ?? null

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || !voice) return
    const target = (e.target as Element).closest('[data-voice]')
    if (target && target.getAttribute('data-voice') !== voice.id && tool !== 'draw') {
      onSelect(target.getAttribute('data-voice')!)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pointFromEvent(e)
    if (tool === 'place') {
      gesture.current = { kind: 'place', id: voice.id, rec: [], lastT: 0 }
      onPreviewPath(voice.id, [{ t: 0, ...p }])
    } else if (tool === 'draw') {
      gesture.current = { kind: 'draw', id: voice.id, rec: [], lastT: 0 }
      setStroke([p])
    } else if (tool === 'perform' && playing) {
      const t = engine.time()
      gesture.current = { kind: 'perform', id: voice.id, rec: [{ t, ...p }], lastT: t }
      engine.grab(voice.id, p)
    }
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    if (!g) return
    const p = pointFromEvent(e)
    if (g.kind === 'place') onPreviewPath(g.id, [{ t: 0, ...p }])
    else if (g.kind === 'draw') setStroke((s) => (s ? [...s, p] : [p]))
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
    if (g.kind === 'perform') engine.release()
    if (!v) return
    if (g.kind === 'place') onCommitPath(g.id, positionsOrSelf(v))
    else if (g.kind === 'draw') {
      const path = strokeToPath(stroke ?? [], docRef.current.duration)
      setStroke(null)
      if (path.length) onCommitPath(g.id, path)
    } else if (g.rec.length > 1) {
      onCommitPath(g.id, mergeRecording(v.path, g.rec))
    }
  }

  // Keyboard nudge for a static voice (Place tool).
  const onKey = (e: React.KeyboardEvent) => {
    if (!voice || tool !== 'place') return
    const step = e.shiftKey ? 0.5 : 0.1
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
    if (!d) return
    e.preventDefault()
    const cur = positionAt(voice.path, engine.time())
    const p = clampToRadius({ x: cur.x + d[0]!, y: cur.y + d[1]! }, STAGE_RADIUS)
    onCommitPath(voice.id, [{ t: 0, x: +p.x.toFixed(3), y: +p.y.toFixed(3) }])
  }

  const sel = voice ? engine.position(voice) : null

  return (
    <div className="stage-wrap">
      <svg
        ref={svg}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={`stage stage--${tool}${tool === 'perform' && !playing ? ' stage--idle' : ''}`}
        role="application"
        aria-roledescription="soundstage"
        aria-label={voice && sel ? `Soundstage. ${voice.name} is ${distance(sel).toFixed(1)} metres away at ${Math.round(azimuth(sel))} degrees.` : 'Soundstage'}
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyDown={onKey}
        data-testid="stage"
      >
        <defs>
          <radialGradient id="floor" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#141826" />
            <stop offset="100%" stopColor="#07080c" />
          </radialGradient>
          <filter id="glow" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="6" /></filter>
        </defs>
        <circle cx={C} cy={C} r={STAGE_RADIUS * SCALE + 18} fill="url(#floor)" />
        {[1, 2, 3, 4, 5].map((m) => (
          <g key={m}>
            <circle cx={C} cy={C} r={m * SCALE} className={m === 5 ? 'ring ring--edge' : 'ring'} />
            <text x={C + 4} y={C - m * SCALE + 12} className="ring-label">{m} m</text>
          </g>
        ))}
        {Array.from({ length: 12 }, (_, i) => i * 30).map((deg) => {
          const a = (deg * Math.PI) / 180
          const r1 = STAGE_RADIUS * SCALE
          return <line key={deg} x1={C + Math.sin(a) * (r1 - 6)} y1={C - Math.cos(a) * (r1 - 6)} x2={C + Math.sin(a) * (r1 + 6)} y2={C - Math.cos(a) * (r1 + 6)} className="tick" />
        })}
        <text x={C} y={14} className="compass">FRONT · 0°</text>
        <text x={SIZE - 4} y={C + 4} className="compass compass--end">R 90°</text>
        <text x={C} y={SIZE - 6} className="compass">BACK · 180°</text>
        <text x={4} y={C + 4} className="compass compass--start">L 90°</text>

        {doc.voices.map((v) => (
          <PathLine key={v.id} voice={v} selected={v.id === selected} />
        ))}

        <g className="listener" transform={`translate(${C} ${C})`} aria-hidden="true">
          <ellipse rx="11" ry="13" className="listener__head" />
          <path d="M-4 -12 L0 -19 L4 -12" className="listener__nose" />
          <ellipse cx="-12" cy="0" rx="2.5" ry="5" className="listener__ear" />
          <ellipse cx="12" cy="0" rx="2.5" ry="5" className="listener__ear" />
        </g>

        {stroke && stroke.length > 1 && (
          <polyline points={stroke.map((p) => { const s = toScreen(p); return `${s.px},${s.py}` }).join(' ')} className="stroke" />
        )}

        {doc.voices.map((v) => (
          <polyline key={`trail-${v.id}`} ref={(el) => { if (el) trails.current.set(v.id, el); else trails.current.delete(v.id) }} className="trail" style={{ stroke: v.color }} />
        ))}
        {doc.voices.map((v) => (
          <g key={v.id} ref={(el) => { if (el) nodes.current.set(v.id, el); else nodes.current.delete(v.id) }} data-voice={v.id} data-testid={`node-${v.name}`} className={`node${v.id === selected ? ' is-selected' : ''}${v.mute ? ' is-muted' : ''}`}>
            <circle r="16" fill={v.color} filter="url(#glow)" opacity="0.55" />
            <circle r="9" fill={v.color} className="node__core" />
            {v.id === selected && <circle r="15" className="node__ring" style={{ stroke: v.color }} />}
            <text y="-22" className="node__label">{v.name}</text>
          </g>
        ))}
      </svg>
      <p className="stage-help" aria-live="polite">
        {!voice ? 'Select a voice to move it.'
          : tool === 'place' ? `Place: drag ${voice.name} to a fixed spot, or use the arrow keys.`
          : tool === 'draw' ? `Draw: sketch ${voice.name}'s path — the stroke is spread across the whole piece.`
          : playing ? `Perform: hold and move to record ${voice.name}'s motion live; it replaces that stretch of the path.`
          : 'Perform: press play first, then move the voice in time with the music.'}
      </p>
    </div>
  )
}

function positionsOrSelf(v: VoiceDoc): Keyframe[] {
  return v.path
}

function PathLine({ voice, selected }: { voice: VoiceDoc; selected: boolean }) {
  if (voice.path.length < 2) return null
  const pts = voice.path.map((k) => { const s = toScreen(k); return `${s.px.toFixed(1)},${s.py.toFixed(1)}` }).join(' ')
  const first = toScreen(voice.path[0]!)
  return (
    <g className={`path${selected ? ' is-selected' : ''}`} style={{ stroke: voice.color, fill: voice.color }}>
      <polyline points={pts} />
      {selected && <circle cx={first.px} cy={first.py} r="3.5" className="path__start" />}
    </g>
  )
}
