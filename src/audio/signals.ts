/**
 * Licence-free test signals generated in code (no recordings in the repo).
 * Deterministic for a given seed and sample rate.
 */

/** mulberry32 — small seeded PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Pink-ish noise (Paul Kellet's economy filter), normalised to `peak`. */
export function pinkNoise(seconds: number, sampleRate: number, seed = 1, peak = 0.5): Float32Array {
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  const r = rng(seed)
  let b0 = 0, b1 = 0, b2 = 0
  let max = 0
  for (let i = 0; i < n; i++) {
    const white = r() * 2 - 1
    b0 = 0.99765 * b0 + white * 0.099046
    b1 = 0.963 * b1 + white * 0.2965164
    b2 = 0.57 * b2 + white * 1.0526913
    const v = b0 + b1 + b2 + white * 0.1848
    out[i] = v
    max = Math.max(max, Math.abs(v))
  }
  const k = max > 0 ? peak / max : 0
  for (let i = 0; i < n; i++) out[i]! *= k
  return out
}

/** A repeating plucked note: decaying sine partials, period `every` seconds. */
export function plucks(seconds: number, sampleRate: number, freq = 330, every = 0.5, peak = 0.5): Float32Array {
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  const period = Math.round(every * sampleRate)
  for (let i = 0; i < n; i++) {
    const t = (i % period) / sampleRate
    const env = Math.exp(-t * 7)
    out[i] = peak * env * (0.7 * Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * freq * 2.01 * t))
  }
  return out
}

/** A soft sustained tone with slow tremolo. */
export function drone(seconds: number, sampleRate: number, freq = 110, peak = 0.4): Float32Array {
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const trem = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.5 * t)
    out[i] = peak * trem * (0.6 * Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * freq * 1.5 * t) + 0.1 * Math.sin(2 * Math.PI * freq * 3 * t))
  }
  return out
}

/** A soft low pulse: a pitched-down sine thump every `every` seconds. */
export function pulse(seconds: number, sampleRate: number, every = 0.5, peak = 0.55): Float32Array {
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  const period = Math.round(every * sampleRate)
  for (let i = 0; i < n; i++) {
    const t = (i % period) / sampleRate
    const f = 55 + 70 * Math.exp(-t * 30)
    out[i] = peak * Math.exp(-t * 9) * Math.sin(2 * Math.PI * f * t)
  }
  return out
}
