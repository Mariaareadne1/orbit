/**
 * Deterministic DSP fixtures through the arrangement export path (`renderArrangement`, the same
 * graph as live playback): code-generated sine and pink noise, fixed left/right sources, a full
 * circle. Each render is encoded to 16-bit WAV in the page and decoded outside the browser.
 * Results land in test-results/dsp/ (fixtures.json + WAVs) for the progress log.
 */
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openWith, probeWav } from './helpers'

const OUT = join('test-results', 'dsp')

interface FixtureResult {
  name: string
  seconds: number
  sampleRate: number
  rmsLeftDb: number
  rmsRightDb: number
  balanceDb: number
  /** balance (R − L, dB) in 0.5 s windows */
  windows: number[]
  peak: number
  clipped: number
  wav: string
}

test('code-generated fixtures pan, scale and encode as the stage says', async ({ page, browserName }) => {
  test.setTimeout(120_000)
  await openWith(page, null)
  const results = await page.evaluate(async () => {
    const engineModule = '/src/audio/engine.ts'
    const signalsModule = '/src/audio/signals.ts'
    const pathModule = '/src/audio/path.ts'
    const { renderArrangement, SampleBank } = await import(/* @vite-ignore */ engineModule)
    const { pinkNoise } = await import(/* @vite-ignore */ signalsModule)
    const { orbitPath } = await import(/* @vite-ignore */ pathModule)
    const { encodeWav } = (window as unknown as { orbit: { encodeWav: (c: Float32Array[], sr: number) => { bytes: Uint8Array; clipped: number } } }).orbit
    const SR = 48000
    const SECONDS = 4
    const sine = new Float32Array(SR * SECONDS).map((_, i) => 0.4 * Math.sin((2 * Math.PI * 1000 * i) / SR))
    const noise = pinkNoise(SECONDS, SR, 7, 0.5) as Float32Array
    const bank = new SampleBank()
    bank.addFile('sine', sine)
    bank.addFile('noise', noise)
    const voice = (blobId: string, path: Array<{ t: number; x: number; y: number }>) => ({
      id: blobId, name: blobId, color: '#8fc7ff', source: { kind: 'file', blobId, name: blobId, seconds: SECONDS }, gainDb: 0, mute: false, solo: false, path,
    })
    const fixtures: Array<[string, ReturnType<typeof voice>]> = [
      ['noise-left', voice('noise', [{ t: 0, x: -2, y: 0 }])],
      ['noise-right', voice('noise', [{ t: 0, x: 2, y: 0 }])],
      ['sine-left', voice('sine', [{ t: 0, x: -2, y: 0 }])],
      ['sine-right', voice('sine', [{ t: 0, x: 2, y: 0 }])],
      ['noise-circle', voice('noise', orbitPath(2, SECONDS, 1, 0, 64))],
      ['noise-ahead-1m', voice('noise', [{ t: 0, x: 0, y: 1 }])],
      ['noise-ahead-4m', voice('noise', [{ t: 0, x: 0, y: 4 }])],
    ]
    const dB = (x: number) => 20 * Math.log10(Math.max(1e-9, x))
    const rms = (a: Float32Array, s = 0, e = a.length) => { let t = 0; for (let i = s; i < e; i++) t += a[i]! * a[i]!; return Math.sqrt(t / Math.max(1, e - s)) }
    const out = []
    for (const [name, v] of fixtures) {
      const doc = { version: 1, name, duration: SECONDS, loop: false, voices: [v] }
      const r = await renderArrangement(doc, bank)
      const windows: number[] = []
      for (let s = 0; s + SR / 2 <= r.left.length; s += SR / 2) windows.push(dB(rms(r.right, s, s + SR / 2)) - dB(rms(r.left, s, s + SR / 2)))
      let peak = 0
      for (const ch of [r.left, r.right]) for (const x of ch) peak = Math.max(peak, Math.abs(x))
      const { bytes, clipped } = encodeWav([r.left, r.right], r.sampleRate)
      let b64 = ''
      for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      out.push({
        name, seconds: r.left.length / r.sampleRate, sampleRate: r.sampleRate,
        rmsLeftDb: dB(rms(r.left)), rmsRightDb: dB(rms(r.right)), balanceDb: dB(rms(r.right)) - dB(rms(r.left)),
        windows, peak, clipped, wav: btoa(b64),
      })
    }
    return out
  })

  mkdirSync(OUT, { recursive: true })
  const summary: Array<Omit<FixtureResult, 'wav'> & { python: unknown; ffprobe: unknown }> = []
  for (const r of results as FixtureResult[]) {
    const file = join(OUT, `${browserName}-${r.name}.wav`)
    writeFileSync(file, Buffer.from(r.wav, 'base64'))
    const python = JSON.parse(execFileSync('python3', ['-I', 'scripts/check_wav.py', file], { encoding: 'utf8' }))
    const ffprobe = probeWav(file)
    expect(python).toMatchObject({ channels: 2, sampleWidth: 2, sampleRate: 48000 })
    expect(python.durationSeconds).toBeCloseTo(4, 3)
    expect(ffprobe, 'a working ffprobe (ffprobe-static dev dependency)').not.toBeNull()
    expect(ffprobe).toMatchObject({ codec: 'pcm_s16le', sampleRate: 48000, channels: 2 })
    expect(ffprobe!.duration).toBeCloseTo(4, 3)
    // The independent decoder sees the same balance the page measured (16-bit quantisation only).
    expect(Math.abs(python.firstSecondBalanceDb - (r.windows[0]! + r.windows[1]!) / 2)).toBeLessThan(0.3)
    expect(r.clipped).toBe(0)
    expect(r.peak).toBeLessThan(1)
    summary.push({ name: r.name, seconds: r.seconds, sampleRate: r.sampleRate, rmsLeftDb: r.rmsLeftDb, rmsRightDb: r.rmsRightDb, balanceDb: r.balanceDb, peak: r.peak, clipped: r.clipped, windows: r.windows.map((w) => +w.toFixed(2)), python, ffprobe })
  }
  writeFileSync(join(OUT, `${browserName}-fixtures.json`), JSON.stringify(summary, null, 2))
  const by = Object.fromEntries((results as FixtureResult[]).map((r) => [r.name, r]))
  console.log(`[${browserName}] ` + (results as FixtureResult[]).map((r) => `${r.name}: bal ${r.balanceDb.toFixed(2)} dB, L ${r.rmsLeftDb.toFixed(1)} R ${r.rmsRightDb.toFixed(1)} dBFS, peak ${r.peak.toFixed(3)}`).join(' | '))

  // Fixed positions: left is louder on the left, right on the right, mirror-symmetric.
  expect(by['noise-left']!.balanceDb).toBeLessThan(-3)
  expect(by['noise-right']!.balanceDb).toBeGreaterThan(3)
  expect(Math.abs(by['noise-left']!.balanceDb + by['noise-right']!.balanceDb)).toBeLessThan(1)
  // A 1 kHz sine has a larger interaural level difference than low-heavy pink noise.
  expect(by['sine-left']!.balanceDb).toBeLessThan(by['noise-left']!.balanceDb)
  expect(by['sine-right']!.balanceDb).toBeGreaterThan(by['noise-right']!.balanceDb)
  // Circle from ahead, clockwise over 4 s: right during the first half, left during the second.
  const c = by['noise-circle']!.windows
  expect(c[1]! + c[2]!).toBeGreaterThan(4) // around +90° (t ≈ 1 s)
  expect(c[5]! + c[6]!).toBeLessThan(-4) // around −90° (t ≈ 3 s)
  // Distance: 1 m vs 4 m straight ahead follows the inverse model (−12.04 dB).
  const near = (by['noise-ahead-1m']!.rmsLeftDb + by['noise-ahead-1m']!.rmsRightDb) / 2
  const far = (by['noise-ahead-4m']!.rmsLeftDb + by['noise-ahead-4m']!.rmsRightDb) / 2
  expect(Math.abs(far - near + 12.04)).toBeLessThan(0.3)
})
