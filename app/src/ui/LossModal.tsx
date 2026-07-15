// LossModal.tsx — the end-of-run screen (SPEC §3): stat recap with the Seed
// yield, the Chronicle (templated in M1; the LLM flag stays off), the Seed
// shop, the next-world archetype picker (SPEC §2.8 — spend between worlds),
// and Begin New World. An Ascension renders the same sheet in its triumphant
// key. The chronicle can never block — narrate() falls back locally (§5.4).

import { useEffect, useState } from 'react'
import { narrate } from '../net/narrate'
import { upgradeCost } from '../sim/prestige'
import { SYSTEM_IDS, type CollapseReport } from '../sim/types'
import { useGame } from '../state/store'
import { SHAPE_GLYPH, SYSTEM_META } from './meta'

function causeLine(report: CollapseReport): string {
  if (report.cause.kind === 'ascension') {
    return 'You chose the leaving — the world turns on without you'
  }
  const meta = SYSTEM_META[report.cause.system]
  if (report.cause.kind === 'hard-fail') {
    return `${meta.label} reached its ${report.cause.direction === 'low' ? 'cold, empty' : 'far, violent'} edge`
  }
  return `Instability cascaded — ${meta.label.toLowerCase()} strayed too long`
}

function ArchetypePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (id: string) => void
}) {
  const meta = useGame((s) => s.meta)
  const content = useGame((s) => s.content)
  const selected = content.archetypes.find((a) => a.id === value)

  return (
    <div className="archetype-picker">
      <p className="seed-shop-title">the next world</p>
      <div className="archetype-row" role="radiogroup" aria-label="archetype">
        {content.archetypes.map((a) => {
          const unlocked = meta.unlockedArchetypes.includes(a.id)
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={value === a.id}
              className={`archetype-chip${value === a.id ? ' selected' : ''}`}
              disabled={!unlocked}
              onClick={() => onChange(a.id)}
            >
              {a.name}
              {!unlocked && <span className="chip-locked"> · locked</span>}
            </button>
          )
        })}
      </div>
      {selected && <p className="archetype-blurb">{selected.blurb}</p>}
    </div>
  )
}

function SeedShop() {
  const meta = useGame((s) => s.meta)
  const content = useGame((s) => s.content)
  const buy = useGame((s) => s.buy)

  return (
    <div className="seed-shop">
      <p className="seed-shop-title">
        carry something forward — <span aria-hidden>✦</span> {meta.genesisSeeds}{' '}
        seed{meta.genesisSeeds === 1 ? '' : 's'} banked
      </p>
      {content.upgrades.map((def) => {
        const level = meta.upgrades[def.id] ?? 0
        const maxed = level >= def.maxLevel
        const cost = maxed ? 0 : upgradeCost(def, level + 1)
        const affordable = !maxed && meta.genesisSeeds >= cost
        return (
          <div key={def.id} className="shop-row">
            <div className="shop-info">
              <span className="shop-name">{def.name}</span>
              <span className="shop-blurb">{def.blurb}</span>
            </div>
            <div className="shop-buy">
              <span
                className="machine-level"
                aria-label={`level ${level} of ${def.maxLevel}`}
              >
                {Array.from({ length: def.maxLevel }, (_, i) => (
                  <span
                    key={i}
                    className={`level-dot${i < level ? ' on' : ''}`}
                  />
                ))}
              </span>
              <button
                type="button"
                className="btn-secondary shop-btn"
                disabled={!affordable}
                onClick={() => buy(def.id)}
              >
                {maxed ? 'woven in' : `✦ ${cost}`}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function LossModal({ report }: { report: CollapseReport }) {
  const beginNewRun = useGame((s) => s.beginNewRun)
  const endedArchetypeId = useGame((s) => s.run?.archetypeId)
  const [chronicle, setChronicle] = useState<string | null>(null)
  const [nextArchetype, setNextArchetype] = useState(
    endedArchetypeId ?? 'barren',
  )
  const ascended = report.cause.kind === 'ascension'

  useEffect(() => {
    let alive = true
    void narrate(report).then((n) => {
      if (alive) setChronicle(n.chronicle)
    })
    return () => {
      alive = false
    }
  }, [report])

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={ascended ? 'The world has ascended' : 'The world has ended'}
    >
      <div className="sheet loss-sheet">
        <p className="chronicle-kicker">the chronicle records</p>
        <h2 className="loss-title">
          {ascended ? 'A World, Ascended' : 'A World, Concluded'}
        </h2>

        <div className="loss-stats">
          <div className="loss-stat">
            <span className="loss-stat-value">{report.eraReached}</span>
            <span className="loss-stat-label">era reached</span>
          </div>
          <div className="loss-stat">
            <span className="loss-stat-value">{report.turnsSurvived}</span>
            <span className="loss-stat-label">turns</span>
          </div>
          <div className="loss-stat">
            <span className="loss-stat-value">{report.peakHabitability}</span>
            <span className="loss-stat-label">peak habitability</span>
          </div>
        </div>

        <p className={ascended ? 'ascend-cause' : 'loss-cause'}>
          {causeLine(report)}
        </p>

        <div className="final-gauges" aria-label="final system values">
          {SYSTEM_IDS.map((id) => {
            const meta = SYSTEM_META[id]
            return (
              <span
                key={id}
                className="final-gauge"
                style={{ color: meta.color }}
              >
                {SHAPE_GLYPH[meta.shape]} {Math.round(report.systemsFinal[id])}
              </span>
            )
          })}
        </div>

        <p className="seeds-earned">
          <span aria-hidden>✦</span> +{report.seedsAwarded} genesis seed
          {report.seedsAwarded === 1 ? '' : 's'}
        </p>

        <hr className="chronicle-rule" />
        <p className="chronicle-text">{chronicle ?? '…'}</p>
        <hr className="chronicle-rule" />

        <SeedShop />

        <ArchetypePicker value={nextArchetype} onChange={setNextArchetype} />

        <button
          type="button"
          className="btn-primary begin-btn"
          onClick={() => beginNewRun(nextArchetype)}
        >
          Begin New World
        </button>
        <p className="loss-footnote">
          {ascended
            ? 'what you planted will remember you'
            : 'every ending is a place to plant something'}
        </p>
      </div>
    </div>
  )
}
