// BuildScreen.tsx — machines list (SPEC §3): place, upgrade, set setpoints.
// Minimal, chunky rows; every control ≥44px.

import { content } from '../data'
import { machineCost, machineOfType } from '../sim/actions'
import { useGame } from '../state/store'
import { fmtInt } from './format'
import { SHAPE_GLYPH, SYSTEM_META } from './meta'

export function BuildScreen() {
  const run = useGame((s) => s.run)
  const build = useGame((s) => s.build)
  const setpoint = useGame((s) => s.setpoint)

  if (!run) return null
  const minerals = run.resources.minerals

  return (
    <div className="screen build-screen">
      <p className="build-intro">
        Machines steer the world while you're away — each pushes one system
        toward its setpoint.
      </p>

      {content.machines.map((def) => {
        const meta = SYSTEM_META[def.system]
        const instance = machineOfType(run, def.id)
        const level = instance?.level ?? 0
        const maxed = level >= def.maxLevel
        const cost = maxed ? 0 : machineCost(def, level + 1)
        const affordable = !maxed && minerals >= cost
        const sp = run.systems[def.system].setpoint

        return (
          <div key={def.id} className="machine-row">
            <div className="machine-head">
              <div>
                <h3 className="machine-name">{def.name}</h3>
                <p className="machine-blurb">{def.blurb}</p>
              </div>
              <span className="machine-system" style={{ color: meta.color }}>
                {SHAPE_GLYPH[meta.shape]} {meta.short}
              </span>
            </div>

            <div className="machine-controls">
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
                className="btn-secondary"
                disabled={!affordable}
                onClick={() => build(def.id)}
              >
                {maxed
                  ? 'At full hum'
                  : level === 0
                    ? `Build — ◇ ${fmtInt(cost)}`
                    : `Upgrade — ◇ ${fmtInt(cost)}`}
              </button>
            </div>

            {level > 0 && (
              <label className="setpoint-row">
                <span className="setpoint-label">
                  setpoint{' '}
                  <strong style={{ color: meta.color }}>
                    {Math.round(sp)}
                  </strong>
                </span>
                <input
                  type="range"
                  min={content.balance.setpoint.min}
                  max={content.balance.setpoint.max}
                  step={1}
                  value={Math.round(sp)}
                  onChange={(e) => setpoint(def.system, Number(e.target.value))}
                  style={{ accentColor: meta.color }}
                  aria-label={`${meta.label} setpoint`}
                />
              </label>
            )}
          </div>
        )
      })}

      <p className="build-note">
        The biosphere has no machine yet — living things answer only to the
        cards.
      </p>
    </div>
  )
}
