// App.tsx — the shell: header (minerals + energy), active screen, tab bar,
// and the two modal layers (away summary, loss). One-thumb, mobile-first
// (SPEC §3).

import { useEffect, useState } from 'react'
import { useGame } from '../state/store'
import { AwayModal } from './AwayModal'
import { BuildScreen } from './BuildScreen'
import { CardsScreen } from './CardsScreen'
import { fmtInt } from './format'
import { LossModal } from './LossModal'
import { PlanetScreen } from './PlanetScreen'
import { SynthesisScreen } from './SynthesisScreen'
import { TabBar, type Tab } from './TabBar'

function EnergyPips({
  energy,
  cap,
  reserve,
}: {
  energy: number
  cap: number
  reserve: number
}) {
  const whole = Math.floor(energy)
  const frac = energy - whole
  // Bonus energy (phenomena, rewards) may overfill the cap into the reserve
  // (Session Arc slice A): render the overfill as extra, dashed pips.
  const extra = Math.min(reserve, Math.max(0, Math.ceil(energy - cap)))
  return (
    <span
      className="energy-pips"
      aria-label={`Energy ${whole} of ${cap}${whole > cap ? ' (reserve)' : ''}`}
    >
      <span className="energy-glyph" aria-hidden>
        ⚡
      </span>
      {Array.from({ length: cap + extra }, (_, i) => {
        const fill = i < whole ? 1 : i === whole ? frac : 0
        return (
          <span
            key={i}
            className={`pip${i >= cap ? ' reserve' : ''}`}
            aria-hidden
          >
            <span className="pip-fill" style={{ width: `${fill * 100}%` }} />
          </span>
        )
      })}
    </span>
  )
}

export function App() {
  const loaded = useGame((s) => s.loaded)
  const run = useGame((s) => s.run)
  const awaySummary = useGame((s) => s.awaySummary)
  const content = useGame((s) => s.content)
  const [tab, setTab] = useState<Tab>('planet')

  useEffect(() => {
    void useGame.getState().init()
  }, [])

  // Battery: index.css pauses all ambient animation under .tab-hidden.
  useEffect(() => {
    const onVisibility = () =>
      document.documentElement.classList.toggle(
        'tab-hidden',
        document.visibilityState === 'hidden',
      )
    document.addEventListener('visibilitychange', onVisibility)
    onVisibility()
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  if (!loaded || !run) {
    return (
      <main className="splash">
        <div className="splash-planet" aria-hidden />
        <h1 className="splash-title">TerraTouch</h1>
        <p className="splash-sub">waking the world…</p>
      </main>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <span
          className="header-minerals"
          aria-label={`${fmtInt(run.resources.minerals)} minerals`}
        >
          <span aria-hidden>◇</span> {fmtInt(run.resources.minerals)}
        </span>
        <span className="header-title">TerraTouch</span>
        <EnergyPips
          energy={run.energy}
          cap={content.balance.energy.cap}
          reserve={content.balance.energy.reserve}
        />
      </header>

      <main className="app-main">
        {tab === 'planet' && <PlanetScreen goToCards={() => setTab('cards')} />}
        {tab === 'cards' && <CardsScreen />}
        {tab === 'build' && <BuildScreen />}
        {tab === 'synthesis' && <SynthesisScreen />}
      </main>

      <TabBar tab={tab} onSelect={setTab} />

      {awaySummary && !run.collapse && <AwayModal summary={awaySummary} />}
      {run.collapse && <LossModal report={run.collapse} />}
    </div>
  )
}
