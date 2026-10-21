import { expect, test } from '@playwright/test'

interface Report {
  sampleRate: number
  sweep: { startBalanceDb: number; endBalanceDb: number; crossingSeconds: number | null; thirdsDb: [number, number, number]; windows: Array<{ t: number; balanceDb: number }> }
  sides: { leftBalanceDb: number; rightBalanceDb: number; leftHighDb: number; rightHighDb: number }
  distance: { differenceDb: number; inverseModelDb: number }
  frontBack: { frontHighBandDb: number; backHighBandDb: number; frontLevelDb: number; backLevelDb: number }
  orbit: { rightAt90: number; leftAt270: number }
  peak: number
  clippedSamples: number
  renderMs: number
}

test('HRTF panning measurably follows stage position (offline render)', async ({ page, browserName }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  const r = (await page.evaluate(async () => {
    const o = (window as unknown as { orbit: { runProof: () => Promise<Record<string, unknown>> } }).orbit
    const rep = await o.runProof()
    delete rep.sweepRender
    return rep
  })) as unknown as Report
  console.log(`[${browserName}] ${JSON.stringify({ ...r, sweep: { ...r.sweep, windows: r.sweep.windows.map((w) => +w.balanceDb.toFixed(1)) } })}`)

  // Left → right sweep across the front: starts left, ends right, crosses at the middle.
  // Broadband pink noise is dominated by low frequencies where interaural level
  // difference is small, so broadband balance peaks around ±5 dB; the sign and
  // ordering are what must hold.
  expect(r.sweep.startBalanceDb).toBeLessThan(-3)
  expect(r.sweep.endBalanceDb).toBeGreaterThan(3)
  expect(r.sweep.crossingSeconds).not.toBeNull()
  expect(Math.abs(r.sweep.crossingSeconds! - 3)).toBeLessThan(0.25)
  const [a, b, c] = r.sweep.thirdsDb
  expect(a).toBeLessThan(b)
  expect(b).toBeLessThan(c)
  // Hard left / right: clear broadband difference, much larger above 2 kHz (head shadow).
  expect(r.sides.leftBalanceDb).toBeLessThan(-3)
  expect(r.sides.rightBalanceDb).toBeGreaterThan(3)
  expect(r.sides.leftHighDb).toBeLessThan(r.sides.leftBalanceDb)
  expect(r.sides.rightHighDb).toBeGreaterThan(r.sides.rightBalanceDb)
  expect(Math.abs(r.sides.leftBalanceDb + r.sides.rightBalanceDb)).toBeLessThan(1) // symmetric
  // Distance follows the inverse model (same direction, so the HRTF filter cancels out).
  expect(Math.abs(r.distance.differenceDb - r.distance.inverseModelDb)).toBeLessThan(0.5)
  // Orbit: right at a quarter turn, left at three quarters.
  expect(r.orbit.rightAt90).toBeGreaterThan(3)
  expect(r.orbit.leftAt270).toBeLessThan(-3)
  // No clipping anywhere.
  expect(r.peak).toBeLessThan(1)
  expect(r.clippedSamples).toBe(0)
})

test('the rendered sweep exports as a valid WAV that external tools agree with', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine is enough for the file check')
  test.setTimeout(120_000)
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  await page.goto('/')
  const b64 = await page.evaluate(async () => {
    const o = (window as unknown as { orbit: { runProof: () => Promise<{ sweepRender: { left: Float32Array; right: Float32Array; sampleRate: number } }>; encodeWav: (c: Float32Array[], sr: number) => { bytes: Uint8Array } } }).orbit
    const rep = await o.runProof()
    const { bytes } = o.encodeWav([rep.sweepRender.left, rep.sweepRender.right], rep.sweepRender.sampleRate)
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(s)
  })
  const file = join(mkdtempSync(join(tmpdir(), 'orbit-wav-')), 'sweep.wav')
  writeFileSync(file, Buffer.from(b64, 'base64'))
  const py = JSON.parse(execFileSync('python3', ['-I', 'scripts/check_wav.py', file], { encoding: 'utf8' }))
  console.log('[python wave]', JSON.stringify(py))
  expect(py.channels).toBe(2)
  expect(py.sampleWidth).toBe(2)
  expect(py.sampleRate).toBe(48000)
  expect(py.durationSeconds).toBeCloseTo(6, 3)
  expect(py.firstSecondBalanceDb).toBeLessThan(-3)
  expect(py.lastSecondBalanceDb).toBeGreaterThan(3)
  expect(py.peak).toBeLessThan(1)
  const ffprobe = process.env.FFPROBE ?? `${process.env.HOME}/Developer/FrameFlow/node_modules/ffprobe-static/bin/darwin/arm64/ffprobe`
  try {
    const probe = execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration', '-of', 'json', file], { encoding: 'utf8' })
    const j = JSON.parse(probe)
    console.log('[ffprobe]', JSON.stringify(j))
    expect(j.streams[0].codec_name).toBe('pcm_s16le')
    expect(Number(j.streams[0].sample_rate)).toBe(48000)
    expect(j.streams[0].channels).toBe(2)
    expect(Number(j.format.duration)).toBeCloseTo(6, 3)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') test.info().annotations.push({ type: 'note', description: 'ffprobe not available; python check only' })
    else throw err
  }
})
