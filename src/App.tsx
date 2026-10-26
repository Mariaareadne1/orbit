import { useCallback, useEffect, useRef, useState } from 'react'
import { useOrbit } from './state/useOrbit'
import { Stage, type Recording, type Tool } from './ui/Stage'
import { Score } from './ui/Score'
import { Transport } from './ui/Transport'
import { Header } from './ui/Header'
import { ModeTool } from './ui/ModeTool'
import { SourceCard } from './ui/SourceCard'
import { AudioImportError } from './audio/importAudio'
import type { Keyframe } from './audio/path'

const HINT_MS = 4000
const TOOL_KEYS: Record<string, Tool> = { p: 'place', d: 'draw', r: 'perform' }

export default function App() {
  const orbit = useOrbit()
  const { doc, engine, actions, playing } = orbit
  const [selected, setSelected] = useState<string | null>(doc.voices[1]?.id ?? doc.voices[0]?.id ?? null)
  const [cardOpen, setCardOpen] = useState(false)
  const [tool, setTool] = useState<Tool>('place')
  const [time, setTime] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  const [recording, setRecording] = useState<Recording | null>(null)
  /** n changes on every announcement, so the same words twice are still spoken twice */
  const [announcement, setAnnouncement] = useState({ text: '', n: 0 })
  const fileInput = useRef<HTMLInputElement>(null)
  const importTarget = useRef<string | null>(null)

  const onTime = useCallback((t: number) => setTime((prev) => (Math.abs(prev - t) > 0.04 ? t : prev)), [])
  const onPreviewPath = useCallback((id: string, path: Keyframe[]) => actions.patchVoice(id, { path }, 'preview'), [actions])
  const onCommitPath = useCallback((id: string, path: Keyframe[]) => actions.patchVoice(id, { path }), [actions])
  const select = useCallback((id: string, open = true) => {
    setSelected(id)
    if (open) setCardOpen(true)
  }, [])
  const recordingRef = useRef<Recording | null>(null)
  const voicesRef = useRef(doc.voices)
  voicesRef.current = doc.voices
  const announce = useCallback((text: string) => setAnnouncement((a) => ({ text, n: a.n + 1 })), [])
  const onRecording = useCallback((r: Recording | null, seconds?: number) => {
    const prev = recordingRef.current
    recordingRef.current = r
    setRecording(r)
    const name = (id: string) => voicesRef.current.find((v) => v.id === id)?.name ?? 'sound'
    if (r) announce(`Recording ${name(r.id)}`)
    else if (prev) announce(seconds && seconds > 0 ? `Recorded ${seconds.toFixed(1)} seconds of motion for ${name(prev.id)}` : `Nothing recorded for ${name(prev.id)}: hold and move to record`)
  }, [announce])

  useEffect(() => {
    if (!hint) return
    const t = window.setTimeout(() => setHint(null), HINT_MS)
    return () => window.clearTimeout(t)
  }, [hint])

  // The picker's `cancel` event (not in React's input typings): acknowledge it so a closed dialog isn't a mystery.
  useEffect(() => {
    const input = fileInput.current
    const onCancel = () => setHint('Import canceled — nothing changed.')
    input?.addEventListener('cancel', onCancel)
    return () => input?.removeEventListener('cancel', onCancel)
  }, [])

  const openImport = useCallback((target: string | null) => {
    importTarget.current = target
    fileInput.current?.click()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select')) return
      const key = e.key.toLowerCase()
      if (e.key === ' ' && !target.closest('button, [role="button"], [role="slider"]')) {
        e.preventDefault()
        if (playing) actions.pause()
        else void actions.play()
      } else if ((e.metaKey || e.ctrlKey) && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) actions.redo()
        else actions.undo()
      } else if (e.metaKey || e.ctrlKey || e.altKey) {
        return
      } else if (TOOL_KEYS[key]) {
        setTool(TOOL_KEYS[key]!)
      } else if (/^[1-6]$/.test(key)) {
        const v = doc.voices[Number(key) - 1]
        if (v) select(v.id)
      } else if (e.key === 'Escape' && cardOpen) {
        setCardOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions, playing, doc.voices, cardOpen, select])

  useEffect(() => {
    if (selected && !doc.voices.some((v) => v.id === selected)) {
      setSelected(doc.voices[0]?.id ?? null)
      setCardOpen(false)
    }
  }, [doc.voices, selected])

  const index = doc.voices.findIndex((v) => v.id === selected)
  const voice = index >= 0 ? doc.voices[index]! : null
  const recordingName = recording ? doc.voices.find((v) => v.id === recording.id)?.name : null

  return (
    <div className="app">
      <Header orbit={orbit} onImport={() => openImport(null)} />
      {orbit.audio === 'suspended' && playing && (
        <div className="banner" role="alert">
          <p>The browser is holding audio back, so the clock isn’t moving. Start it with a tap or click.</p>
          <button type="button" className="button" onClick={() => void actions.unlockAudio()}>Start audio</button>
        </div>
      )}
      {orbit.notice && (
        <div className="banner" role="alert">
          <p>{orbit.notice}</p>
          <button type="button" className="link" onClick={actions.dismissNotice}>Dismiss</button>
        </div>
      )}
      <main className="theatre">
        <div className="theatre__rail theatre__rail--left">
          <ModeTool tool={tool} playing={playing} hint={hint} onTool={setTool} />
          <aside className="legend" aria-label="How to listen">
            <p className="legend__headphones"><HeadphonesIcon /> Headphones recommended</p>
            <p className="mono">Top of the stage is in front of you. Rings every metre; sound is louder nearer the centre. Sources sit at ear height — no elevation.</p>
          </aside>
        </div>
        <div className={`theatre__stage stage-cell stage-cell--${tool}`}>
          {tool === 'perform' && (
            <p className={`stage-status${recording ? ' is-recording' : playing ? ' is-armed' : ''}`} aria-hidden="true" data-testid="stage-status">
              {recording ? <>● Rec · {recordingName}</> : playing ? 'Perform · armed — hold a sound to record' : 'Perform · press play to arm'}
            </p>
          )}
          <Stage doc={doc} engine={engine} playing={playing} selected={selected} tool={tool}
            onSelect={select} onPreviewPath={onPreviewPath} onCommitPath={onCommitPath} onTime={onTime}
            onRecording={onRecording} onHint={setHint}
            stillTime={playing ? -1 : time} />
        </div>
        <div className="theatre__rail theatre__rail--right">
          {voice && cardOpen ? (
            <SourceCard orbit={orbit} voice={voice} index={index} time={time} onClose={() => setCardOpen(false)} onReplace={(id) => openImport(id)} />
          ) : (
            <p className="card-hint">{voice ? <>Selected: <strong>{voice.name}</strong>. Click it on the stage, or its name in the score, to open its card.</> : 'Click a sound on the stage to open its card.'}</p>
          )}
        </div>
      </main>
      <Score orbit={orbit} time={time} selected={selected} recording={recording} onSelect={select}
        onSeek={(t) => { void actions.seek(t); setTime(t) }} onAddFile={() => openImport(null)}>
        <Transport doc={doc} engine={engine} time={time} playing={playing} announcement={announcement}
          onPlay={() => void actions.play()} onPause={actions.pause} onStop={() => { actions.stop(); setTime(0) }}
          onDuration={(d) => actions.push({ ...doc, duration: d, voices: doc.voices.map((v) => ({ ...v, path: v.path.map((k) => ({ ...k, t: (k.t / doc.duration) * d })) })) })}
          onLoop={(loop) => actions.push({ ...doc, loop })} />
      </Score>
      <input ref={fileInput} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac" hidden data-testid="audio-input"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try {
            const id = await actions.importAudio(f, importTarget.current)
            select(id)
          } catch (err) {
            actions.setNotice(err instanceof AudioImportError || err instanceof Error ? err.message : 'Could not open that file.')
          }
        }} />
    </div>
  )
}

function HeadphonesIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="legend__icon"><path d="M2.5 10V8a5.5 5.5 0 0 1 11 0v2" /><rect x="1.8" y="9.5" width="3" height="4.5" rx="1" /><rect x="11.2" y="9.5" width="3" height="4.5" rx="1" /></svg>
  )
}
