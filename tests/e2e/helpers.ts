import { type Page, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DOC_KEY } from '../../src/state/storage'
import type { OrbitDoc } from '../../src/state/document'

export const TMP = mkdtempSync(join(tmpdir(), 'orbit-e2e-'))

/** One voice passing left → right across the front, no loop. */
export const PASS_DOC: OrbitDoc = {
  version: 1, name: 'Pass test', duration: 8, loop: false,
  voices: [{ id: 'v1', name: 'Drone', color: '#5ee7ff', source: { kind: 'builtin', id: 'drone' }, gainDb: 0, mute: false, solo: false,
    path: [{ t: 0, x: -4, y: 1 }, { t: 8, x: 4, y: 1 }] }],
}

export async function openWith(page: Page, doc: OrbitDoc | null) {
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.clear()
    if (value) localStorage.setItem(key, value)
  }, { key: DOC_KEY, value: doc ? JSON.stringify(doc) : null })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto('/')
  await expect(page.getByTestId('stage')).toBeVisible()
  return errors
}

export const getDoc = (page: Page) => page.evaluate(() => (window as unknown as { orbit: { doc: () => OrbitDoc } }).orbit.doc())

/** Tap the live master output with an AudioWorklet; returns a stop() that yields per-block levels in piece time. */
export async function startTap(page: Page) {
  await page.evaluate(async () => {
    const o = (window as unknown as { orbit: { engine: { context: AudioContext; output: GainNode } } }).orbit
    const ctx = o.engine.context
    const code = `class Tap extends AudioWorkletProcessor {
      process(inputs) {
        const i = inputs[0]
        if (i && i.length === 2) {
          let l = 0, r = 0
          for (let k = 0; k < i[0].length; k++) { l += i[0][k] * i[0][k]; r += i[1][k] * i[1][k] }
          this.port.postMessage([currentTime, l, r, i[0].length])
        }
        return true
      }
    }
    registerProcessor('tap', Tap)`
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })))
    const node = new AudioWorkletNode(ctx, 'tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
    const sink = new GainNode(ctx, { gain: 0 })
    o.engine.output.connect(node).connect(sink).connect(ctx.destination)
    const w = window as unknown as { __tap: number[][] }
    w.__tap = []
    node.port.onmessage = (e) => w.__tap.push(e.data)
  })
}

export async function stopTap(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __tap: number[][]; orbit: { engine: { pieceTimeAt: (t: number) => number } } }
    return w.__tap.map(([t, l, r, n]) => ({ t: w.orbit.engine.pieceTimeAt(t!), l: l!, r: r!, n: n! }))
  })
}

/** Balance (dB) in windows of `size` seconds from per-block energies. */
export function balanceCurve(blocks: Array<{ t: number; l: number; r: number }>, size: number, end: number) {
  const out: Array<{ t: number; db: number }> = []
  for (let a = 0; a + size <= end; a += size) {
    const inW = blocks.filter((b) => b.t >= a && b.t < a + size)
    const l = inW.reduce((s, b) => s + b.l, 0)
    const r = inW.reduce((s, b) => s + b.r, 0)
    if (l > 0 && r > 0) out.push({ t: a + size / 2, db: 10 * Math.log10(r / l) })
  }
  return out
}


export const engineState = (page: Page) => page.evaluate(() => {
  const e = (window as unknown as { orbit: { engine: { time: () => number; playing: boolean } } }).orbit.engine
  return { t: e.time(), playing: e.playing }
})

/** A mono 16-bit WAV of a sine, generated here (no recordings in the repo). */
export function toneWav(seconds: number, hz: number, amp = 0.37, sr = 48000): Buffer {
  const n = Math.round(sr * seconds)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24)
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / sr) * amp * 32767), 44 + i * 2)
  return buf
}

/** ffprobe candidates: $FFPROBE, the ffprobe-static dev dependency, then PATH. */
function ffprobeCandidates(): string[] {
  const out: string[] = []
  if (process.env.FFPROBE) out.push(process.env.FFPROBE)
  try {
    out.push((createRequire(import.meta.url)('ffprobe-static') as { path: string }).path)
  } catch {
    // dev dependency not installed
  }
  out.push('ffprobe')
  return out
}

export interface Probe { codec: string; sampleRate: number; channels: number; duration: number; tool: string }

/** Decode a WAV header with ffprobe; null when no working ffprobe exists (the caller annotates). */
export function probeWav(file: string): Probe | null {
  for (const tool of ffprobeCandidates()) {
    try {
      const j = JSON.parse(execFileSync(tool, ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration', '-of', 'json', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
      return { codec: j.streams[0].codec_name, sampleRate: Number(j.streams[0].sample_rate), channels: j.streams[0].channels, duration: Number(j.format.duration), tool }
    } catch {
      // missing or broken binary (e.g. a Homebrew build with a missing dylib): try the next
    }
  }
  return null
}
