// PlanetScreen.tsx — home (SPEC §3): the dial, tap-to-collect, Era +
// Habitability, Instability meter, Energy, and the Advance button.

import { useRef, useState } from 'react'
import { canDraw } from '../sim/cards'
import { canAscend, seedYield } from '../sim/prestige'
import { driftDirection } from '../sim/tick'
import { SYSTEM_IDS } from '../sim/types'
import { useGame } from '../state/store'
import { fmtInt } from './format'
import { SHAPE_GLYPH, SYSTEM_META } from './meta'
import { PlanetDial } from './PlanetDial'
import { TransmissionStrip } from './TransmissionStrip'

type Float = { id: number; amount: number }

export function PlanetScreen({ goToCards }: { goToCards: () => void }) {
  const run = useGame((s) => s.run)
  const content = useGame((s) => s.content)
  const tap = useGame((s) => s.tap)
  const draw = useGame((s) => s.draw)
  const [floats, setFloats] = useState<Float[]>([])
  const floatId = useRef(0)

  if (!run) return null
  const { balance } = content
  const era = content.eras[run.era]
  const instabilityPct = Math.min(
    100,
    (run.instability / balance.instability.cascadeThreshold) * 100,
  )
  const pool = run.uncollected * balance.tap.bonusMult
  const drawable = canDraw(run, content)
  const midCard = run.activeCardId !== null

  const onTap = () => {
    const amount = Math.round(pool * 10) / 10
    tap()
    if (amount >= 1) {
      const id = ++floatId.current
      setFloats((f) => [...f, { id, amount }])
      setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 950)
    }
  }

  const onAdvance = () => {
    if (midCard) {
      goToCards()
      return
    }
    draw()
    goToCards()
  }

  return (
    <div className="screen planet-screen">
      <div className="dial-wrap">
        <button
          type="button"
          className="planet-tap"
          onClick={onTap}
          aria-label="Tap the planet to collect minerals"
        >
          <PlanetDial run={run} />
        </button>
        {floats.map((f) => (
          <span key={f.id} className="float-num" aria-hidden>
            +{fmtInt(f.amount)}
          </span>
        ))}
      </div>

      {pool >= 1 ? (
        <p className="gather-hint">
          tap the world to gather {fmtInt(pool)} minerals
        </p>
      ) : (
        <p className="gather-hint dim">the machines are gathering…</p>
      )}

      <TransmissionStrip run={run} />

      {era?.advanceHabitability !== undefined &&
        run.eraProgressSec > 0 &&
        era.stabilizationSec !== undefined && (
          <div className="stabilizing" role="status">
            <div className="stabilizing-bar">
              <div
                className="stabilizing-fill"
                style={{
                  width: `${Math.min(100, (run.eraProgressSec / era.stabilizationSec) * 100)}%`,
                }}
              />
            </div>
            <span>
              stabilizing toward{' '}
              {content.eras[run.era + 1]?.name ?? 'the next era'}…
            </span>
          </div>
        )}

      <div className="system-legend">
        {SYSTEM_IDS.map((id) => {
          const meta = SYSTEM_META[id]
          const s = run.systems[id]
          const dir = driftDirection(run, content, id)
          const out = s.value < s.band[0] || s.value > s.band[1]
          return (
            <div
              key={id}
              className={`legend-chip${out ? ' out-of-band' : ''}`}
              title={`${meta.label}: ${Math.round(s.value)} — safe ${s.band[0]}–${s.band[1]}`}
            >
              <span className="legend-glyph" style={{ color: meta.color }}>
                {SHAPE_GLYPH[meta.shape]}
              </span>
              <span className="legend-label">{meta.short}</span>
              <span className="legend-value">{Math.round(s.value)}</span>
              <span
                className="legend-drift"
                aria-label={dir > 0 ? 'rising' : dir < 0 ? 'falling' : 'steady'}
              >
                {dir > 0 ? '↗' : dir < 0 ? '↘' : '·'}
              </span>
            </div>
          )
        })}
      </div>

      <div className="instability-block">
        <div className="row-between">
          <span className="inst-label">instability</span>
          <span className="inst-value">
            {Math.round(run.instability)} /{' '}
            {balance.instability.cascadeThreshold}
          </span>
        </div>
        <div
          className={`inst-bar${instabilityPct > 75 ? ' danger' : instabilityPct > 50 ? ' warn' : ''}`}
          role="meter"
          aria-label="Instability"
          aria-valuemin={0}
          aria-valuemax={balance.instability.cascadeThreshold}
          aria-valuenow={Math.round(run.instability)}
        >
          <div className="inst-fill" style={{ width: `${instabilityPct}%` }} />
        </div>
      </div>

      <button
        type="button"
        className="btn-primary advance-btn"
        onClick={onAdvance}
        disabled={!midCard && !drawable}
      >
        {midCard
          ? 'Return to the card'
          : drawable
            ? 'Advance — draw a card'
            : 'The world rests'}
      </button>

      {canAscend(run, content) && <AscendButton />}
    </div>
  )
}

/**
 * Voluntary Ascension (SPEC §2.8), offered only at the final era. Ending a
 * living world deserves a second thought, so the first tap arms the button
 * and the second commits; tapping anything else would leave it armed, so it
 * disarms itself after a beat.
 */
function AscendButton() {
  const run = useGame((s) => s.run)
  const content = useGame((s) => s.content)
  const ascendRun = useGame((s) => s.ascendRun)
  const [armed, setArmed] = useState(false)
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (!run) return null
  const seeds = seedYield(run, content, 'ascension')

  const onTap = () => {
    if (armed) {
      if (disarmTimer.current) clearTimeout(disarmTimer.current)
      ascendRun()
      return
    }
    setArmed(true)
    if (disarmTimer.current) clearTimeout(disarmTimer.current)
    disarmTimer.current = setTimeout(() => setArmed(false), 4000)
  }

  return (
    <button
      type="button"
      className={`btn-secondary ascend-btn${armed ? ' armed' : ''}`}
      onClick={onTap}
    >
      {armed
        ? `Leave it living — claim ✦ ${seeds}?`
        : `Ascend — the world can stand alone (✦ ${seeds})`}
    </button>
  )
}
