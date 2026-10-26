import { useEffect, useState } from 'react'
import { azimuth, distance } from '../audio/coords'
import { orbitPath, positionAt } from '../audio/path'
import { BUILTINS, cleanName, GAIN_LIMITS_DB, type OrbitDoc, type VoiceDoc } from '../state/document'
import type { Orbit } from '../state/useOrbit'
import { VoiceGlyph } from './VoiceGlyph'
import { fmtAzimuth, fmtDb } from './format'

interface SourceCardProps {
  orbit: Orbit
  voice: VoiceDoc
  index: number
  time: number
  onClose: () => void
  onReplace: (id: string) => void
}

const CONFIRM_MS = 4000

function presets(v: VoiceDoc, d: OrbitDoc, t: number) {
  const here = positionAt(v.path, t)
  const start = azimuth(positionAt(v.path, 0))
  return [
    { label: 'Hold here', title: 'Fix the sound where it is now', path: [{ t: 0, x: +here.x.toFixed(3), y: +here.y.toFixed(3) }] },
    { label: 'Orbit ↻', title: 'One clockwise turn at 2.5 m over the piece', path: orbitPath(2.5, d.duration, 1, start, 64) },
    { label: 'Orbit ↺', title: 'One anticlockwise turn at 2.5 m over the piece', path: orbitPath(2.5, d.duration, -1, start, 64) },
    { label: 'Pass L→R', title: 'Cross in front, left to right', path: [{ t: 0, x: -4, y: 1 }, { t: d.duration, x: 4, y: 1 }] },
  ]
}

/** The acoustic card for one sound: what it is, where it is, how loud, how it moves. */
export function SourceCard({ orbit, voice, index, time, onClose, onReplace }: SourceCardProps) {
  const { doc, actions, missing, engine } = orbit
  const [name, setName] = useState(voice.name)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => setName(voice.name), [voice.name])
  useEffect(() => setConfirming(false), [voice.id])
  useEffect(() => {
    if (!confirming) return
    const t = window.setTimeout(() => setConfirming(false), CONFIRM_MS)
    return () => window.clearTimeout(t)
  }, [confirming])

  const p = engine.position(voice, time)
  const moving = voice.path.length > 1
  const origin = voice.source.kind === 'builtin'
    ? `${BUILTINS[voice.source.id]} · synthesised in code`
    : `${voice.source.name} · ${voice.source.seconds.toFixed(1)} s · kept in this browser`
  const rename = () => {
    const next = cleanName(name, voice.name)
    if (next !== voice.name) actions.patchVoice(voice.id, { name: next })
    else setName(voice.name)
  }

  return (
    <section className="card" aria-labelledby="card-title" data-testid="source-card" style={{ ['--voice' as string]: voice.color }}
      onKeyDown={(e) => { if (e.key === 'Escape' && !(e.target as HTMLElement).matches('input')) onClose() }}>
      <header className="card__head">
        <VoiceGlyph voice={voice} index={index} size={18} />
        <h2 id="card-title" className="visually-hidden">{voice.name}</h2>
        <label className="card__name">
          <span className="visually-hidden">Name</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={rename}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setName(voice.name); (e.target as HTMLInputElement).blur() } }} />
        </label>
        <button type="button" className="icon-button" aria-label="Close sound card" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </header>
      <p className="card__origin mono">{origin}{missing.includes(voice.id) && <span className="warn"> · audio missing</span>}</p>

      <dl className="card__where mono" aria-label="Position">
        <div><dt>x</dt><dd>{p.x >= 0 ? '+' : '−'}{Math.abs(p.x).toFixed(2)} m</dd></div>
        <div><dt>y</dt><dd>{p.y >= 0 ? '+' : '−'}{Math.abs(p.y).toFixed(2)} m</dd></div>
        <div><dt>dist</dt><dd>{distance(p).toFixed(2)} m</dd></div>
        <div><dt>az</dt><dd>{fmtAzimuth(p)}</dd></div>
      </dl>

      <div className="card__section">
        <div className="card__row">
          <button type="button" className="chip" aria-pressed={voice.mute} aria-label={`Mute ${voice.name}`} onClick={() => actions.patchVoice(voice.id, { mute: !voice.mute })}>Mute</button>
          <button type="button" className="chip" aria-pressed={voice.solo} aria-label={`Solo ${voice.name}`} onClick={() => actions.patchVoice(voice.id, { solo: !voice.solo })}>Solo</button>
          <label className="level">
            <span className="visually-hidden">{voice.name} level</span>
            <input type="range" min={GAIN_LIMITS_DB.min} max={GAIN_LIMITS_DB.max} step={0.5} value={voice.gainDb}
              onChange={(e) => actions.patchVoice(voice.id, { gainDb: Number(e.target.value) }, 'preview')}
              onPointerUp={actions.commit} onKeyUp={actions.commit} onBlur={actions.commit} />
            <span className="mono">{fmtDb(voice.gainDb)}</span>
          </label>
        </div>
      </div>

      <div className="card__section">
        <p className="card__label">Motion <span className="mono muted">{moving ? `path · ${voice.path.length} keyframes` : 'fixed position'}</span></p>
        <div className="card__presets" role="group" aria-label="Motion presets">
          {presets(voice, doc, time).map((pr) => (
            <button key={pr.label} type="button" className="chip" title={pr.title} onClick={() => actions.patchVoice(voice.id, { path: pr.path })}>{pr.label}</button>
          ))}
        </div>
      </div>

      <footer className="card__foot">
        <button type="button" className="link" onClick={() => onReplace(voice.id)}>Replace sound…</button>
        {confirming ? (
          <span className="card__confirm" role="group" aria-label="Confirm removal">
            <button type="button" className="link link--danger" onClick={() => { actions.removeVoice(voice.id); onClose() }}>Remove {voice.name}</button>
            <button type="button" className="link" onClick={() => setConfirming(false)}>Keep</button>
          </span>
        ) : (
          <button type="button" className="link" onClick={() => setConfirming(true)}>Remove…</button>
        )}
      </footer>
    </section>
  )
}
