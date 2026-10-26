import { useEffect, useState } from 'react'
import { cleanName, MAX_VOICES } from '../state/document'
import type { Orbit } from '../state/useOrbit'
import { ExportButton } from './ExportButton'

const CONFIRM_MS = 4000

const clock = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function audioLabel(a: Orbit['audio']) {
  return a === 'running' ? 'audio on · 48 kHz' : a === 'suspended' ? 'audio blocked' : a === 'unavailable' ? 'no Web Audio' : 'audio starts on play'
}

export function Header({ orbit, onImport }: { orbit: Orbit; onImport: () => void }) {
  const { doc, actions } = orbit
  const [name, setName] = useState(doc.name)
  const [confirmNew, setConfirmNew] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => setName(doc.name), [doc.name])
  useEffect(() => {
    if (!confirmNew) return
    const t = window.setTimeout(() => setConfirmNew(false), CONFIRM_MS)
    return () => window.clearTimeout(t)
  }, [confirmNew])
  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  const saved = orbit.saveFailed ? 'not saved — storage full' : orbit.dirty ? 'unsaved changes' : orbit.savedAt ? `saved ${clock(orbit.savedAt)}` : 'saved in this browser'
  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled

  return (
    <header className="masthead">
      <div className="brand">
        <span className="brand__mark" aria-hidden="true" />
        <div>
          <p className="wordmark">ORBIT</p>
          <p className="brand__sub mono">Spatial instrument</p>
        </div>
      </div>
      <div className="project">
        <label className="project__name">
          <span className="visually-hidden">Orbit name</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)}
            onBlur={() => (cleanName(name, doc.name) !== doc.name ? actions.push({ ...doc, name: cleanName(name, doc.name) }) : setName(doc.name))}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </label>
        <p className="project__status mono" data-testid="status">
          <span>{doc.voices.length} of {MAX_VOICES} voices</span>
          <span>{doc.duration} s{doc.loop ? ' · loop' : ''}</span>
          <span className={orbit.saveFailed ? 'warn' : undefined}>{saved}</span>
          <span className={orbit.audio === 'suspended' || orbit.audio === 'unavailable' ? 'warn' : undefined}>{audioLabel(orbit.audio)}</span>
        </p>
      </div>
      <div className="masthead__actions">
        <div className="history" role="group" aria-label="History">
          <button type="button" className="icon-button" aria-label="Undo" aria-keyshortcuts="Meta+Z Control+Z" disabled={!orbit.canUndo} onClick={actions.undo}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 4 2 7l3 3M2 7h7a4 4 0 0 1 0 8H7" /></svg>
          </button>
          <button type="button" className="icon-button" aria-label="Redo" aria-keyshortcuts="Shift+Meta+Z Shift+Control+Z" disabled={!orbit.canRedo} onClick={actions.redo}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m11 4 3 3-3 3M14 7H7a4 4 0 0 0 0 8h2" /></svg>
          </button>
        </div>
        {confirmNew ? (
          <span className="confirm" role="group" aria-label="Start a new orbit?">
            <button type="button" className="link link--danger" onClick={() => { setConfirmNew(false); actions.newOrbit() }}>Replace with new orbit</button>
            <button type="button" className="link" onClick={() => setConfirmNew(false)}>Keep</button>
          </span>
        ) : (
          <button type="button" className="link" onClick={() => setConfirmNew(true)}>New</button>
        )}
        <button type="button" className="button" onClick={onImport} disabled={doc.voices.length >= MAX_VOICES} title="Add a sound from an audio file on this device">Import</button>
        <button type="button" className="button" onClick={() => actions.saveNow()}>Save</button>
        <ExportButton doc={doc} engine={orbit.engine} />
        {canFullscreen && (
          <button type="button" className="icon-button" aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} aria-pressed={fullscreen}
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d={fullscreen ? 'M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4' : 'M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4'} /></svg>
          </button>
        )}
      </div>
    </header>
  )
}
