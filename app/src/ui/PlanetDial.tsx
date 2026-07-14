// PlanetDial.tsx — the astrolabe: a stylized planet ringed by four arc
// gauges, each showing value, safe band, and drift (SPEC §3). Markers are
// shape-coded per system and hold fixed positions (top/right/bottom/left)
// so the encoding survives colorblindness. The planet itself is painted by
// PlanetVisuals (era palette + ambient layers, issue #10); the gauges stay
// on top — they are information, ambiance is not.

import { content } from '../data'
import { driftDirection } from '../sim/tick'
import { habitability } from '../sim/systems'
import { SYSTEM_IDS, type RunState, type SystemId } from '../sim/types'
import { SYSTEM_META, type MarkerShape } from './meta'
import { PlanetVisuals, Starfield } from './PlanetVisuals'

const CX = 160
const CY = 160
const R = 138
const SPAN = 76 // degrees per gauge arc

/** Gauge center angles: 0 = top, clockwise (fixed positions per system). */
const CENTER_ANGLE: Record<SystemId, number> = {
  thermal: 0,
  atmosphere: 90,
  hydro: 180,
  biosphere: 270,
}

function polar(r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)]
}

function arcPath(r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r, a0)
  const [x1, y1] = polar(r, a1)
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

function valueAngle(system: SystemId, value: number): number {
  const c = CENTER_ANGLE[system]
  return c - SPAN / 2 + (value / 100) * SPAN
}

function Marker({
  shape,
  x,
  y,
  color,
}: {
  shape: MarkerShape
  x: number
  y: number
  color: string
}) {
  const stroke = '#0a0e1a'
  switch (shape) {
    case 'circle':
      return (
        <circle
          cx={x}
          cy={y}
          r={7}
          fill={color}
          stroke={stroke}
          strokeWidth={2}
        />
      )
    case 'diamond':
      return (
        <rect
          x={x - 5.5}
          y={y - 5.5}
          width={11}
          height={11}
          fill={color}
          stroke={stroke}
          strokeWidth={2}
          transform={`rotate(45 ${x} ${y})`}
        />
      )
    case 'square':
      return (
        <rect
          x={x - 5.5}
          y={y - 5.5}
          width={11}
          height={11}
          rx={1.5}
          fill={color}
          stroke={stroke}
          strokeWidth={2}
        />
      )
    case 'triangle':
      return (
        <polygon
          points={`${x},${y - 7} ${x + 6.5},${y + 5} ${x - 6.5},${y + 5}`}
          fill={color}
          stroke={stroke}
          strokeWidth={2}
        />
      )
  }
}

function DriftArrow({ system, run }: { system: SystemId; run: RunState }) {
  const dir = driftDirection(run, content, system)
  if (dir === 0) return null
  const theta = valueAngle(system, run.systems[system].value)
  const [x1, y1] = polar(R, theta + dir * 5)
  const [x2, y2] = polar(R, theta + dir * 10)
  const rot = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
  return (
    <polygon
      points="0,-3.5 6,0 0,3.5"
      transform={`translate(${x2.toFixed(2)} ${y2.toFixed(2)}) rotate(${rot.toFixed(1)})`}
      fill={SYSTEM_META[system].color}
      opacity={0.9}
    />
  )
}

export function PlanetDial({ run }: { run: RunState }) {
  const era = content.eras[run.era]
  const hab = habitability(run.systems)

  return (
    <svg
      viewBox="0 0 320 320"
      className="planet-dial"
      role="img"
      aria-label={`${era?.name ?? ''} era planet, habitability ${hab}`}
    >
      <Starfield />

      {/* gauge arcs */}
      {SYSTEM_IDS.map((id) => {
        const s = run.systems[id]
        const c = CENTER_ANGLE[id]
        const a0 = c - SPAN / 2
        const a1 = c + SPAN / 2
        const meta = SYSTEM_META[id]
        const theta = valueAngle(id, s.value)
        const [mx, my] = polar(R, theta)
        return (
          <g key={id}>
            <path
              d={arcPath(R, a0, a1)}
              stroke="#232c44"
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
            />
            <path
              d={arcPath(
                R,
                valueAngle(id, s.band[0]),
                valueAngle(id, s.band[1]),
              )}
              stroke={meta.color}
              strokeOpacity={0.32}
              strokeWidth={11}
              fill="none"
              strokeLinecap="butt"
            />
            <DriftArrow system={id} run={run} />
            <Marker shape={meta.shape} x={mx} y={my} color={meta.color} />
          </g>
        )
      })}

      {/* the world itself */}
      <PlanetVisuals run={run} />

      <text x={CX} y={CY - 8} textAnchor="middle" className="dial-era">
        {era?.name ?? '—'}
      </text>
      <text x={CX} y={CY + 24} textAnchor="middle" className="dial-hab">
        {hab}
      </text>
      <text x={CX} y={CY + 42} textAnchor="middle" className="dial-hab-label">
        habitability
      </text>
    </svg>
  )
}
