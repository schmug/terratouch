// AwayModal.tsx — "While you were away…" (SPEC §4.3): what safe offline
// growth brought back. Only shown for gaps worth mentioning.

import type { AwaySummary } from '../sim/types'
import { SYSTEM_IDS } from '../sim/types'
import { useGame } from '../state/store'
import { fmtInt, prettyDuration } from './format'
import { SHAPE_GLYPH, SYSTEM_META } from './meta'

export function AwayModal({ summary }: { summary: AwaySummary }) {
  const dismiss = useGame((s) => s.dismissAwaySummary)
  const drifted = SYSTEM_IDS.filter(
    (id) => Math.abs(summary.systemDeltas[id]) >= 0.5,
  )

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="While you were away"
    >
      <div className="sheet away-sheet">
        <h2 className="away-title">While you were away</h2>
        <p className="away-sub">
          {prettyDuration(summary.elapsedMs)}
          {summary.capped ? ' (the world can only wait so long)' : ''} of quiet,
          safe growth
        </p>

        <div className="away-gains">
          {summary.mineralsGained >= 1 && (
            <span className="away-gain">
              ◇ +{fmtInt(summary.mineralsGained)} minerals
            </span>
          )}
          {summary.energyGained >= 0.5 && (
            <span className="away-gain">
              ⚡ +{Math.round(summary.energyGained)} energy
            </span>
          )}
        </div>

        {drifted.length > 0 && (
          <div className="away-drift">
            {drifted.map((id) => {
              const meta = SYSTEM_META[id]
              const d = summary.systemDeltas[id]
              return (
                <span
                  key={id}
                  className="away-drift-chip"
                  style={{ color: meta.color }}
                >
                  {SHAPE_GLYPH[meta.shape]} {d > 0 ? '+' : ''}
                  {Math.round(d)}
                </span>
              )
            })}
          </div>
        )}

        <p className="away-note">
          nothing was risked while you were gone — danger only follows your hand
        </p>

        <button type="button" className="btn-primary" onClick={dismiss}>
          Good to be back
        </button>
      </div>
    </div>
  )
}
