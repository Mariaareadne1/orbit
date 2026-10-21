import { describe, expect, it } from 'vitest'
import { mergeRecording, strokeToPath } from '../../src/ui/Stage'
import { positionAt } from '../../src/audio/path'

describe('mergeRecording', () => {
  it('a static voice holds still until the recording starts (no drift)', () => {
    const merged = mergeRecording([{ t: 0, x: 1, y: 2 }], [{ t: 5, x: -1, y: 0 }, { t: 6, x: 0, y: 0 }])
    expect(positionAt(merged, 2.5)).toEqual({ x: 1, y: 2 })
    expect(positionAt(merged, 4.9)).toEqual({ x: 1, y: 2 })
    expect(positionAt(merged, 5.5).x).toBeCloseTo(-0.5)
  })
  it('the path resumes where it would have been after the recording', () => {
    const path = [{ t: 0, x: -4, y: 1 }, { t: 10, x: 4, y: 1 }]
    const merged = mergeRecording(path, [{ t: 2, x: 0, y: -2 }, { t: 3, x: 0, y: -2 }])
    expect(positionAt(merged, 3.002).x).toBeCloseTo(positionAt(path, 3).x, 1)
    expect(positionAt(merged, 8).x).toBeCloseTo(positionAt(path, 8).x, 6)
    expect(positionAt(merged, 8).y).toBeCloseTo(positionAt(path, 8).y, 6)
  })
})

describe('strokeToPath', () => {
  it('spreads a stroke evenly over the piece and ignores taps', () => {
    const p = strokeToPath([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }], 10, 4)
    expect(p.map((k) => k.t)).toEqual([0, 2.5, 5, 7.5, 10])
    expect(p.map((k) => k.x)).toEqual([0, 1, 2, 3, 4])
    expect(strokeToPath([{ x: 0, y: 0 }, { x: 0.01, y: 0 }], 10)).toEqual([])
  })
})
