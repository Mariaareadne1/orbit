import { useRef, useState } from 'react'
import { azimuth, distance } from '../audio/coords'
import { orbitPath, positionAt } from '../audio/path'
import { BUILTINS, GAIN_LIMITS_DB, MAX_VOICES, type BuiltinId, type OrbitDoc, type VoiceDoc } from '../state/document'
import type { Orbit } from '../state/useOrbit'
import { AudioImportError } from '../audio/importAudio'
import type { Tool } from './Stage'

interface VoicesProps {
  orbit: Orbit
  selected: string | null
  tool: Tool
  time: number
  onSelect: (id: string) => void
  onTool: (t: Tool) => void
}

const TOOLS: Array<{ id: Tool; label: string; hint: string }> = [
  { id: 'place', label: 'Place', hint: 'Fixed position' },
  { id: 'draw', label: 'Draw', hint: 'Sketch a path' },
  { id: 'perform', label: 'Perform', hint: 'Record live' },
]

export function Voices({ orbit, selected, tool, time, onSelect, onTool }: VoicesProps) {
  const { doc, actions, missing } = orbit
  const fileInput = useRef<HTMLInputElement>(null)
  const [importTarget, setImportTarget] = useState<string | null>(null)
  const voice = doc.voices.find((v) => v.id === selected) ?? null

  const presets = (v: VoiceDoc, d: OrbitDoc) => [
    { label: 'Orbit ↻', path: orbitPath(2.5, d.duration, 1, azimuth(positionAt(v.path, 0)), 64) },
    { label: 'Orbit ↺', path: orbitPath(2.5, d.duration, -1, azimuth(positionAt(v.path, 0)), 64) },
    { label: 'Pass L→R', path: [{ t: 0, x: -4, y: 1 }, { t: d.duration, x: 4, y: 1 }] },
    { label: 'Ahead', path: [{ t: 0, x: 0, y: 2 }] },
  ]

  return (
    <aside className="voices" aria-label="Voices">
      <div className="tools" role="group" aria-label="Path tool">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" aria-pressed={tool === t.id} className="tool" onClick={() => onTool(t.id)}>
            <span>{t.label}</span><small>{t.hint}</small>
          </button>
        ))}
      </div>

      <h2 className="panel-heading">Voices</h2>
      <ul className="voice-list">
        {doc.voices.map((v) => {
          const p = positionAt(v.path, time)
          return (
            <li key={v.id} className={`voice${v.id === selected ? ' is-selected' : ''}`}>
              <button type="button" className="voice__select" aria-pressed={v.id === selected} onClick={() => onSelect(v.id)}>
                <span className="voice__dot" style={{ background: v.color, boxShadow: `0 0 12px ${v.color}` }} />
                <span className="voice__name">{v.name}</span>
                <span className="voice__where mono">{distance(p).toFixed(1)} m · {Math.round(azimuth(p))}°</span>
              </button>
              <div className="voice__row">
                <button type="button" className="chip" aria-pressed={v.mute} onClick={() => actions.patchVoice(v.id, { mute: !v.mute })} aria-label={`Mute ${v.name}`}>M</button>
                <button type="button" className="chip" aria-pressed={v.solo} onClick={() => actions.patchVoice(v.id, { solo: !v.solo })} aria-label={`Solo ${v.name}`}>S</button>
                <label className="gain">
                  <span className="visually-hidden">{v.name} level</span>
                  <input type="range" min={GAIN_LIMITS_DB.min} max={GAIN_LIMITS_DB.max} step={0.5} value={v.gainDb}
                    onChange={(e) => actions.patchVoice(v.id, { gainDb: Number(e.target.value) }, 'preview')}
                    onPointerUp={actions.commit} onKeyUp={actions.commit} onBlur={actions.commit} />
                  <span className="mono">{v.gainDb > 0 ? '+' : ''}{v.gainDb.toFixed(1)} dB</span>
                </label>
              </div>
              <p className="voice__source mono">
                {v.source.kind === 'builtin' ? `${BUILTINS[v.source.id]} · generated` : `${v.source.name} · ${v.source.seconds.toFixed(1)} s`}
                {missing.includes(v.name) && <span className="warn"> · audio missing</span>}
              </p>
            </li>
          )
        })}
      </ul>

      <div className="add">
        {(Object.keys(BUILTINS) as BuiltinId[]).map((id) => (
          <button key={id} type="button" className="text-button" disabled={doc.voices.length >= MAX_VOICES} onClick={() => { const nid = actions.addVoice(id); if (nid) onSelect(nid) }}>
            + {BUILTINS[id]}
          </button>
        ))}
        <button type="button" className="text-button" disabled={doc.voices.length >= MAX_VOICES} onClick={() => { setImportTarget(null); fileInput.current?.click() }}>
          + Audio file…
        </button>
        <input ref={fileInput} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac" hidden data-testid="audio-input"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            try {
              const id = await actions.importAudio(f, importTarget)
              onSelect(id)
            } catch (err) {
              actions.setNotice(err instanceof AudioImportError || err instanceof Error ? err.message : 'Could not open that file.')
            }
          }} />
      </div>

      {voice && (
        <section className="selected" aria-label={`${voice.name} settings`}>
          <h3 className="panel-subheading">{voice.name}</h3>
          <div className="presets" role="group" aria-label="Path presets">
            {presets(voice, doc).map((p) => (
              <button key={p.label} type="button" className="chip chip--wide" onClick={() => actions.patchVoice(voice.id, { path: p.path })}>{p.label}</button>
            ))}
          </div>
          <div className="selected__row">
            <button type="button" className="text-button" onClick={() => { setImportTarget(voice.id); fileInput.current?.click() }}>Replace sound…</button>
            <button type="button" className="text-button text-button--danger" onClick={() => actions.removeVoice(voice.id)}>Remove</button>
          </div>
          <p className="mono muted">{voice.path.length === 1 ? 'Static' : `${voice.path.length} keyframes`}</p>
        </section>
      )}
    </aside>
  )
}
