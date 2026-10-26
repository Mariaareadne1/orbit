import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { commit, createHistory, preview, push, redo, reset, undo, type History } from './history'
import { COLORS, defaultDoc, MAX_VOICES, newId, type BuiltinId, type OrbitDoc, type VoiceDoc } from './document'
import { files, loadDoc, saveDoc } from './storage'
import { OrbitEngine, type AudioState } from '../audio/engine'
import { decodeAudioFile } from '../audio/importAudio'
import { registerDebug } from '../debug'

const STORAGE_FULL = 'Browser storage is full; this orbit is not being saved. Free some space, then press Save.'

type Action =
  | { type: 'preview'; doc: OrbitDoc }
  | { type: 'push'; doc: OrbitDoc }
  | { type: 'commit' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; doc: OrbitDoc }

const same = (a: OrbitDoc, b: OrbitDoc) => JSON.stringify(a) === JSON.stringify(b)

function reducer(h: History<OrbitDoc>, a: Action): History<OrbitDoc> {
  switch (a.type) {
    case 'preview':
      return preview(h, a.doc)
    case 'push':
      return same(a.doc, h.present) ? commit(h, same) : push(commit(h, same), a.doc)
    case 'commit':
      return commit(h, same)
    case 'undo':
      return undo(h)
    case 'redo':
      return redo(h)
    case 'reset':
      return reset(a.doc)
  }
}

export function useOrbit() {
  const [boot] = useState(loadDoc)
  const [history, dispatch] = useReducer(reducer, undefined, () => createHistory(boot.status === 'ok' ? boot.doc : defaultDoc()))
  const doc = history.present
  const [engine] = useState(() => new OrbitEngine())
  const [notice, setNotice] = useState<string | null>(
    boot.status === 'unreadable' ? `Your saved orbit couldn’t be read (${boot.reason}). A copy was kept in this browser; starting fresh.` : null,
  )
  const [audio, setAudio] = useState<AudioState>('off')
  /** when the document was last written to storage; null = not yet this session */
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  /** voice ids whose imported audio could not be restored */
  const [missing, setMissing] = useState<string[]>([])
  const [playing, setPlaying] = useState(false)
  const initial = useRef(doc)
  const latest = useRef(doc)
  latest.current = doc
  /** the last document written to storage (the loaded one counts as written) */
  const lastSaved = useRef<OrbitDoc | null>(boot.status === 'ok' ? doc : null)

  // Restore imported audio from IndexedDB.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const lost: VoiceDoc[] = []
      const referenced = new Set(initial.current.voices.flatMap((v) => (v.source.kind === 'file' ? [v.source.blobId] : [])))
      // Files no saved voice uses (removed or replaced in an earlier session) are deleted
      // here, at boot, when no undo history can still refer to them.
      try {
        for (const key of await files.keys()) if (!referenced.has(String(key))) await files.remove(String(key))
      } catch {
        // storage unavailable: nothing to clean
      }
      for (const v of initial.current.voices) {
        if (cancelled) return
        if (v.source.kind !== 'file' || engine.bank.hasFile(v.source.blobId)) continue
        try {
          const bytes = await files.get(v.source.blobId)
          if (!bytes) throw new Error('missing')
          engine.bank.addFile(v.source.blobId, await decodeAudioFile(bytes))
        } catch {
          lost.push(v)
        }
      }
      if (!cancelled && lost.length) {
        setMissing(lost.map((v) => v.id))
        setNotice(`Audio for ${lost.map((v) => v.name).join(', ')} isn’t in this browser’s storage any more; those voices are silent until you replace their sound.`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [engine])

  /** Write to storage and report the outcome; a success after a failure clears the warning. */
  const write = useCallback((d: OrbitDoc) => {
    if (saveDoc(d)) {
      lastSaved.current = d
      setSavedAt(new Date())
      setSaveFailed(false)
      setNotice((n) => (n === STORAGE_FULL ? null : n))
      return true
    }
    setSaveFailed(true)
    setNotice(STORAGE_FULL)
    return false
  }, [])

  // Autosave once something changed; never during a gesture.
  const gestureOpen = history.gestureStart !== null
  useEffect(() => {
    if (gestureOpen || doc === lastSaved.current || (lastSaved.current === null && doc === initial.current)) return
    const t = window.setTimeout(() => write(doc), 300)
    return () => window.clearTimeout(t)
  }, [doc, gestureOpen, write])

  // Flush when the page is hidden so an edit inside the save delay survives a close.
  useEffect(() => {
    const flush = () => {
      if (latest.current !== lastSaved.current && latest.current !== initial.current && saveDoc(latest.current)) lastSaved.current = latest.current
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  // Keep the engine on the latest document while playing.
  useEffect(() => {
    engine.update(doc)
  }, [engine, doc])

  useEffect(() => {
    engine.onEnded = () => setPlaying(false)
    engine.onStateChange = setAudio
    return () => {
      engine.onStateChange = null
      void engine.dispose()
    }
  }, [engine])

  // Coming back to the tab: browsers (iOS especially) may have suspended the context.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && engine.context && engine.audioState !== 'running') void engine.ensureContext()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [engine])

  useEffect(() => registerDebug({ engine, doc: () => latest.current }), [engine])

  const patchVoice = useCallback((id: string, patch: Partial<VoiceDoc>, mode: 'push' | 'preview' = 'push') => {
    const d = latest.current
    dispatch({ type: mode, doc: { ...d, voices: d.voices.map((v) => (v.id === id ? { ...v, ...patch } : v)) } })
  }, [])

  const actions = useMemo(
    () => ({
      preview: (d: OrbitDoc) => dispatch({ type: 'preview', doc: d }),
      push: (d: OrbitDoc) => dispatch({ type: 'push', doc: d }),
      commit: () => dispatch({ type: 'commit' }),
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
      patchVoice,
      play: async () => {
        try {
          await engine.play(latest.current)
        } catch {
          setAudio('unavailable')
          setNotice('This browser could not start Web Audio, so nothing can play here. Export WAV still works.')
          return
        }
        setPlaying(engine.playing)
      },
      /** Retry starting audio after the browser refused (must run inside a user gesture). */
      unlockAudio: async () => {
        await engine.ensureContext()
      },
      saveNow: () => write(latest.current),
      pause: () => {
        engine.pause()
        setPlaying(false)
      },
      stop: () => {
        engine.stop()
        setPlaying(false)
      },
      seek: (t: number) => engine.seek(latest.current, t),
      addVoice: (builtin: BuiltinId) => {
        const d = latest.current
        if (d.voices.length >= MAX_VOICES) return
        const used = new Set(d.voices.map((v) => v.color))
        const color = COLORS.find((c) => !used.has(c)) ?? COLORS[d.voices.length % COLORS.length]!
        const angle = (d.voices.length * 72 * Math.PI) / 180
        const voice: VoiceDoc = {
          id: newId(), name: { drone: 'Drone', plucks: 'Plucks', pulse: 'Pulse' }[builtin], color,
          source: { kind: 'builtin', id: builtin }, gainDb: -6, mute: false, solo: false,
          path: [{ t: 0, x: +(2.5 * Math.sin(angle)).toFixed(2), y: +(2.5 * Math.cos(angle)).toFixed(2) }],
        }
        dispatch({ type: 'push', doc: { ...d, voices: [...d.voices, voice] } })
        return voice.id
      },
      removeVoice: (id: string) => {
        const d = latest.current
        dispatch({ type: 'push', doc: { ...d, voices: d.voices.filter((v) => v.id !== id) } })
      },
      /** Import an audio file as the sound of a voice (new voice if id is null). */
      importAudio: async (file: File, id: string | null) => {
        const bytes = await file.arrayBuffer()
        const mono = await decodeAudioFile(bytes) // throws AudioImportError
        const blobId = newId()
        engine.bank.addFile(blobId, mono)
        try {
          await files.put(blobId, bytes)
        } catch {
          setNotice('The audio is loaded but could not be stored in this browser; it won’t survive a reload.')
        }
        const source = { kind: 'file' as const, blobId, name: file.name.slice(0, 40), seconds: mono.length / 48000 }
        const d = latest.current
        if (id) {
          patchVoice(id, { source, name: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || 'Audio' })
          setMissing((m) => m.filter((x) => x !== id))
          return id
        }
        if (d.voices.length >= MAX_VOICES) throw new Error(`An orbit holds at most ${MAX_VOICES} voices.`)
        const used = new Set(d.voices.map((v) => v.color))
        const voice: VoiceDoc = {
          id: newId(), name: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || 'Audio',
          color: COLORS.find((c) => !used.has(c)) ?? COLORS[0]!, source, gainDb: -6, mute: false, solo: false,
          path: [{ t: 0, x: 0, y: 2 }],
        }
        dispatch({ type: 'push', doc: { ...d, voices: [...d.voices, voice] } })
        return voice.id
      },
      newOrbit: () => {
        engine.stop()
        setPlaying(false)
        dispatch({ type: 'reset', doc: defaultDoc() })
      },
      dismissNotice: () => setNotice(null),
      setNotice,
    }),
    [engine, patchVoice, write],
  )

  return {
    doc,
    engine,
    playing,
    audio,
    savedAt,
    saveFailed,
    dirty: doc !== lastSaved.current && !(lastSaved.current === null && doc === initial.current),
    notice,
    missing,
    canUndo: history.past.length > 0 || gestureOpen,
    canRedo: history.future.length > 0,
    actions,
  }
}

export type Orbit = ReturnType<typeof useOrbit>
