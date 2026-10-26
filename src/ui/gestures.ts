import type { StagePoint } from '../audio/coords'
import { positionAt, type Keyframe } from '../audio/path'

/** Resample a freehand stroke to evenly spaced keyframes across the piece. */
export function strokeToPath(points: StagePoint[], duration: number, count = 96): Keyframe[] {
  if (points.length < 2) return []
  const lengths = [0]
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y))
  const total = lengths[lengths.length - 1]!
  if (total < 0.2) return []
  const out: Keyframe[] = []
  let j = 1
  for (let i = 0; i <= count; i++) {
    const target = (total * i) / count
    while (j < lengths.length - 1 && lengths[j]! < target) j++
    const a = points[j - 1]!
    const b = points[j]!
    const span = lengths[j]! - lengths[j - 1]!
    const f = span > 0 ? (target - lengths[j - 1]!) / span : 0
    out.push({ t: +((duration * i) / count).toFixed(4), x: +(a.x + (b.x - a.x) * f).toFixed(3), y: +(a.y + (b.y - a.y) * f).toFixed(3) })
  }
  return out
}

/** Replace the part of `path` between the first and last recorded times with the recording. */
export function mergeRecording(path: readonly Keyframe[], rec: readonly Keyframe[]): Keyframe[] {
  if (rec.length === 0) return [...path]
  const t0 = rec[0]!.t
  const t1 = rec[rec.length - 1]!.t
  const before = path.filter((k) => k.t < t0)
  const after = path.filter((k) => k.t > t1)
  // Hold the old path's position right up to the recording, and resume it right
  // after, so the untouched stretches don't drift toward the recorded points.
  const lastBefore = before[before.length - 1]
  const anchorBefore = t0 > 0.002 && (!lastBefore || lastBefore.t < t0 - 0.002) ? [{ t: t0 - 0.001, ...positionAt(path, t0 - 0.001) }] : []
  const firstAfter = after[0]
  const anchorAfter = firstAfter && firstAfter.t > t1 + 0.002 ? [{ t: t1 + 0.001, ...positionAt(path, t1 + 0.001) }] : []
  return [...before, ...anchorBefore, ...rec, ...anchorAfter, ...after]
}
