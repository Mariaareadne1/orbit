/** Measurements on rendered audio. Pure; used in the app, unit tests and browser tests. */

export interface Window {
  t: number
  rmsL: number
  rmsR: number
  /** right minus left level in dB (positive = louder on the right) */
  balanceDb: number
}

const DB_FLOOR = 1e-9

export function rms(x: ArrayLike<number>, start = 0, end = x.length): number {
  let s = 0
  for (let i = start; i < end; i++) s += x[i]! * x[i]!
  return Math.sqrt(s / Math.max(1, end - start))
}

export function db(ratio: number): number {
  return 20 * Math.log10(Math.max(DB_FLOOR, ratio))
}

/** Per-window left/right RMS and balance. */
export function windows(left: Float32Array, right: Float32Array, sampleRate: number, windowSeconds = 0.1): Window[] {
  const size = Math.max(1, Math.round(windowSeconds * sampleRate))
  const out: Window[] = []
  for (let start = 0; start + size <= left.length; start += size) {
    const l = rms(left, start, start + size)
    const r = rms(right, start, start + size)
    out.push({ t: (start + size / 2) / sampleRate, rmsL: l, rmsR: r, balanceDb: db((r + DB_FLOOR) / (l + DB_FLOOR)) })
  }
  return out
}

export function peak(x: ArrayLike<number>): number {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]!))
  return m
}

export function countClipped(x: ArrayLike<number>, limit = 1): number {
  let n = 0
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]!) >= limit) n++
  return n
}

/** RBJ biquad high-pass, applied in place to a copy. */
export function highpass(x: Float32Array, sampleRate: number, cutoff: number, q = Math.SQRT1_2): Float32Array {
  const w0 = (2 * Math.PI * cutoff) / sampleRate
  const alpha = Math.sin(w0) / (2 * q)
  const cos = Math.cos(w0)
  const a0 = 1 + alpha
  const b0 = (1 + cos) / 2 / a0
  const b1 = -(1 + cos) / a0
  const b2 = (1 + cos) / 2 / a0
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  const y = new Float32Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i]! + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x[i]!
    y2 = y1
    y1 = v
    y[i] = v
  }
  return y
}

/** Share of energy above `cutoff` Hz, in dB relative to the whole signal. */
export function highBandDb(x: Float32Array, sampleRate: number, cutoff = 4000): number {
  return db(rms(highpass(x, sampleRate, cutoff)) / Math.max(DB_FLOOR, rms(x)))
}

/** Spearman-free monotonicity check: fraction of successive windows that move in the expected direction. */
export function monotonicFraction(values: number[], direction: 1 | -1): number {
  if (values.length < 2) return 1
  let ok = 0
  for (let i = 1; i < values.length; i++) if ((values[i]! - values[i - 1]!) * direction >= -1e-9) ok++
  return ok / (values.length - 1)
}
