import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DOC_KEY } from '../../src/state/storage'
import { positionAt } from '../../src/audio/path'
import { stageToScreen } from '../../src/audio/coords'
import type { OrbitDoc } from '../../src/state/document'

const TMP = mkdtempSync(join(tmpdir(), 'orbit-e2e-'))

/** One voice passing left → right across the front, no loop. */
const PASS_DOC: OrbitDoc = {
  version: 1, name: 'Pass test', duration: 8, loop: false,
  voices: [{ id: 'v1', name: 'Drone', color: '#5ee7ff', source: { kind: 'builtin', id: 'drone' }, gainDb: 0, mute: false, solo: false,
    path: [{ t: 0, x: -4, y: 1 }, { t: 8, x: 4, y: 1 }] }],
}

async function openWith(page: Page, doc: OrbitDoc | null) {
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

const getDoc = (page: Page) => page.evaluate(() => (window as unknown as { orbit: { doc: () => OrbitDoc } }).orbit.doc())

/** Tap the live master output with an AudioWorklet; returns a stop() that yields per-block levels in piece time. */
async function startTap(page: Page) {
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

async function stopTap(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __tap: number[][]; orbit: { engine: { pieceTimeAt: (t: number) => number } } }
    return w.__tap.map(([t, l, r, n]) => ({ t: w.orbit.engine.pieceTimeAt(t!), l: l!, r: r!, n: n! }))
  })
}

/** Balance (dB) in windows of `size` seconds from per-block energies. */
function balanceCurve(blocks: Array<{ t: number; l: number; r: number }>, size: number, end: number) {
  const out: Array<{ t: number; db: number }> = []
  for (let a = 0; a + size <= end; a += size) {
    const inW = blocks.filter((b) => b.t >= a && b.t < a + size)
    const l = inW.reduce((s, b) => s + b.l, 0)
    const r = inW.reduce((s, b) => s + b.r, 0)
    if (l > 0 && r > 0) out.push({ t: a + size / 2, db: 10 * Math.log10(r / l) })
  }
  return out
}

test('live playback and the exported WAV pan the same way over time', async ({ page, browserName }) => {
  test.setTimeout(90_000)
  await openWith(page, PASS_DOC)
  await page.getByTestId('play').click() // a user gesture starts the AudioContext
  await expect.poll(() => page.evaluate(() => (window as unknown as { orbit: { engine: { context: AudioContext | null } } }).orbit.engine.context?.state)).toBe('running')
  // Restart from 0 with the tap in place so the whole pass is captured.
  await page.getByRole('button', { name: 'Pause' }).click()
  await startTap(page)
  await page.evaluate(() => (window as unknown as { orbit: { engine: { stop: () => void } } }).orbit.engine.stop())
  await page.getByTestId('play').click()
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Play', { timeout: 15_000 }) // ended (no loop)
  const live = await stopTap(page)

  const offline = await page.evaluate(async () => {
    const o = (window as unknown as { orbit: { engine: { bank: unknown }; doc: () => unknown } }).orbit
    const modulePath = '/src/audio/engine.ts'
    const { renderArrangement } = await import(/* @vite-ignore */ modulePath)
    const r = await renderArrangement(o.doc() as never, o.engine.bank as never)
    const blocks: Array<{ t: number; l: number; r: number }> = []
    for (let i = 0; i + 128 <= r.left.length; i += 128) {
      let l = 0, rr = 0
      for (let k = i; k < i + 128; k++) { l += r.left[k]! ** 2; rr += r.right[k]! ** 2 }
      blocks.push({ t: i / r.sampleRate, l, r: rr })
    }
    return blocks
  })

  const a = balanceCurve(live, 0.5, 8)
  const b = balanceCurve(offline, 0.5, 8)
  console.log(`[${browserName}] live    ${a.map((x) => x.db.toFixed(1)).join(' ')}`)
  console.log(`[${browserName}] offline ${b.map((x) => x.db.toFixed(1)).join(' ')}`)
  expect(a.length).toBeGreaterThanOrEqual(14)
  // A 110 Hz drone has little interaural level difference; the sign and shape are what matter.
  expect(a[0]!.db).toBeLessThan(-1.5)
  expect(a[a.length - 1]!.db).toBeGreaterThan(1.5)
  let worst = 0
  for (const x of a) {
    const y = b.find((z) => Math.abs(z.t - x.t) < 1e-6)
    if (y) worst = Math.max(worst, Math.abs(x.db - y.db))
  }
  console.log(`[${browserName}] max |live − offline| balance = ${worst.toFixed(2)} dB`)
  expect(worst).toBeLessThan(0.5)
})

test('the stage draws each voice where the path says it is', async ({ page }) => {
  const errors = await openWith(page, null)
  const doc = await getDoc(page)
  await page.getByTestId('play').click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  const t = await page.evaluate(() => (window as unknown as { orbit: { engine: { time: () => number } } }).orbit.engine.time())
  const plucks = doc.voices.find((v) => v.name === 'Plucks')!
  const expected = stageToScreen(positionAt(plucks.path, t), 320, 320, (640 / 2 - 46) / 5)
  const transform = await page.getByTestId('node-Plucks').getAttribute('transform')
  const [px, py] = transform!.match(/translate\(([-\d.]+) ([-\d.]+)\)/)!.slice(1).map(Number)
  expect(Math.abs(px! - expected.px)).toBeLessThan(1.5)
  expect(Math.abs(py! - expected.py)).toBeLessThan(1.5)
  expect(t).toBeGreaterThan(1)
  expect(errors).toEqual([])
})

test('draw, place and undo shape the paths', async ({ page }) => {
  await openWith(page, null)
  const stage = page.getByTestId('stage')
  const box = (await stage.boundingBox())!
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })
  // Draw a stroke for the selected voice (Plucks, default tool Draw).
  const before = (await getDoc(page)).voices.find((v) => v.name === 'Plucks')!.path
  const p0 = at(0.3, 0.3)
  await page.mouse.move(p0.x, p0.y)
  await page.mouse.down()
  for (let i = 1; i <= 20; i++) await page.mouse.move(...(Object.values(at(0.3 + i * 0.02, 0.3 + Math.sin(i / 3) * 0.1)) as [number, number]))
  await page.mouse.up()
  const drawn = (await getDoc(page)).voices.find((v) => v.name === 'Plucks')!.path
  expect(drawn).toHaveLength(97)
  expect(drawn[0]!.x).toBeLessThan(0)
  expect(drawn[0]!.y).toBeGreaterThan(0) // upper-left of the stage = front-left
  expect(drawn[96]!.t).toBe(16)
  await page.getByRole('button', { name: 'Undo' }).click()
  expect((await getDoc(page)).voices.find((v) => v.name === 'Plucks')!.path).toEqual(before)

  // Place: Drone to the right of the listener.
  await page.getByRole('button', { name: /Drone/ }).first().click()
  await page.getByRole('button', { name: /Place/ }).click()
  const right = at(0.8, 0.5)
  await page.mouse.move(right.x, right.y)
  await page.mouse.down()
  await page.mouse.up()
  const drone = (await getDoc(page)).voices.find((v) => v.name === 'Drone')!
  expect(drone.path).toHaveLength(1)
  expect(drone.path[0]!.x).toBeGreaterThan(2)
  expect(Math.abs(drone.path[0]!.y)).toBeLessThan(0.3)
  // Keyboard nudge.
  await stage.focus()
  await page.keyboard.press('ArrowUp')
  const nudged = (await getDoc(page)).voices.find((v) => v.name === 'Drone')!.path[0]!
  expect(nudged.y).toBeCloseTo(drone.path[0]!.y + 0.1, 3)
})

test('perform records live motion into the path', async ({ page }) => {
  await openWith(page, null)
  const original = (await getDoc(page)).voices.find((v) => v.name === 'Plucks')!.path
  await page.getByRole('button', { name: /Perform/ }).click()
  await page.getByTestId('play').click()
  await page.waitForTimeout(400)
  const box = (await page.getByTestId('stage').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5)
  await page.mouse.down()
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(box.x + box.width * (0.2 + i * 0.02), box.y + box.height * 0.5)
    await page.waitForTimeout(40)
  }
  await page.mouse.up()
  await page.getByRole('button', { name: 'Pause' }).click()
  const plucks = (await getDoc(page)).voices.find((v) => v.name === 'Plucks')!
  const key = (k: { t: number; x: number; y: number }) => `${k.t}|${k.x}|${k.y}`
  const old = new Set(original.map(key))
  const recorded = plucks.path.filter((k) => !old.has(key(k)) && Math.abs(k.y) < 0.15)
  expect(recorded.length).toBeGreaterThan(10)
  // Recorded keyframes move left → right over increasing time.
  for (let i = 1; i < recorded.length; i++) {
    expect(recorded[i]!.t).toBeGreaterThan(recorded[i - 1]!.t)
    expect(recorded[i]!.x).toBeGreaterThanOrEqual(recorded[i - 1]!.x - 1e-6)
  }
})

test('mute, solo and level change the export; the WAV is valid', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'file checks once')
  await openWith(page, PASS_DOC)
  const exportOnce = async () => {
    const dl = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export WAV' }).click()
    const d = await dl
    const file = join(TMP, `${Date.now()}.wav`)
    await d.saveAs(file)
    return JSON.parse(execFileSync('python3', ['-I', 'scripts/check_wav.py', file], { encoding: 'utf8' }))
  }
  const full = await exportOnce()
  expect(full).toMatchObject({ channels: 2, sampleRate: 48000, sampleWidth: 2 })
  expect(full.durationSeconds).toBeCloseTo(8, 3)
  expect(full.firstSecondBalanceDb).toBeLessThan(-1.5)
  expect(full.lastSecondBalanceDb).toBeGreaterThan(1.5)
  await expect(page.getByTestId('export-status')).toContainText('48 kHz stereo')

  await page.getByRole('button', { name: 'Mute Drone' }).click()
  const muted = await exportOnce()
  expect(muted.peak).toBe(0)
  await page.getByRole('button', { name: 'Mute Drone' }).click()
  await page.getByRole('button', { name: 'Solo Drone' }).click()
  const solo = await exportOnce()
  expect(solo.peak).toBeCloseTo(full.peak, 3)
})

test('imported audio becomes a voice and survives a reload; bad files are refused', async ({ page }) => {
  await openWith(page, null)
  // A 2 s 440 Hz WAV generated here.
  const sr = 48000
  const n = sr * 2
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24)
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 12000), 44 + i * 2)
  const wav = join(TMP, 'bell-tone.wav')
  writeFileSync(wav, buf)
  await page.getByTestId('audio-input').setInputFiles(wav)
  await expect(page.getByRole('button', { name: /^bell-tone/ })).toBeVisible()
  await expect(page.getByText('bell-tone.wav · 2.0 s')).toBeVisible()
  await page.waitForTimeout(500)
  await page.reload()
  await expect(page.getByRole('button', { name: /^bell-tone/ })).toBeVisible()
  await expect(page.getByText('audio missing')).toHaveCount(0)

  const fake = join(TMP, 'fake.mp3')
  writeFileSync(fake, 'definitely not audio')
  await page.getByTestId('audio-input').setInputFiles(fake)
  await expect(page.getByRole('alert')).toContainText('Only WAV, MP3')
})

test('a corrupt saved orbit is kept aside and reported', async ({ page }) => {
  await page.addInitScript((key) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem(key, '{"version": 7}')
  }, DOC_KEY)
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('couldn’t be read')
  const keys = await page.evaluate(() => Object.keys(localStorage))
  expect(keys.some((k) => k.includes('.unreadable.'))).toBe(true)
})

test('looping continues into the next cycle without stopping', async ({ page }) => {
  test.setTimeout(60_000)
  await openWith(page, { ...PASS_DOC, duration: 4, loop: true, voices: PASS_DOC.voices.map((v) => ({ ...v, path: [{ t: 0, x: -4, y: 1 }, { t: 4, x: 4, y: 1 }] })) })
  await page.getByTestId('play').click()
  await page.waitForTimeout(5200)
  const state = await page.evaluate(() => {
    const e = (window as unknown as { orbit: { engine: { time: () => number; playing: boolean } } }).orbit.engine
    return { t: e.time(), playing: e.playing }
  })
  expect(state.playing).toBe(true)
  expect(state.t).toBeGreaterThan(0.5)
  expect(state.t).toBeLessThan(2.5)
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Pause')
})

test('phone layout: stage first, no horizontal scroll', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await page.goto('/')
  const stage = (await page.getByTestId('stage').boundingBox())!
  expect(stage.width).toBeGreaterThan(300)
  expect(stage.x + stage.width).toBeLessThanOrEqual(391)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  await ctx.close()
})
