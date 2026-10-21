import { describe, expect, it } from 'vitest'
import { audioToStage, azimuth, clampToRadius, distance, screenToStage, stageToAudio, stageToScreen } from '../../src/audio/coords'
import { orbitPath, positionAt, remaining } from '../../src/audio/path'
import { countClipped, db, highBandDb, monotonicFraction, peak, rms, windows } from '../../src/audio/analysis'
import { decodeWav, encodeWav } from '../../src/audio/wav'
import { drone, pinkNoise, plucks } from '../../src/audio/signals'

describe('coordinate conventions', () => {
  it('stage forward is audio −Z, stage right is audio +X', () => {
    expect(stageToAudio({ x: 0, y: 2 })).toEqual({ x: 0, y: 0, z: -2 })
    expect(stageToAudio({ x: 3, y: 0 })).toEqual({ x: 3, y: 0, z: -0 })
    expect(audioToStage(stageToAudio({ x: -1.5, y: 0.25 }))).toEqual({ x: -1.5, y: 0.25 })
  })
  it('azimuth: 0 ahead, +90 right, −90 left, 180 behind', () => {
    expect(azimuth({ x: 0, y: 1 })).toBeCloseTo(0)
    expect(azimuth({ x: 1, y: 0 })).toBeCloseTo(90)
    expect(azimuth({ x: -1, y: 0 })).toBeCloseTo(-90)
    expect(azimuth({ x: 0, y: -1 })).toBeCloseTo(180)
  })
  it('screen ↔ stage: up on screen is forward', () => {
    expect(screenToStage(200, 100, 200, 200, 50)).toEqual({ x: 0, y: 2 })
    const p = { x: 1.2, y: -0.8 }
    const s = stageToScreen(p, 300, 300, 40)
    const back = screenToStage(s.px, s.py, 300, 300, 40)
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  })
  it('clamps to the stage radius without changing direction', () => {
    const c = clampToRadius({ x: 6, y: 8 }, 5)
    expect(distance(c)).toBeCloseTo(5)
    expect(azimuth(c)).toBeCloseTo(azimuth({ x: 6, y: 8 }))
  })
})

describe('paths', () => {
  const path = [{ t: 0, x: -4, y: 1 }, { t: 2, x: 0, y: 1 }, { t: 4, x: 4, y: 1 }]
  it('interpolates linearly and holds the ends', () => {
    expect(positionAt(path, 1)).toEqual({ x: -2, y: 1 })
    expect(positionAt(path, -1)).toEqual({ x: -4, y: 1 })
    expect(positionAt(path, 9)).toEqual({ x: 4, y: 1 })
    expect(remaining(path, 1).map((k) => k.t)).toEqual([2, 4])
  })
  it('orbit paths stay on their radius and complete the turn', () => {
    const o = orbitPath(2, 8, 1, 0, 32)
    for (const k of o) expect(distance(k)).toBeCloseTo(2)
    expect(azimuth(o[8]!)).toBeCloseTo(90)
    expect(o[o.length - 1]!.t).toBe(8)
  })
})

describe('analysis', () => {
  it('rms, dB and windows', () => {
    const s = new Float32Array(48000).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000))
    expect(rms(s)).toBeCloseTo(Math.SQRT1_2, 3)
    expect(db(0.5)).toBeCloseTo(-6.02, 2)
    const w = windows(s, s.map((v) => v * 2), 48000, 0.1)
    expect(w).toHaveLength(10)
    for (const x of w) expect(x.balanceDb).toBeCloseTo(6.02, 1)
  })
  it('high-band share separates bright from dark signals', () => {
    const sr = 48000
    const low = new Float32Array(sr).map((_, i) => Math.sin((2 * Math.PI * 200 * i) / sr))
    const high = new Float32Array(sr).map((_, i) => Math.sin((2 * Math.PI * 8000 * i) / sr))
    expect(highBandDb(low, sr)).toBeLessThan(-30)
    expect(highBandDb(high, sr)).toBeGreaterThan(-1)
  })
  it('monotonic fraction and clipping', () => {
    expect(monotonicFraction([1, 2, 2, 3], 1)).toBe(1)
    expect(monotonicFraction([3, 2, 4], 1)).toBe(0.5)
    expect(countClipped([0.2, 1, -1.2, 0.99])).toBe(2)
    expect(peak([0.1, -0.7, 0.3])).toBeCloseTo(0.7)
  })
})

describe('signals and WAV', () => {
  it('signals are deterministic, bounded and the right length', () => {
    const a = pinkNoise(0.5, 48000, 7)
    expect(a).toEqual(pinkNoise(0.5, 48000, 7))
    expect(a).not.toEqual(pinkNoise(0.5, 48000, 8))
    expect(a.length).toBe(24000)
    expect(peak(a)).toBeCloseTo(0.5, 5)
    expect(peak(plucks(1, 48000))).toBeLessThanOrEqual(0.5)
    expect(peak(drone(1, 48000))).toBeLessThanOrEqual(0.4)
  })
  it('WAV round-trips with a correct header and reports clipping', () => {
    const l = new Float32Array([0, 0.5, -0.5, 1.5])
    const r = new Float32Array([0.25, -0.25, 0, -2])
    const { bytes, clipped } = encodeWav([l, r], 44100)
    expect(clipped).toBe(2)
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE')
    expect(bytes.length).toBe(44 + 4 * 2 * 2)
    const d = decodeWav(bytes)
    expect(d.sampleRate).toBe(44100)
    expect(d.channels[0]![1]).toBeCloseTo(0.5, 3)
    expect(d.channels[1]![3]).toBe(-1)
  })
})
