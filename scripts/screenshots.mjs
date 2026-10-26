// README screenshots from the running dev server (pnpm dev). Headless: nothing is audible.
// Usage: node scripts/screenshots.mjs [outDir]   (ORBIT_URL overrides the app URL)
import { chromium, webkit } from '@playwright/test'
const APP = process.env.ORBIT_URL ?? 'http://localhost:5431/'
const OUT = process.argv[2] ?? new URL('../docs/media/', import.meta.url).pathname
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 86 })

async function fresh(browser, opts) {
  const page = await (await browser.newContext({ deviceScaleFactor: 2, ...opts })).newPage()
  await page.goto(APP)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByTestId('stage').waitFor()
  return page
}

const b = await chromium.launch(process.platform === 'darwin' ? { args: ['--use-angle=metal'] } : {})
const d = await fresh(b, { viewport: { width: 1440, height: 900 } })
// Theatre: playing, Plucks's card open.
await d.getByRole('button', { name: 'Plucks', exact: true }).click()
await d.getByTestId('play').click()
await d.waitForTimeout(3300)
await shot(d, 'orbit-theatre')

// Draw a figure-eight for Plucks.
await d.getByRole('button', { name: 'Pause' }).click()
await d.getByRole('button', { name: 'Draw', exact: true }).click()
const box = await d.getByTestId('stage').boundingBox()
const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = box.width * 0.3
await d.mouse.move(cx, cy)
await d.mouse.down()
for (let i = 0; i <= 80; i++) {
  const a = (i / 80) * Math.PI * 2
  await d.mouse.move(cx + r * Math.sin(a), cy - r * 0.55 * Math.sin(2 * a))
}
await d.mouse.up()
await d.getByTestId('play').click()
await d.waitForTimeout(2600)
await shot(d, 'orbit-figure-eight')

// Perform: hold Pulse and sweep it while playing; capture mid-gesture.
await d.getByRole('button', { name: 'Perform', exact: true }).click()
await d.getByRole('button', { name: 'Pulse', exact: true }).click()
await d.mouse.move(cx - r, cy + r * 0.6)
await d.mouse.down()
for (let i = 0; i <= 30; i++) {
  await d.mouse.move(cx - r + (i / 30) * r * 1.6, cy + r * 0.6 - Math.sin((i / 30) * Math.PI) * r * 0.9)
  await d.waitForTimeout(45)
}
await shot(d, 'orbit-perform')
await d.mouse.up()

const m = await fresh(b, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
await m.waitForTimeout(400)
await shot(m, 'orbit-phone')
await m.screenshot({ path: `${OUT}/orbit-phone-full.jpg`, type: 'jpeg', quality: 80, fullPage: true })
await b.close()

const w = await webkit.launch()
const wd = await fresh(w, { viewport: { width: 1440, height: 900 } })
await wd.getByRole('button', { name: 'Drone', exact: true }).click()
await wd.waitForTimeout(300)
await shot(wd, 'orbit-webkit')
await w.close()
console.log('written to', OUT)
