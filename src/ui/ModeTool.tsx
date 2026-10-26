import type { Tool } from './Stage'

const MODES: Array<{ id: Tool; label: string; key: string; hint: (playing: boolean) => string }> = [
  { id: 'place', label: 'Place', key: 'P', hint: () => 'Drag a sound to a fixed spot, or click empty floor to move the selected one there. Arrow keys nudge.' },
  { id: 'draw', label: 'Draw', key: 'D', hint: () => 'Sketch a path for the selected sound. The stroke is spread evenly across the whole piece.' },
  {
    id: 'perform', label: 'Perform', key: 'R',
    hint: (playing) => (playing ? 'Hold a sound and move it: your motion is recorded against the music and replaces that stretch.' : 'Press play, then hold a sound and move it to record its motion live.'),
  },
]

interface ModeToolProps {
  tool: Tool
  playing: boolean
  /** a transient message (e.g. why a gesture did nothing) that replaces the mode hint */
  hint: string | null
  onTool: (t: Tool) => void
}

export function ModeTool({ tool, playing, hint, onTool }: ModeToolProps) {
  const mode = MODES.find((m) => m.id === tool)!
  return (
    <div className="mode">
      <div className="mode__switch" role="group" aria-label="Gesture mode">
        {MODES.map((m) => (
          <button key={m.id} type="button" className={`mode__button mode__button--${m.id}`} aria-pressed={tool === m.id}
            aria-keyshortcuts={m.key} title={`${m.label} (${m.key})`} onClick={() => onTool(m.id)}>
            <ModeIcon tool={m.id} />
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <p className="mode__hint" aria-live="polite" data-testid="mode-hint">{hint ?? mode.hint(playing)}</p>
    </div>
  )
}

function ModeIcon({ tool }: { tool: Tool }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="mode__icon">
      {tool === 'place' && <><circle cx="8" cy="8" r="3" /><path d="M8 1v3M8 12v3M1 8h3M12 8h3" /></>}
      {tool === 'draw' && <path d="M2 12c2-6 4 2 6-3s3-5 6-6" />}
      {tool === 'perform' && <><circle cx="8" cy="8" r="2.5" className="fill" /><circle cx="8" cy="8" r="6" /></>}
    </svg>
  )
}
