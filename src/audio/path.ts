import type { StagePoint } from './coords'

/** A position at a time (seconds from the start of the piece). */
export interface Keyframe extends StagePoint {
  t: number
}

/**
 * Position on a piecewise-linear path at time t; holds the first/last point
 * outside the path's span. The audio graph schedules the same segments with
 * linearRampToValueAtTime, so drawing and sound agree by construction.
 */
export function positionAt(path: readonly Keyframe[], t: number): StagePoint {
  if (path.length === 0) return { x: 0, y: 1 }
  if (t <= path[0]!.t) return { x: path[0]!.x, y: path[0]!.y }
  for (let i = 1; i < path.length; i++) {
    const b = path[i]!
    if (t <= b.t) {
      const a = path[i - 1]!
      const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t)
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
    }
  }
  const last = path[path.length - 1]!
  return { x: last.x, y: last.y }
}

/** Keyframes strictly after `t`, for re-scheduling after a seek. */
export function remaining(path: readonly Keyframe[], t: number): Keyframe[] {
  return path.filter((k) => k.t > t)
}

/** A circle around the listener, `turns` times over `seconds`, starting at `startDeg` (0 = ahead). */
export function orbitPath(radius: number, seconds: number, turns = 1, startDeg = 0, steps = 64): Keyframe[] {
  const out: Keyframe[] = []
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    const a = ((startDeg + 360 * turns * f) * Math.PI) / 180
    out.push({ t: seconds * f, x: radius * Math.sin(a), y: radius * Math.cos(a) })
  }
  return out
}
