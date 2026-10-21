import { useCallback, useEffect, useState } from 'react'
import { useOrbit } from './state/useOrbit'
import { Stage, type Tool } from './ui/Stage'
import { Timeline } from './ui/Timeline'
import { Voices } from './ui/Voices'
import { ExportButton } from './ui/ExportButton'
import { cleanName } from './state/document'
import type { Keyframe } from './audio/path'

export default function App() {
  const orbit = useOrbit()
  const { doc, engine, actions, playing } = orbit
  const [selected, setSelected] = useState<string | null>(doc.voices[1]?.id ?? doc.voices[0]?.id ?? null)
  const [tool, setTool] = useState<Tool>('draw')
  const [time, setTime] = useState(0)
  const [name, setName] = useState(doc.name)
  useEffect(() => setName(doc.name), [doc.name])

  const onTime = useCallback((t: number) => setTime((prev) => (Math.abs(prev - t) > 0.04 ? t : prev)), [])
  const onPreviewPath = useCallback((id: string, path: Keyframe[]) => actions.patchVoice(id, { path }, 'preview'), [actions])
  const onCommitPath = useCallback((id: string, path: Keyframe[]) => actions.patchVoice(id, { path }), [actions])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [role="application"]')) return
      if (e.key === ' ') {
        e.preventDefault()
        if (playing) actions.pause()
        else void actions.play()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) actions.redo()
        else actions.undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions, playing])

  useEffect(() => {
    if (selected && !doc.voices.some((v) => v.id === selected)) setSelected(doc.voices[0]?.id ?? null)
  }, [doc.voices, selected])

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="wordmark">orbit</span>
          <span className="brand__note mono">spatial audio choreography · use headphones</span>
        </div>
        <label className="doc-name">
          <span className="visually-hidden">Orbit name</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)}
            onBlur={() => (cleanName(name, doc.name) !== doc.name ? actions.push({ ...doc, name: cleanName(name, doc.name) }) : setName(doc.name))}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </label>
        <div className="top__actions">
          <button type="button" className="icon" aria-label="Undo" disabled={!orbit.canUndo} onClick={actions.undo}>↶</button>
          <button type="button" className="icon" aria-label="Redo" disabled={!orbit.canRedo} onClick={actions.redo}>↷</button>
          <button type="button" className="text-button" onClick={actions.newOrbit}>New</button>
          <ExportButton doc={doc} engine={engine} />
        </div>
      </header>
      {orbit.notice && (
        <div className="banner" role="alert">
          <p>{orbit.notice}</p>
          <button type="button" className="text-button" onClick={actions.dismissNotice}>Dismiss</button>
        </div>
      )}
      <main className="observatory">
        <Stage doc={doc} engine={engine} playing={playing} selected={selected} tool={tool}
          onSelect={setSelected} onPreviewPath={onPreviewPath} onCommitPath={onCommitPath} onTime={onTime}
          stillTime={playing ? -1 : time} />
        <Voices orbit={orbit} selected={selected} tool={tool} time={time} onSelect={setSelected} onTool={setTool} />
      </main>
      <Timeline doc={doc} time={time} playing={playing} selected={selected}
        onSeek={(t) => { void actions.seek(t); setTime(t) }}
        onPlay={() => void actions.play()} onPause={actions.pause} onStop={() => { actions.stop(); setTime(0) }}
        onDuration={(d) => actions.push({ ...doc, duration: d, voices: doc.voices.map((v) => ({ ...v, path: v.path.map((k) => ({ ...k, t: (k.t / doc.duration) * d })) })) })}
        onLoop={(loop) => actions.push({ ...doc, loop })}
        onSelect={setSelected} />
    </div>
  )
}
