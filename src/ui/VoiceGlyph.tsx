import type { VoiceDoc } from '../state/document'
import { shapeOf, shapePath } from './identity'

/** The voice's shape in its colour: the same identity as its marker on the stage. */
export function VoiceGlyph({ voice, index, size = 14 }: { voice: VoiceDoc; index: number; size?: number }) {
  return (
    <svg viewBox="-10 -10 20 20" width={size} height={size} aria-hidden="true" className="glyph">
      <path d={shapePath(shapeOf(voice, index), 8)} style={{ fill: voice.mute ? 'none' : voice.color, stroke: voice.color }} />
    </svg>
  )
}
