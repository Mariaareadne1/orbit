/**
 * The Spatial Theatre interface, checked where it matters: at the PannerNode, the live master
 * output, storage and the document — not at the animation.
 */
import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stageToAudio } from '../../src/audio/coords'
import { positionAt } from '../../src/audio/path'
import type { OrbitDoc } from '../../src/state/document'
import { engineState, getDoc, openWith, PASS_DOC, startTap, TMP, toneWav } from './helpers'

type Engine = {
  time: () => number
  playing: boolean
  active: Array<{ id: string; cycle: number; panner: PannerNode }>
  starts: number[]
  level: () => { left: number; right: number } | null
  pieceTimeAt: (t: number) => number
}

/** The sounding panner's position for a voice (the current cycle's node). */
const pannerOf = (page: Page, id: string) => page.evaluate((id) => {
  const e = (window as unknown as { orbit: { engine: Engine } }).orbit.engine
  const nodes = e.active.filter((a) => a.id === id)
  const a = nodes[nodes.length - 1]!
  return { x: a.panner.positionX.value, y: a.panner.positionY.value, z: a.panner.positionZ.value, t: e.time() }
}, id)

/** Whole-export R − L balance (dB) of the current document, rendered offline. */
const exportBalance = (page: Page) => page.evaluate(async () => {
  const o = (window as unknown as { orbit: { engine: { bank: unknown }; doc: () => unknown } }).orbit
  const modulePath = '/src/audio/engine.ts'
  const { renderArrangement } = await import(/* @vite-ignore */ modulePath)
  const r = await renderArrangement(o.doc() as never, o.engine.bank as never)
  let l = 0, rr = 0
  for (let i = 0; i < r.left.length; i++) { l += r.left[i]! ** 2; rr += r.right[i]! ** 2 }
  return 10 * Math.log10(rr / l)
})

const stagePoint = async (page: Page, fx: number, fy: number) => {
  const box = (await page.getByTestId('stage').boundingBox())!
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

test('placing a sound while playing moves the panner to the same coordinates', async ({ page }) => {
  await openWith(page, null)
  const drone = (await getDoc(page)).voices.find((v) => v.name === 'Drone')!
  await page.getByRole('button', { name: 'Drone', exact: true }).click()
  await page.getByTestId('play').click()
  await expect.poll(async () => (await engineState(page)).t).toBeGreaterThan(0.3)

  // Click empty floor to the right of the listener: the selected sound goes there.
  const right = await stagePoint(page, 0.8, 0.5)
  await page.mouse.click(right.x, right.y)
  await page.waitForTimeout(250)
  let p = (await getDoc(page)).voices.find((v) => v.id === drone.id)!.path[0]!
  expect(p.x).toBeGreaterThan(3)
  let audio = stageToAudio(p)
  let a = await pannerOf(page, drone.id)
  expect(Math.abs(a.x - audio.x)).toBeLessThan(0.02)
  expect(Math.abs(a.y)).toBeLessThan(1e-6)
  expect(Math.abs(a.z - audio.z)).toBeLessThan(0.02)
  await page.getByRole('list', { name: 'Voices' }).getByRole('button', { name: 'Solo Drone' }).click()
  const rightBalance = await exportBalance(page)

  // Drag it behind-left: stage (−x, −y) must arrive as audio (−x, 0, +y).
  await page.mouse.move(right.x, right.y)
  await page.mouse.down()
  const target = await stagePoint(page, 0.3, 0.75)
  await page.mouse.move(target.x, target.y, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  p = (await getDoc(page)).voices.find((v) => v.id === drone.id)!.path[0]!
  expect(p.x).toBeLessThan(-1)
  expect(p.y).toBeLessThan(-1)
  audio = stageToAudio(p)
  a = await pannerOf(page, drone.id)
  expect(Math.abs(a.x - audio.x)).toBeLessThan(0.02)
  expect(a.z).toBeGreaterThan(1) // behind the listener = +Z
  expect(Math.abs(a.z - audio.z)).toBeLessThan(0.02)

  // The export hears both placements on the side the stage shows (a 110 Hz drone: small but clear ILD).
  const leftBalance = await exportBalance(page)
  console.log(`export balance: right ${rightBalance.toFixed(2)} dB, behind-left ${leftBalance.toFixed(2)} dB`)
  expect(rightBalance).toBeGreaterThan(0.5)
  expect(leftBalance).toBeLessThan(-0.5)
  expect(rightBalance - leftBalance).toBeGreaterThan(2)
})

test('a click on a moving sound in Place selects it without flattening its path', async ({ page }) => {
  await openWith(page, null)
  const before = (await getDoc(page)).voices.find((v) => v.name === 'Plucks')!.path
  await page.getByTestId('node-Plucks').click()
  await expect(page.getByTestId('source-card')).toBeVisible()
  await expect(page.getByTestId('source-card').getByRole('textbox', { name: 'Name' })).toHaveValue('Plucks')
  expect((await getDoc(page)).voices.find((v) => v.name === 'Plucks')!.path).toEqual(before)
})

test('keyboard: select, open, nudge, switch modes, close', async ({ page }) => {
  await openWith(page, null)
  const card = page.getByTestId('source-card')
  await page.getByTestId('node-Drone').focus()
  await page.keyboard.press('Enter')
  await expect(card.getByRole('textbox', { name: 'Name' })).toHaveValue('Drone')
  const x0 = (await getDoc(page)).voices.find((v) => v.name === 'Drone')!.path[0]!.x
  await page.getByTestId('node-Drone').focus()
  await page.keyboard.press('ArrowRight')
  expect((await getDoc(page)).voices.find((v) => v.name === 'Drone')!.path[0]!.x).toBeCloseTo(x0 + 0.1, 3)
  await page.keyboard.press('Escape')
  await expect(card).toBeHidden()
  await page.keyboard.press('3')
  await expect(card.getByRole('textbox', { name: 'Name' })).toHaveValue('Pulse')
  await page.getByTestId('node-Pulse').focus()
  await page.keyboard.press('d')
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // A moving sound isn't silently flattened by an arrow key outside Place.
  const pulse = (await getDoc(page)).voices.find((v) => v.name === 'Pulse')!.path
  await page.keyboard.press('ArrowUp')
  await expect(page.getByTestId('mode-hint')).toContainText('Hold here')
  expect((await getDoc(page)).voices.find((v) => v.name === 'Pulse')!.path).toEqual(pulse)
  await page.keyboard.press('r')
  await expect(page.getByRole('button', { name: 'Perform', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('p')
  await expect(page.getByRole('button', { name: 'Place', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('removing a sound takes two steps and can be undone', async ({ page }) => {
  await openWith(page, null)
  await page.getByRole('button', { name: 'Pulse', exact: true }).click()
  const card = page.getByTestId('source-card')
  await card.getByRole('button', { name: 'Remove…' }).click()
  expect((await getDoc(page)).voices).toHaveLength(3)
  await card.getByRole('button', { name: 'Keep' }).click()
  expect((await getDoc(page)).voices).toHaveLength(3)
  await card.getByRole('button', { name: 'Remove…' }).click()
  await card.getByRole('button', { name: 'Remove Pulse' }).click()
  expect((await getDoc(page)).voices.map((v) => v.name)).toEqual(['Drone', 'Plucks'])
  await page.getByRole('button', { name: 'Undo' }).click()
  expect((await getDoc(page)).voices.map((v) => v.name)).toEqual(['Drone', 'Plucks', 'Pulse'])
})

test('empty lanes add sounds up to six', async ({ page }) => {
  await openWith(page, null)
  for (const name of ['Drone', 'Plucks', 'Pulse']) {
    await page.getByRole('button', { name: '+ Add sound' }).click()
    await page.getByRole('group', { name: 'Add a sound' }).getByRole('button', { name }).click()
  }
  expect((await getDoc(page)).voices).toHaveLength(6)
  await expect(page.getByRole('button', { name: '+ Add sound' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Import' })).toBeDisabled()
  // Six distinct identities (colour + shape slot).
  expect(new Set((await getDoc(page)).voices.map((v) => v.color)).size).toBe(6)
})

test('length: typed values apply on Enter, invalid ones are explained and not applied', async ({ page }) => {
  await openWith(page, null)
  const length = page.getByLabel(/Length in seconds/)
  await length.click()
  await length.press('ControlOrMeta+a')
  await page.keyboard.type('120')
  await expect(length).toHaveValue('120') // no keystroke lost while typing
  await length.press('Enter')
  expect((await getDoc(page)).duration).toBe(120)
  const plucks = (await getDoc(page)).voices.find((v) => v.name === 'Plucks')!.path
  expect(plucks[plucks.length - 1]!.t).toBeCloseTo(120, 3)
  await length.fill('2')
  await length.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: 'Length must be 4–180 s' })).toBeVisible()
  expect((await getDoc(page)).duration).toBe(120)
  await expect(length).toHaveValue('120')
})

test('storage full: the save failure is visible and Save recovers', async ({ page }) => {
  await openWith(page, null)
  await page.evaluate(() => {
    const w = window as unknown as { __full: boolean }
    w.__full = true
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (w.__full) throw new DOMException('full', 'QuotaExceededError')
      return orig.call(this, k, v)
    }
  })
  await page.getByLabel('Loop').uncheck()
  await expect(page.getByRole('alert').filter({ hasText: 'storage is full' })).toBeVisible()
  await expect(page.getByTestId('status')).toContainText('not saved')
  await page.evaluate(() => { (window as unknown as { __full: boolean }).__full = false })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('status')).toContainText(/saved \d/)
  await expect(page.getByRole('alert').filter({ hasText: 'storage is full' })).toHaveCount(0)
  await page.reload()
  expect((await getDoc(page)).loop).toBe(false)
})

test('a removed imported sound is garbage-collected at reload; the kept one survives', async ({ page }) => {
  await openWith(page, { ...PASS_DOC, voices: [] })
  for (const [name, hz] of [['keep-me', 330], ['drop-me', 550]] as const) {
    const file = join(TMP, `${name}.wav`)
    writeFileSync(file, toneWav(1, hz))
    await page.getByTestId('audio-input').setInputFiles(file)
    await expect(page.getByTestId(`node-${name}`)).toBeVisible()
  }
  const keyCount = () => page.evaluate(() => new Promise<string[]>((resolve) => {
    const req = indexedDB.open('orbit', 1)
    req.onsuccess = () => {
      const r = req.result.transaction('files').objectStore('files').getAllKeys()
      r.onsuccess = () => { req.result.close(); resolve(r.result.map(String)) }
    }
  }))
  expect(await keyCount()).toHaveLength(2)
  await page.getByRole('button', { name: 'drop-me', exact: true }).click()
  await page.getByTestId('source-card').getByRole('button', { name: 'Remove…' }).click()
  await page.getByTestId('source-card').getByRole('button', { name: 'Remove drop-me' }).click()
  await page.waitForTimeout(500)
  await page.reload()
  await expect(page.getByTestId('node-keep-me')).toBeVisible()
  const doc = await getDoc(page)
  const kept = doc.voices[0]!.source as { blobId: string }
  await expect.poll(keyCount).toEqual([kept.blobId])
  await expect(page.getByText('audio missing')).toHaveCount(0)
  expect(await page.evaluate((id) => (window as unknown as { orbit: { engine: { bank: { hasFile: (id: string) => boolean } } } }).orbit.engine.bank.hasFile(id), kept.blobId)).toBe(true)
})

test('the meter reads the real output: signal when audible, silence when muted', async ({ page }) => {
  await openWith(page, { ...PASS_DOC, loop: true })
  await expect(page.locator('.meter__value')).toHaveText('— dBFS')
  await page.getByTestId('play').click()
  const peak = () => page.evaluate(() => {
    const l = (window as unknown as { orbit: { engine: Engine } }).orbit.engine.level()
    return l ? Math.max(l.left, l.right) : -1
  })
  await expect.poll(peak).toBeGreaterThan(0.01)
  await expect(page.locator('.meter__value')).toHaveText(/^-\d+\.\d dBFS$/)
  await page.getByRole('button', { name: 'Mute Drone' }).click()
  await expect.poll(peak, { timeout: 5000 }).toBeLessThan(1e-4)
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.locator('.meter__value')).toHaveText('— dBFS')
})

test('loop cycles are phase-aligned: the second pass pans like the first', async ({ page, browserName }) => {
  test.setTimeout(90_000)
  await openWith(page, { ...PASS_DOC, duration: 4, loop: true, voices: PASS_DOC.voices.map((v) => ({ ...v, path: [{ t: 0, x: -4, y: 1 }, { t: 4, x: 4, y: 1 }] })) })
  await page.getByTestId('play').click()
  await expect.poll(async () => (await engineState(page)).t).toBeGreaterThan(0.1)
  await page.getByRole('button', { name: 'Pause' }).click()
  await startTap(page)
  await page.getByRole('button', { name: 'Stop and return to start' }).click()
  await page.getByTestId('play').click()
  // Wait, on the audio clock, until the third cycle is sounding (so cycles 1 and 2 are complete).
  await expect.poll(() => page.evaluate(() => {
    const e = (window as unknown as { orbit: { engine: Engine & { context: AudioContext } } }).orbit.engine
    return e.starts.length >= 3 && e.context.currentTime > e.starts[2]! + 0.2
  }), { timeout: 30_000 }).toBe(true)
  const { blocks, starts } = await page.evaluate(() => {
    const w = window as unknown as { __tap: number[][]; orbit: { engine: Engine } }
    return { blocks: w.__tap.map(([t, l, r]) => ({ t: t!, l: l!, r: r! })), starts: w.orbit.engine.starts }
  })
  const curve = (start: number) => {
    const out: number[] = []
    for (let a = 0; a < 4; a += 0.5) {
      const w = blocks.filter((b) => b.t - start >= a && b.t - start < a + 0.5)
      out.push(10 * Math.log10(w.reduce((s, b) => s + b.r, 0) / w.reduce((s, b) => s + b.l, 0)))
    }
    return out
  }
  const c0 = curve(starts[0]!)
  const c1 = curve(starts[1]!)
  console.log(`[${browserName}] cycle 1 ${c0.map((x) => x.toFixed(2)).join(' ')}`)
  console.log(`[${browserName}] cycle 2 ${c1.map((x) => x.toFixed(2)).join(' ')}`)
  expect(starts[1]! - starts[0]!).toBeCloseTo(4, 6)
  const worst = Math.max(...c0.map((x, i) => Math.abs(x - c1[i]!)))
  console.log(`[${browserName}] max |cycle 2 − cycle 1| = ${worst.toFixed(3)} dB`)
  expect(worst).toBeLessThan(0.3)
  // No silent gap at the boundary: every 128-sample block around it carries signal.
  const edge = blocks.filter((b) => Math.abs(b.t - starts[1]!) < 0.25)
  expect(edge.length).toBeGreaterThan(50)
  expect(edge.every((b) => b.l + b.r > 1e-8)).toBe(true)
})

test('a blocked main thread across a loop boundary does not stop or drift the audio', async ({ page }) => {
  test.setTimeout(90_000)
  await openWith(page, { ...PASS_DOC, duration: 4, loop: true })
  await page.getByTestId('play').click()
  await startTap(page)
  await expect.poll(async () => (await engineState(page)).t, { timeout: 30_000, intervals: [50] }).toBeGreaterThan(3.0)
  // Stand-in for background-tab timer throttling: no timers or frames for 1.2 s across the wrap.
  await page.evaluate(() => { const end = performance.now() + 1200; while (performance.now() < end) { /* busy */ } })
  await expect.poll(async () => { const s = await engineState(page); return s.playing && s.t > 0.5 && s.t < 3 }, { timeout: 30_000, intervals: [50] }).toBe(true)
  const { blocks, starts } = await page.evaluate(() => {
    const w = window as unknown as { __tap: number[][]; orbit: { engine: Engine } }
    return { blocks: w.__tap.map(([t, l, r]) => ({ t: t!, l: l!, r: r! })), starts: w.orbit.engine.starts }
  })
  expect(starts.length).toBeGreaterThanOrEqual(2)
  expect(starts[1]! - starts[0]!).toBeCloseTo(4, 6)
  const edge = blocks.filter((b) => Math.abs(b.t - starts[1]!) < 0.4)
  expect(edge.every((b) => b.l + b.r > 1e-8)).toBe(true)
})

test('perform: recording state shows on stage and score; a click alone records nothing', async ({ page }) => {
  await openWith(page, PASS_DOC)
  await page.getByRole('button', { name: 'Perform', exact: true }).click()
  await expect(page.getByTestId('stage-status')).toContainText('press play')
  await page.getByTestId('play').click()
  await expect(page.getByTestId('stage-status')).toContainText('armed')
  const from = await stagePoint(page, 0.25, 0.3)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from.x + i * 12, from.y)
    await page.waitForTimeout(40)
  }
  await expect(page.getByTestId('stage-status')).toContainText('Rec · Drone')
  await expect(page.locator('.lane__recording')).toHaveCount(1)
  await page.mouse.up()
  await expect(page.locator('.lane__recording')).toHaveCount(0)
  await expect(page.getByTestId('announcer')).toContainText('Recorded')
  const click = await stagePoint(page, 0.5, 0.15)
  await page.mouse.click(click.x, click.y)
  await expect(page.getByTestId('announcer')).toContainText('Nothing recorded')
})

test('audio held back by the browser is reported and can be started again', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __block: boolean; AudioContext: typeof AudioContext }
    w.__block = true
    const Real = w.AudioContext
    w.AudioContext = class extends Real {
      constructor(o?: AudioContextOptions) {
        super(o)
        if (w.__block) void this.suspend()
      }
      resume() {
        return w.__block ? new Promise<void>(() => undefined) : super.resume()
      }
    } as typeof AudioContext
  })
  await openWith(page, PASS_DOC)
  await page.getByTestId('play').click()
  const banner = page.getByRole('alert').filter({ hasText: 'holding audio back' })
  await expect(banner).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('status')).toContainText('audio blocked')
  await page.evaluate(() => { (window as unknown as { __block: boolean }).__block = false })
  await banner.getByRole('button', { name: 'Start audio' }).click()
  await expect(banner).toBeHidden()
  await expect(page.getByTestId('status')).toContainText('audio on')
  await expect.poll(async () => (await engineState(page)).t).toBeGreaterThan(0.3)
})

test('phone: tap selects into a sheet that leaves the transport reachable; tap places', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await openWith(page, null)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  await page.getByTestId('node-Drone').tap()
  const card = page.getByTestId('source-card')
  await expect(card).toBeVisible()
  // The card docks below the stage: it covers neither the stage nor the pinned transport.
  const play = (await page.getByTestId('play').boundingBox())!
  const sheet = (await card.boundingBox())!
  const stageBox = (await page.getByTestId('stage').boundingBox())!
  expect(play.y + play.height).toBeLessThanOrEqual(844)
  expect(sheet.y).toBeGreaterThanOrEqual(stageBox.y + stageBox.height)
  const closeBtn = card.getByRole('button', { name: 'Close sound card' })
  await closeBtn.scrollIntoViewIfNeeded()
  const c = (await closeBtn.boundingBox())!
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('button')?.getAttribute('aria-label'), [c.x + c.width / 2, c.y + c.height / 2])).toBe('Close sound card')
  await closeBtn.tap()
  await expect(card).toBeHidden()
  await page.evaluate(() => scrollTo(0, 0))
  const scrollBefore = await page.evaluate(() => scrollY)
  const p = await stagePoint(page, 0.25, 0.75) // empty floor, back-left
  await page.touchscreen.tap(p.x, p.y)
  await page.waitForTimeout(150)
  const drone = (await getDoc(page)).voices.find((v) => v.name === 'Drone')!
  expect(drone.path).toHaveLength(1)
  expect(drone.path[0]!.x).toBeLessThan(-2)
  expect(drone.path[0]!.y).toBeLessThan(-2)
  expect(await page.evaluate(() => scrollY)).toBe(scrollBefore)
  await ctx.close()
})

test('old documents keep working: legacy colours map to the new identities', async ({ page }) => {
  const legacy: OrbitDoc = { ...PASS_DOC, voices: [{ ...PASS_DOC.voices[0]!, color: '#5ee7ff' }] }
  await openWith(page, legacy)
  const doc = await getDoc(page)
  expect(doc.voices[0]!.color).toBe('#8fc7ff')
  expect(positionAt(doc.voices[0]!.path, 4)).toEqual({ x: 0, y: 1 })
})

test('a failed export says so and leaves the app usable', async ({ page }) => {
  await openWith(page, PASS_DOC)
  await page.evaluate(() => {
    OfflineAudioContext.prototype.startRendering = () => Promise.reject(new Error('renderer out of memory'))
  })
  await page.getByRole('button', { name: 'Export WAV' }).click()
  await expect(page.getByTestId('export-status')).toContainText('Export failed: renderer out of memory')
  await expect(page.getByRole('button', { name: 'Export WAV' })).toBeEnabled()
})

test('canceling the file picker is acknowledged and changes nothing', async ({ page }) => {
  await openWith(page, null)
  const before = await getDoc(page)
  await page.getByTestId('audio-input').dispatchEvent('cancel')
  await expect(page.getByTestId('mode-hint')).toContainText('Import canceled')
  expect(await getDoc(page)).toEqual(before)
})

test('selection in Draw and scrubbing the score do not open the card over the work', async ({ page }) => {
  await openWith(page, null)
  await page.getByRole('button', { name: 'Draw', exact: true }).click()
  await page.getByTestId('node-Pulse').click()
  await expect(page.getByTestId('source-card')).toBeHidden()
  await expect(page.getByRole('list', { name: 'Voices' }).getByRole('button', { name: 'Pulse', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const tl = (await page.getByTestId('timeline').boundingBox())!
  await page.mouse.click(tl.x + tl.width * 0.5, tl.y + tl.height * 0.2)
  await expect(page.getByTestId('source-card')).toBeHidden()
  await page.getByRole('list', { name: 'Voices' }).getByRole('button', { name: 'Drone', exact: true }).click()
  await expect(page.getByTestId('source-card')).toBeVisible()
})

test('held arrow keys nudge as one undo step; a moving sound is never flattened by a key', async ({ page }) => {
  await openWith(page, null)
  const drone = () => getDoc(page).then((d) => d.voices.find((v) => v.name === 'Drone')!.path)
  const start = (await drone())[0]!
  await page.getByTestId('node-Drone').focus()
  // Auto-repeat: five keydowns, one keyup.
  for (let i = 0; i < 5; i++) await page.keyboard.down('ArrowRight')
  await page.keyboard.up('ArrowRight')
  expect((await drone())[0]!.x).toBeCloseTo(start.x + 0.5, 3)
  await page.getByRole('button', { name: 'Undo' }).click()
  expect((await drone())[0]!.x).toBeCloseTo(start.x, 3)
  const plucks = (await getDoc(page)).voices.find((v) => v.name === 'Plucks')!.path
  await page.getByTestId('node-Plucks').focus()
  await page.keyboard.press('ArrowUp')
  expect((await getDoc(page)).voices.find((v) => v.name === 'Plucks')!.path).toEqual(plucks)
  await expect(page.getByTestId('mode-hint')).toContainText('Hold here')
})
