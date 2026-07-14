// era-shots.mjs — capture the planet dial in every era for the README
// (issue #10: "the portfolio shot"). Same contract as acceptance-walk.mjs:
// needs Chrome and a running server, and rigs saves through IndexedDB, so
// only point it at a browser profile you don't care about (the ephemeral
// playwright context default is always safe).
//
// Usage:
//   npm run build && npm run preview &
//   npm run shots                          # or SHOTS_BASE=<url> npm run shots
//
// Writes docs/shots/era-<n>-<id>.png (repo-relative, committed). To rebuild
// the README GIF from them (any ffmpeg works, e.g. playwright's):
//   ffmpeg -y -framerate 0.8 -i docs/shots/era-%d.png ... — see docs/shots/README.md
import { readFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const BASE = process.env.SHOTS_BASE ?? 'http://localhost:4173'
const OUT = new URL('../../../docs/shots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const eras = JSON.parse(
  readFileSync(new URL('../../src/data/eras.json', import.meta.url), 'utf8'),
)

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
})
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const page = await context.newPage()
page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message))

async function readSave() {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('terratouch', 1)
        open.onsuccess = () => {
          const tx = open.result.transaction('saves', 'readonly')
          const get = tx.objectStore('saves').get('main')
          get.onsuccess = () => resolve(get.result ?? null)
          get.onerror = () => reject(get.error)
        }
        open.onerror = () => reject(open.error)
      }),
  )
}

async function writeSave(save) {
  return page.evaluate(
    (s) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('terratouch', 1)
        open.onsuccess = () => {
          const tx = open.result.transaction('saves', 'readwrite')
          tx.objectStore('saves').put(s, 'main')
          tx.oncomplete = () => resolve(true)
          tx.onerror = () => reject(tx.error)
        }
        open.onerror = () => reject(open.error)
      }),
    save,
  )
}

// Boot once so a fresh save exists, then rig it into each era: gauges at
// band midpoints (in-band, healthy hab so the glow and aurora show), calm
// instability, no pending card.
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForSelector('.planet-dial', { timeout: 10_000 })

for (let i = 0; i < eras.length; i++) {
  const era = eras[i]
  const save = await readSave()
  save.run.era = i
  save.run.eraProgressSec = 0
  save.run.instability = 0
  save.run.activeCardId = null
  for (const [id, band] of Object.entries(era.bands)) {
    save.run.systems[id].band = band
    save.run.systems[id].value = (band[0] + band[1]) / 2
  }
  save.lastSeenMs = Date.now()
  await writeSave(save)
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.planet-dial', { timeout: 10_000 })
  await page.waitForTimeout(900) // let the palette cross-fade settle
  const file = `${OUT}era-${i}-${era.id}.png`
  await page.locator('.dial-wrap').screenshot({ path: file })
  console.log(`shot ${file}`)
}

await browser.close()
