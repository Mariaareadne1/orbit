// README screenshots from the running dev server (pnpm dev). Headless: nothing is audible.
import { chromium } from '@playwright/test'
const APP = process.env.ORBIT_URL ?? 'http://localhost:5431/'
const OUT = new URL('../docs/media/', import.meta.url).pathname
const browser = await chromium.launch({ args: ['--use-angle=metal'] })

const d = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage()
await d.goto(APP)
await d.evaluate(() => localStorage.clear())
await d.reload()
await d.getByTestId('play').click()
await d.waitForTimeout(3300)
await d.screenshot({ path: `${OUT}orbit-playing.jpg`, type: 'jpeg', quality: 88 })
await d.getByRole('button', { name: 'Pause' }).click()

// Draw a figure-eight for Plucks.
const box = await d.getByTestId('stage').boundingBox()
const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = box.width * 0.28
await d.mouse.move(cx, cy)
await d.mouse.down()
for (let i = 0; i <= 80; i++) {
  const a = (i / 80) * Math.PI * 2
  await d.mouse.move(cx + r * Math.sin(a), cy - r * 0.55 * Math.sin(2 * a))
}
await d.mouse.up()
await d.getByTestId('play').click()
await d.waitForTimeout(2600)
await d.screenshot({ path: `${OUT}orbit-figure-eight.jpg`, type: 'jpeg', quality: 88 })

const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage()
await m.goto(APP)
await m.evaluate(() => localStorage.clear())
await m.reload()
await m.waitForTimeout(500)
await m.screenshot({ path: `${OUT}orbit-mobile.jpg`, type: 'jpeg', quality: 88 })
await browser.close()
console.log('written to', OUT)
