/**
 * Coordinate conventions — one place, used by the stage, the audio graph and
 * the tests.
 *
 * Web Audio (right-handed): the listener sits at the origin facing −Z with +Y
 * up, so +X is to the listener's right and −Z is straight ahead.
 *
 * Stage (top-down view, metres): the listener is at the centre; `x` is to the
 * right and `y` is forward (up on screen). Elevation is not used — sources stay
 * at ear height (audio y = 0).
 *
 *   stage (x, y)  →  audio (x, 0, −y)
 *   azimuth: 0° = straight ahead, +90° = right, ±180° = behind
 */
export interface StagePoint {
  x: number
  y: number
}

export interface AudioPoint {
  x: number
  y: number
  z: number
}

export function stageToAudio(p: StagePoint): AudioPoint {
  return { x: p.x, y: 0, z: -p.y }
}

export function audioToStage(p: AudioPoint): StagePoint {
  return { x: p.x, y: -p.z }
}

/** Degrees clockwise from straight ahead, in (−180, 180]. */
export function azimuth(p: StagePoint): number {
  const deg = (Math.atan2(p.x, p.y) * 180) / Math.PI
  return deg <= -180 ? deg + 360 : deg
}

export function distance(p: StagePoint): number {
  return Math.hypot(p.x, p.y)
}

/** Screen pixels ↔ stage metres for a stage centred at (cx, cy) with `scale` px per metre. */
export function screenToStage(px: number, py: number, cx: number, cy: number, scale: number): StagePoint {
  return { x: (px - cx) / scale, y: (cy - py) / scale }
}

export function stageToScreen(p: StagePoint, cx: number, cy: number, scale: number): { px: number; py: number } {
  return { px: cx + p.x * scale, py: cy - p.y * scale }
}

/** Keep a point inside the stage radius. */
export function clampToRadius(p: StagePoint, radius: number): StagePoint {
  const d = distance(p)
  return d <= radius ? p : { x: (p.x / d) * radius, y: (p.y / d) * radius }
}
