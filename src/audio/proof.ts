/**
 * The DSP proof: render real audio through the HRTF panner offline and
 * measure it. Every number the Orbit proof panel shows comes from here.
 */
import { countClipped, db, highBandDb, highpass, peak, rms, windows, type Window } from './analysis'
import { orbitPath, type Keyframe } from './path'
import { RENDER_RATE, renderPath, renderStatic, type Rendered } from './render'
import { pinkNoise } from './signals'

export const SWEEP_SECONDS = 6
export const SWEEP_PATH: Keyframe[] = [
  { t: 0, x: -4, y: 1 },
  { t: SWEEP_SECONDS, x: 4, y: 1 },
]

export interface ProofReport {
  engine: string
  sampleRate: number
  sweep: {
    windows: Window[]
    startBalanceDb: number
    endBalanceDb: number
    crossingSeconds: number | null
    /** mean balance of the first, middle and last thirds of the sweep */
    thirdsDb: [number, number, number]
  }
  /** broadband and above-2 kHz interaural level difference for hard left / right */
  sides: { leftBalanceDb: number; rightBalanceDb: number; leftHighDb: number; rightHighDb: number }
  distance: { nearDb: number; farDb: number; differenceDb: number; inverseModelDb: number }
  frontBack: { frontHighBandDb: number; backHighBandDb: number; frontLevelDb: number; backLevelDb: number }
  orbit: { windows: Window[]; rightAt90: number; leftAt270: number }
  peak: number
  clippedSamples: number
  renderMs: number
  sweepRender: Rendered
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)

const balance = (r: Rendered) => db(rms(r.right) / Math.max(1e-9, rms(r.left)))
/** Interaural level difference above 2 kHz, where head shadowing is strongest. */
const highBalance = (r: Rendered) =>
  db(rms(highpass(r.right, r.sampleRate, 2000)) / Math.max(1e-9, rms(highpass(r.left, r.sampleRate, 2000))))
const level = (r: Rendered) => db(Math.hypot(rms(r.left), rms(r.right)))

export async function runProof(engine = typeof navigator === 'undefined' ? 'node' : navigator.userAgent): Promise<ProofReport> {
  const t0 = performance.now()
  const sr = RENDER_RATE
  const noise = pinkNoise(SWEEP_SECONDS, sr, 42, 0.5)
  const short = noise.subarray(0, sr * 2)

  const sweepRender = await renderPath(noise, SWEEP_PATH, SWEEP_SECONDS, sr)
  const w = windows(sweepRender.left, sweepRender.right, sr, 0.25)
  const firstSecond = w.filter((x) => x.t < 1).map((x) => x.balanceDb)
  const lastSecond = w.filter((x) => x.t > SWEEP_SECONDS - 1).map((x) => x.balanceDb)
  let crossing: number | null = null
  for (let i = 1; i < w.length; i++) {
    if (w[i - 1]!.balanceDb < 0 && w[i]!.balanceDb >= 0) {
      crossing = w[i - 1]!.t + (w[i]!.t - w[i - 1]!.t) * (-w[i - 1]!.balanceDb / (w[i]!.balanceDb - w[i - 1]!.balanceDb))
      break
    }
  }

  const left = await renderStatic(short, { x: -2, y: 0 }, 2, sr)
  const right = await renderStatic(short, { x: 2, y: 0 }, 2, sr)
  const near = await renderStatic(short, { x: 0, y: 1 }, 2, sr)
  const far = await renderStatic(short, { x: 0, y: 4 }, 2, sr)
  const front = await renderStatic(short, { x: 0, y: 2 }, 2, sr)
  const back = await renderStatic(short, { x: 0, y: -2 }, 2, sr)

  const orbitSeconds = 4
  const orbit = await renderPath(noise.subarray(0, sr * orbitSeconds), orbitPath(2, orbitSeconds, 1, 0, 64), orbitSeconds, sr)
  const ow = windows(orbit.left, orbit.right, sr, 0.25)
  const near90 = ow.filter((x) => Math.abs(x.t - orbitSeconds / 4) < 0.3).map((x) => x.balanceDb)
  const near270 = ow.filter((x) => Math.abs(x.t - (3 * orbitSeconds) / 4) < 0.3).map((x) => x.balanceDb)

  const all = [sweepRender, left, right, near, far, front, back, orbit]
  const mono = (r: Rendered) => {
    const m = new Float32Array(r.left.length)
    for (let i = 0; i < m.length; i++) m[i] = (r.left[i]! + r.right[i]!) / 2
    return m
  }

  return {
    engine,
    sampleRate: sr,
    sweep: {
      windows: w,
      startBalanceDb: mean(firstSecond),
      endBalanceDb: mean(lastSecond),
      crossingSeconds: crossing,
      thirdsDb: [0, 1, 2].map((k) =>
        mean(w.filter((x) => x.t >= (k * SWEEP_SECONDS) / 3 && x.t < ((k + 1) * SWEEP_SECONDS) / 3).map((x) => x.balanceDb)),
      ) as [number, number, number],
    },
    sides: { leftBalanceDb: balance(left), rightBalanceDb: balance(right), leftHighDb: highBalance(left), rightHighDb: highBalance(right) },
    distance: {
      nearDb: level(near),
      farDb: level(far),
      differenceDb: level(far) - level(near),
      // inverse model: ref / (ref + rolloff · (d − ref)) with ref = 1, rolloff = 1
      inverseModelDb: db(1 / (1 + (4 - 1))),
    },
    frontBack: {
      frontHighBandDb: highBandDb(mono(front), sr),
      backHighBandDb: highBandDb(mono(back), sr),
      frontLevelDb: level(front),
      backLevelDb: level(back),
    },
    orbit: { windows: ow, rightAt90: mean(near90), leftAt270: mean(near270) },
    peak: Math.max(...all.map((r) => Math.max(peak(r.left), peak(r.right)))),
    clippedSamples: all.reduce((n, r) => n + countClipped(r.left) + countClipped(r.right), 0),
    renderMs: performance.now() - t0,
    sweepRender,
  }
}
