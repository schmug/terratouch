// App.tsx — the shell: header (minerals + energy), active screen, tab bar,
// and the two modal layers (away summary, loss). One-thumb, mobile-first
// (SPEC §3).

import { useEffect, useState } from 'react'
import { content } from '../data'
import { useGame } from '../state/store'
import { AwayModal } from './AwayModal'
import { BuildScreen } from './BuildScreen'
import { CardsScreen } from './CardsScreen'
import { fmtInt } from './format'
import { LossModal } from './LossModal'
import { PlanetScreen } from './PlanetScreen'
import { SynthesisScreen } from './SynthesisScreen'
import { TabBar, type Tab } from './TabBar'

function EnergyPips({ energy, cap }: { energy: number; cap: number }) {
  const whole = Math.floor(energy)
  const frac = energy - whole
  return (
    <span className="energy-pips" aria-label={`Energy ${whole} of ${cap}`}>
      <span className="energy-glyph" aria-hidden>
        ⚡
      </span>
      {Array.from({ length: cap }, (_, i) => {
        const fill = i < whole ? 1 : i === whole ? frac : 0
        return (
          <span key={i} className="pip" aria-hidden>
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
  const [tab, setTab] = useState<Tab>('planet')

  useEffect(() => {
    void useGame.getState().init()
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
        <EnergyPips energy={run.energy} cap={content.balance.energy.cap} />
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
