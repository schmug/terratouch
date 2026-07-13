// M1 acceptance walk (SPEC §7) — drives the built PWA end-to-end with
// system Chrome via playwright-core (no browser download; needs Chrome
// installed). 27 checks: install/SW, play burst (swipe + buttons), build +
// setpoints, offline-gap safety invariants, both collapse kinds, templated
// chronicle, loss persistence, new world, no-network reload, reduced motion.
//
// Usage:
//   npm run build && npm run preview &     # or any deployed URL
//   npm run walk                           # defaults to http://localhost:4173
//   WALK_BASE=https://terratouch.pages.dev npm run walk
//
// Prints PASS/FAIL per check, exits non-zero on any failure, and drops
// screenshots into tests/e2e/shots/ (gitignored). Not part of `npm test` —
// it needs Chrome and a running server, so run it deliberately before
// shipping UI changes.
//
// NOTE: it rigs saves through IndexedDB to force offline gaps and collapses,
// so only ever point it at a browser profile you don't care about (its
// playwright context is ephemeral, so the default is always safe).
import { chromium } from 'playwright-core'

const BASE = process.env.WALK_BASE ?? 'http://localhost:4173'
const SHOTS = new URL('./shots/', import.meta.url).pathname
import { mkdirSync } from 'node:fs'
mkdirSync(SHOTS, { recursive: true })

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'allow',
})
const page = await context.newPage()
page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message))
const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})

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

// ---------------------------------------------------------------- 1. load
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForSelector('.app-header', { timeout: 10_000 })
check('app loads to the Planet screen', await page.isVisible('.planet-dial'))
await page.screenshot({ path: `${SHOTS}01-planet.png` })

// installability: manifest + service worker
const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href')
check('web app manifest linked', Boolean(manifestHref), manifestHref ?? '')
const swReady = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return false
  for (let i = 0; i < 40; i++) {
    const reg = await navigator.serviceWorker.getRegistration()
    if (reg?.active) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
})
check('service worker active (installable/offline-capable)', swReady)

// ------------------------------------------------- 2. play a burst
const save0 = await readSave().catch(() => null)
const energyBefore = await page.evaluate(() => document.querySelectorAll('.pip-fill').length)
check('energy pips rendered', energyBefore > 0, `${energyBefore} pips`)

// tap-to-collect (give the pool a moment to accrue)
await page.waitForTimeout(4000)
await page.click('.planet-tap')
await page.waitForTimeout(300)
await page.screenshot({ path: `${SHOTS}02-tapped.png` })

// draw + resolve several cards via the Advance button and choice buttons
let resolved = 0
for (let i = 0; i < 5; i++) {
  await page.click('.tab-btn:nth-child(1)')
  const advance = page.locator('.advance-btn')
  if ((await advance.textContent())?.includes('rests')) break
  await advance.click()
  await page.waitForSelector('.event-card', { timeout: 5000 })
  if (i === 0) await page.screenshot({ path: `${SHOTS}03-card.png` })
  // swipe the first card with a real drag; use buttons afterwards
  if (i === 0) {
    const box = await page.locator('.event-card').boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let s = 1; s <= 8; s++) await page.mouse.move(cx + s * 16, cy - s * 2)
    await page.screenshot({ path: `${SHOTS}04-card-drag.png` })
    await page.mouse.up()
  } else {
    await page.click(i % 2 === 0 ? '.choice-buttons .btn-choice:first-child' : '.choice-buttons .btn-choice:last-child')
  }
  await page.waitForSelector('.event-card', { state: 'detached', timeout: 5000 })
  resolved++
  if (await page.isVisible('.loss-sheet')) break
}
check('cards draw and resolve (swipe + buttons)', resolved >= 3, `${resolved} resolved`)
await page.screenshot({ path: `${SHOTS}05-after-cards.png` })

let save1 = await readSave()
check('turns recorded in save', (save1?.run?.turns ?? 0) >= resolved, `turns=${save1?.run?.turns}`)
check(
  'energy spent by draws',
  (save1?.run?.energy ?? 99) <= 10 - resolved + 2,
  `energy=${save1?.run?.energy?.toFixed(2)}`,
)

// --------------------------------------------- 3. build a machine + setpoint
await page.click('.tab-btn:nth-child(3)')
await page.screenshot({ path: `${SHOTS}06-build.png` })
// ensure affordability: top up minerals through the save, reload
save1.run.resources.minerals = Math.max(save1.run.resources.minerals, 200)
save1.lastSeenMs = Date.now()
await writeSave(save1)
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.app-header')
await page.click('.tab-btn:nth-child(3)')
const buildBtn = page.locator('.machine-row .btn-secondary').first()
await buildBtn.click()
await page.waitForTimeout(3500) // debounced autosave
const save2 = await readSave()
check('machine built and paid for', (save2?.run?.machines?.length ?? 0) >= 1, JSON.stringify(save2?.run?.machines))
const slider = page.locator('.setpoint-row input[type="range"]').first()
check('setpoint slider appears once built', await slider.isVisible())
await slider.fill('60')
await page.waitForTimeout(3500) // debounced autosave
const save3 = await readSave()
check('setpoint persisted', save3?.run?.systems?.thermal?.setpoint === 60, `setpoint=${save3?.run?.systems?.thermal?.setpoint}`)
await page.screenshot({ path: `${SHOTS}07-build-after.png` })

// ------------------------------------- 4. offline gap → safe growth + summary
const before = await readSave()
const instabilityBefore = before.run.instability
const mineralsBefore = before.run.resources.minerals
const eraProgressBefore = before.run.eraProgressSec
before.lastSeenMs = Date.now() - 2 * 3600_000 // "away for two hours"
await writeSave(before)
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.away-sheet', { timeout: 10_000 })
await page.screenshot({ path: `${SHOTS}08-away.png` })
const awayText = await page.textContent('.away-sheet')
check('away summary shown after a 2h gap', awayText?.includes('While you were away') ?? false)

const after = await readSave()
check('offline NEVER adds instability', after.run.instability === instabilityBefore, `${instabilityBefore} → ${after.run.instability}`)
check('offline grants minerals', after.run.resources.minerals > mineralsBefore, `${mineralsBefore.toFixed(0)} → ${after.run.resources.minerals.toFixed(0)}`)
check('offline never advances era progress', after.run.eraProgressSec === eraProgressBefore, `${eraProgressBefore} → ${after.run.eraProgressSec}`)
const bandsOk = Object.entries(after.run.systems).every(([id, s]) => {
  const b = before.run.systems[id]
  const wasIn = b.value >= b.band[0] && b.value <= b.band[1]
  return wasIn ? s.value >= s.band[0] && s.value <= s.band[1] : true
})
check('offline drift stays inside safe bands', bandsOk)
check('offline refills energy toward cap', after.run.energy >= before.run.energy, `${before.run.energy.toFixed(1)} → ${after.run.energy.toFixed(1)}`)
await page.click('.away-sheet .btn-primary')

// --------------------------------------------------- 5. collapse + chronicle
// Rig a near-cascade state (instability 99, biosphere out of band), then
// take one turn — deterministic collapse via the real resolve path.
const rig = await readSave()
rig.run.instability = 99
rig.run.systems.biosphere.value = 0.6
rig.run.energy = Math.max(rig.run.energy, 3)
rig.run.history.turnsOutOfBand.biosphere = 7
rig.lastSeenMs = Date.now()
await writeSave(rig)
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.app-header')
await page.click('.advance-btn')
await page.waitForSelector('.event-card')
await page.click('.choice-buttons .btn-choice:first-child')
await page.waitForSelector('.loss-sheet', { timeout: 5000 })
await page.waitForFunction(() => {
  const el = document.querySelector('.chronicle-text')
  return el && el.textContent && el.textContent.length > 40
})
await page.screenshot({ path: `${SHOTS}09-loss.png` })
const chronicle = await page.textContent('.chronicle-text')
const lossText = await page.textContent('.loss-sheet')
check('cascade collapse reaches the loss screen', Boolean(lossText?.includes('A World, Concluded')))
check('templated chronicle rendered (no network)', (chronicle?.length ?? 0) > 60, `${chronicle?.split(' ').length} words`)
check('chronicle names the cascade', chronicle?.toLowerCase().includes('cascade') ?? false)
check('chronicle stays ≤120 words', (chronicle?.split(/\s+/).length ?? 999) <= 120)

// persistence of the loss across reload
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.loss-sheet', { timeout: 10_000 })
check('loss state survives reload', true)

// begin new world
await page.click('.begin-btn')
await page.waitForTimeout(400)
const fresh = await readSave()
check('Begin New World starts a fresh run', fresh.run.collapse === null && fresh.run.turns === 0 && fresh.run.instability === 0)
check('meta stats persist across runs', fresh.meta.stats.runs >= 2 && fresh.meta.stats.longestRun > 0, JSON.stringify(fresh.meta.stats))
await page.screenshot({ path: `${SHOTS}10-newworld.png` })

// --------------------------------------------------- 6. hard-fail collapse
const rig2 = await readSave()
rig2.run.systems.thermal.value = 99.2
rig2.run.energy = 10
rig2.lastSeenMs = Date.now()
await writeSave(rig2)
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.app-header')
let hardFailed = false
for (let i = 0; i < 10 && !hardFailed; i++) {
  await page.click('.tab-btn:nth-child(1)')
  const advance = page.locator('.advance-btn')
  if ((await advance.textContent())?.includes('rests')) break
  await advance.click()
  await page.waitForSelector('.event-card')
  // Pick whichever choice telegraphs thermal-up (the ●▲ chip); the chips
  // are exactly what a player reads off the card edges.
  const buttons = page.locator('.choice-buttons .btn-choice')
  const leftChips = (await buttons.nth(0).textContent()) ?? ''
  const rightChips = (await buttons.nth(1).textContent()) ?? ''
  if (leftChips.includes('●▲')) await buttons.nth(0).click()
  else if (rightChips.includes('●▲')) await buttons.nth(1).click()
  else await buttons.nth(i % 2).click()
  await page.waitForSelector('.event-card', { state: 'detached' })
  hardFailed = await page.isVisible('.loss-sheet')
}
if (hardFailed) {
  const text = await page.textContent('.loss-sheet')
  check('hard-fail collapse path works in UI', true, text?.includes('edge') ? 'edge named' : '')
  await page.screenshot({ path: `${SHOTS}11-hardfail.png` })
} else {
  check('hard-fail collapse path works in UI', false, 'no hard fail in 12 turns from 97 thermal (may be ok — cards drifted cool)')
}

// --------------------------------------------------- 7. fully offline reload
await context.setOffline(true)
await page.reload({ waitUntil: 'load' }).catch(() => {})
const offlineOk = await page.waitForSelector('.app-header', { timeout: 10_000 }).then(() => true).catch(() => false)
check('app loads with NO network (service worker)', offlineOk)
await page.screenshot({ path: `${SHOTS}12-offline.png` })
await context.setOffline(false)

// --------------------------------------------------- 8. reduced motion
const rmPage = await context.newPage()
await rmPage.emulateMedia({ reducedMotion: 'reduce' })
await rmPage.goto(BASE, { waitUntil: 'load' })
await rmPage.waitForSelector('.app-header')
if (await rmPage.isVisible('.loss-sheet')) {
  // previous step's collapse is still the saved state — start fresh
  await rmPage.click('.begin-btn')
  await rmPage.waitForSelector('.loss-sheet', { state: 'detached' })
}
await rmPage.click('.planet-tap')
check('works under prefers-reduced-motion', await rmPage.isVisible('.planet-dial'))
await rmPage.screenshot({ path: `${SHOTS}13-reduced-motion.png` })
await rmPage.close()

check('no console errors during the walk', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

console.log('\n==== SUMMARY ====')
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} checks passed`)
for (const f of failed) console.log(`FAILED: ${f.name} ${f.detail}`)

await browser.close()
process.exit(failed.length > 0 ? 1 : 0)
