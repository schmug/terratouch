// LossModal.tsx — the loss screen (SPEC §3): stat recap, the Chronicle
// (templated in M1; the LLM flag stays off), and Begin New World. The
// chronicle can never block — narrate() falls back locally (SPEC §5.4).

import { useEffect, useState } from 'react'
import { narrate } from '../net/narrate'
import { SYSTEM_IDS, type CollapseReport } from '../sim/types'
import { useGame } from '../state/store'
import { SHAPE_GLYPH, SYSTEM_META } from './meta'

function causeLine(report: CollapseReport): string {
  const meta = SYSTEM_META[report.cause.system]
  if (report.cause.kind === 'hard-fail') {
    return `${meta.label} reached its ${report.cause.direction === 'low' ? 'cold, empty' : 'far, violent'} edge`
  }
  return `Instability cascaded — ${meta.label.toLowerCase()} strayed too long`
}

export function LossModal({ report }: { report: CollapseReport }) {
  const beginNewRun = useGame((s) => s.beginNewRun)
  const [chronicle, setChronicle] = useState<string | null>(null)

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
    <div className="overlay" role="dialog" aria-modal="true" aria-label="The world has ended">
      <div className="sheet loss-sheet">
        <p className="chronicle-kicker">the chronicle records</p>
        <h2 className="loss-title">A World, Concluded</h2>

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

        <p className="loss-cause">{causeLine(report)}</p>

        <div className="final-gauges" aria-label="final system values">
          {SYSTEM_IDS.map((id) => {
            const meta = SYSTEM_META[id]
            return (
              <span key={id} className="final-gauge" style={{ color: meta.color }}>
                {SHAPE_GLYPH[meta.shape]} {Math.round(report.systemsFinal[id])}
              </span>
            )
          })}
        </div>

        <hr className="chronicle-rule" />
        <p className="chronicle-text">{chronicle ?? '…'}</p>
        <hr className="chronicle-rule" />

        <button type="button" className="btn-primary begin-btn" onClick={beginNewRun}>
          Begin New World
        </button>
        <p className="loss-footnote">every ending is a place to plant something</p>
      </div>
    </div>
  )
}
