import { useEffect, useRef, useState } from 'react'
import { DURATION_LIMITS, type OrbitDoc } from '../state/document'
import type { OrbitEngine } from '../audio/engine'
import { Meter } from './Meter'
import { fmtTime } from './format'

interface TransportProps {
  doc: OrbitDoc
  engine: OrbitEngine
  time: number
  playing: boolean
  /** latest event worth announcing to screen readers (recording start/stop etc.) */
  announcement: { text: string; n: number }
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onLoop: (loop: boolean) => void
  onDuration: (d: number) => void
}

export function Transport({ doc, engine, time, playing, announcement, onPlay, onPause, onStop, onLoop, onDuration }: TransportProps) {
  const [lengthDraft, setLengthDraft] = useState<string | null>(null)
  const [lengthError, setLengthError] = useState<string | null>(null)
  useEffect(() => setLengthDraft(null), [doc.duration])
  const applyLength = () => {
    if (lengthDraft === null) return
    const v = Number(lengthDraft)
    if (lengthDraft.trim() !== '' && Number.isFinite(v) && v >= DURATION_LIMITS.min && v <= DURATION_LIMITS.max) {
      setLengthError(null)
      onDuration(Math.round(v))
    } else {
      setLengthError(`Length must be ${DURATION_LIMITS.min}–${DURATION_LIMITS.max} s; kept ${doc.duration} s.`)
    }
    setLengthDraft(null)
  }

  // Spoken status: play/pause and loop changes, plus whatever the editor announces.
  const [spoken, setSpoken] = useState('')
  const timeRef = useRef(time)
  timeRef.current = time
  const prev = useRef({ playing, loop: doc.loop })
  useEffect(() => {
    if (prev.current.playing !== playing) setSpoken(playing ? `Playing from ${fmtTime(timeRef.current)}${doc.loop ? ', looping' : ''}` : `Paused at ${fmtTime(timeRef.current)}`)
    else if (prev.current.loop !== doc.loop) setSpoken(doc.loop ? 'Loop on' : 'Loop off')
    prev.current = { playing, loop: doc.loop }
  }, [playing, doc.loop])
  useEffect(() => {
    if (announcement.text) setSpoken(`${announcement.text}${'\u200b'.repeat(announcement.n % 2)}`)
  }, [announcement])

  return (
    <div className="transport" aria-label="Transport" role="group">
      <div className="transport__main">
        <button type="button" className="transport__stop" onClick={onStop} aria-label="Stop and return to start">
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1" /></svg>
        </button>
        <button type="button" className={`transport__play${playing ? ' is-playing' : ''}`} onClick={playing ? onPause : onPlay} aria-label={playing ? 'Pause' : 'Play'} data-testid="play">
          {playing ? <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="3" height="10" rx="0.5" /><rect x="9" y="3" width="3" height="10" rx="0.5" /></svg>
            : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3 13 8 5 13z" /></svg>}
        </button>
        <label className={`switch${doc.loop ? ' is-on' : ''}`}>
          <input type="checkbox" role="switch" checked={doc.loop} onChange={(e) => onLoop(e.target.checked)} />
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 7a4 4 0 0 1 4-4h5l-2-2M13 9a4 4 0 0 1-4 4H4l2 2" /></svg>
          <span>Loop</span>
        </label>
        {/* Not a live region: it changes ten times a second; the playhead slider carries the time for assistive tech. */}
        <span className="clock mono" data-testid="clock" aria-hidden="true">
          <span className="clock__now">{fmtTime(time)}</span><span className="clock__total"> / {fmtTime(doc.duration)}</span>
        </span>
      </div>
      <div className="transport__side">
        <label className={`length${lengthError ? ' has-error' : ''}`}>
          <span>Length</span>
          <input type="number" inputMode="numeric" min={DURATION_LIMITS.min} max={DURATION_LIMITS.max} step={1} value={lengthDraft ?? doc.duration}
            aria-label={`Length in seconds, ${DURATION_LIMITS.min} to ${DURATION_LIMITS.max}`}
            aria-invalid={lengthError ? true : undefined} aria-describedby={lengthError ? 'length-error' : undefined}
            onChange={(e) => { setLengthDraft(e.target.value); setLengthError(null) }}
            onBlur={applyLength}
            onKeyDown={(e) => { if (e.key === 'Enter') applyLength(); if (e.key === 'Escape') { setLengthDraft(null); setLengthError(null) } }} />
          <span className="mono">s</span>
        </label>
        {lengthError && <span id="length-error" className="length__error" role="alert">{lengthError}</span>}
        <Meter engine={engine} playing={playing} />
      </div>
      <p className="visually-hidden" aria-live="polite" data-testid="announcer">{spoken}</p>
    </div>
  )
}
