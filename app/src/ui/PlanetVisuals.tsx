// PlanetVisuals.tsx — the living planet inside the dial (issue #10).
// Era-driven surface + overlay layers come from eras.json (`visuals`), so
// the ladder stays content-not-code; this file only knows how to paint each
// layer kind. Ambient motion (drifting clouds, aurora, life motes, the
// day/night terminator, breathing glow) and state-reactive touches
// (habitability glow, instability strain) are pure ui/ decoration: nothing
// here advances the sim or touches the run's seeded rng, and all motion is
// CSS transform/opacity on the UI animation clock (index.css honors
// prefers-reduced-motion and pauses when the tab hides).
//
// The land/sea geometry is FIXED across eras on purpose: the same seas that
// darken in Liquid grow green shores in Flora — it reads as one world
// coming alive, not seven different planets.

import { useEffect, useRef, useState } from 'react'
import { habitability, inBand } from '../sim/systems'
import type { RunState } from '../sim/types'
import { useGame } from '../state/store'
import {
  DEFAULT_VISUALS,
  cloudCover,
  glowAlpha,
  hexToRgba,
  layerColor,
  layerOf,
  motesFor,
  starfield,
  strain,
} from './visuals'

const CX = 160
const CY = 160
const R = 76 // planet radius; the glow halo reaches 92 (inside the R=138 gauges)

type Blob = { cx: number; cy: number; rx: number; ry: number; rot: number }

const FROST_CAPS: Blob[] = [
  { cx: 160, cy: 90, rx: 46, ry: 17, rot: 0 },
  { cx: 160, cy: 231, rx: 50, ry: 19, rot: 0 },
]
const SEAS: Blob[] = [
  { cx: 138, cy: 150, rx: 34, ry: 22, rot: -14 },
  { cx: 196, cy: 186, rx: 26, ry: 16, rot: 10 },
  { cx: 176, cy: 118, rx: 18, ry: 11, rot: -30 },
]
const MICROBIAL: Blob[] = [
  { cx: 150, cy: 176, rx: 28, ry: 13, rot: -6 },
  { cx: 196, cy: 134, rx: 17, ry: 9, rot: 30 },
]
const FLORA: Blob[] = [
  { cx: 192, cy: 142, rx: 24, ry: 15, rot: 18 },
  { cx: 132, cy: 196, rx: 22, ry: 13, rot: -8 },
  { cx: 118, cy: 118, rx: 14, ry: 9, rot: 24 },
]

const STARS = starfield(22, 320, 96)

function Blobs({
  blobs,
  color,
  opacity,
}: {
  blobs: Blob[]
  color: string
  opacity: number
}) {
  return (
    <g fill={color} opacity={opacity} filter="url(#soft-blur)">
      {blobs.map((b, i) => (
        <ellipse
          key={i}
          cx={b.cx}
          cy={b.cy}
          rx={b.rx}
          ry={b.ry}
          transform={`rotate(${b.rot} ${b.cx} ${b.cy})`}
        />
      ))}
    </g>
  )
}

/** Static stars with a slow twinkle, behind the dial — never over gauges. */
export function Starfield() {
  return (
    <g className="dial-stars">
      {STARS.map((s, i) => (
        <circle
          key={i}
          className="dial-star"
          cx={s.x}
          cy={s.y}
          r={s.r}
          style={{
            animationDuration: `${s.durSec}s`,
            animationDelay: `${s.delaySec}s`,
          }}
        />
      ))}
    </g>
  )
}

export function PlanetVisuals({ run }: { run: RunState }) {
  const content = useGame((s) => s.content)
  const visuals = content.eras[run.era]?.visuals ?? DEFAULT_VISUALS
  const hab = habitability(run.systems)
  const mood = strain(
    run.instability,
    content.balance.instability.cascadeThreshold,
  )

  // Era transition moment: a one-shot ring pulse + gentle swell on era-up;
  // the palette itself cross-fades via the CSS stop-color transition.
  const prevEra = useRef(run.era)
  const [pulse, setPulse] = useState<number | null>(null)
  useEffect(() => {
    if (run.era > prevEra.current) setPulse(run.era)
    prevEra.current = run.era
  }, [run.era])

  const frost = layerOf(visuals, 'frost')
  const seas = layerOf(visuals, 'seas')
  const microbial = layerOf(visuals, 'microbial')
  const flora = layerOf(visuals, 'flora')
  const clouds = layerOf(visuals, 'clouds')
  const aurora = layerOf(visuals, 'aurora')
  const motesLayer = layerOf(visuals, 'motes')
  const motes = motesLayer ? motesFor(motesLayer.count ?? 4, CX, CY, 58) : []

  return (
    <g>
      <defs>
        <clipPath id="planet-clip">
          <circle cx={CX} cy={CY} r={R} />
        </clipPath>
        <filter id="soft-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <radialGradient id="planet-surface" cx="38%" cy="32%" r="75%">
          <stop offset="0%" style={{ stopColor: visuals.surface[0] }} />
          <stop offset="45%" style={{ stopColor: visuals.surface[1] }} />
          <stop offset="100%" style={{ stopColor: visuals.surface[2] }} />
        </radialGradient>
        {/* peak at the planet's limb (76/92 ≈ 82%), fade outward like air */}
        <radialGradient id="planet-glow" cx="50%" cy="50%" r="50%">
          <stop
            offset="70%"
            style={{ stopColor: hexToRgba(visuals.glow, 0) }}
          />
          <stop
            offset="82%"
            style={{ stopColor: hexToRgba(visuals.glow, glowAlpha(hab)) }}
          />
          <stop
            offset="100%"
            style={{ stopColor: hexToRgba(visuals.glow, 0) }}
          />
        </radialGradient>
        {clouds && (
          <radialGradient id="cloud-puff">
            <stop
              offset="0%"
              style={{ stopColor: hexToRgba(layerColor(clouds), 0.9) }}
            />
            <stop
              offset="65%"
              style={{ stopColor: hexToRgba(layerColor(clouds), 0.4) }}
            />
            <stop
              offset="100%"
              style={{ stopColor: hexToRgba(layerColor(clouds), 0) }}
            />
          </radialGradient>
        )}
        {aurora && (
          <linearGradient id="aurora-grad">
            <stop
              offset="0%"
              style={{ stopColor: hexToRgba(layerColor(aurora), 0) }}
            />
            <stop
              offset="50%"
              style={{ stopColor: hexToRgba(layerColor(aurora), 0.9) }}
            />
            <stop
              offset="100%"
              style={{ stopColor: hexToRgba(layerColor(aurora), 0) }}
            />
          </linearGradient>
        )}
        <linearGradient id="terminator-grad">
          <stop offset="52%" stopColor="rgba(6, 9, 18, 0)" />
          <stop offset="100%" stopColor="rgba(6, 9, 18, 0.52)" />
        </linearGradient>
      </defs>

      {/* habitability glow: color per era, strength per hab, slow breathe */}
      <circle
        className="glow-breathe"
        cx={CX}
        cy={CY}
        r={92}
        fill="url(#planet-glow)"
      />

      <g className={`planet-ball${mood === 'calm' ? '' : ` ${mood}`}`}>
        <g className={`planet-body${pulse !== null ? ' era-swell' : ''}`}>
          <circle cx={CX} cy={CY} r={R} fill="url(#planet-surface)" />
          <g clipPath="url(#planet-clip)">
            {seas && (
              <Blobs
                blobs={SEAS}
                color={layerColor(seas)}
                opacity={seas.opacity}
              />
            )}
            {microbial && (
              <Blobs
                blobs={MICROBIAL}
                color={layerColor(microbial)}
                opacity={microbial.opacity}
              />
            )}
            {flora && (
              <Blobs
                blobs={FLORA}
                color={layerColor(flora)}
                opacity={flora.opacity}
              />
            )}
            {frost && (
              <Blobs
                blobs={FROST_CAPS}
                color={layerColor(frost)}
                opacity={frost.opacity}
              />
            )}

            {clouds && (
              <g
                className="cloud-cover"
                opacity={cloudCover(
                  clouds.opacity,
                  run.systems.atmosphere.value,
                )}
              >
                <g className="cloud-drift-a">
                  <ellipse
                    cx={150}
                    cy={128}
                    rx={30}
                    ry={9}
                    fill="url(#cloud-puff)"
                    transform="rotate(-16 150 128)"
                  />
                  <ellipse
                    cx={185}
                    cy={196}
                    rx={24}
                    ry={8}
                    fill="url(#cloud-puff)"
                    transform="rotate(-10 185 196)"
                  />
                </g>
                <g className="cloud-drift-b">
                  <ellipse
                    cx={124}
                    cy={170}
                    rx={22}
                    ry={7}
                    fill="url(#cloud-puff)"
                    transform="rotate(12 124 170)"
                  />
                </g>
              </g>
            )}

            {/* aurora at the poles, only once the Atmosphere holds in-band */}
            {aurora && inBand(run.systems.atmosphere) && (
              <g
                opacity={aurora.opacity}
                stroke="url(#aurora-grad)"
                strokeLinecap="round"
                fill="none"
              >
                <path
                  className="aurora-shimmer"
                  d="M 118 106 Q 160 82 202 106"
                  strokeWidth={9}
                />
                <path
                  className="aurora-shimmer aurora-south"
                  d="M 124 216 Q 160 238 196 216"
                  strokeWidth={7}
                />
              </g>
            )}

            {motesLayer && (
              <g fill={layerColor(motesLayer)} opacity={motesLayer.opacity}>
                {motes.map((m, i) => (
                  <circle
                    key={i}
                    className="life-mote"
                    cx={m.x}
                    cy={m.y}
                    r={1.4}
                    style={{
                      animationDuration: `${m.durSec}s`,
                      animationDelay: `${m.delaySec}s`,
                    }}
                  />
                ))}
              </g>
            )}

            {/* specular highlight, then the slowly sweeping day/night shadow */}
            <ellipse
              cx={CX - 22}
              cy={CY - 26}
              rx={26}
              ry={14}
              fill="rgba(220, 235, 230, 0.07)"
              transform={`rotate(-18 ${CX - 22} ${CY - 26})`}
            />
            <g className="terminator">
              <circle cx={CX} cy={CY} r={R} fill="url(#terminator-grad)" />
            </g>
          </g>
        </g>
      </g>

      {pulse !== null && (
        <circle
          key={pulse}
          className="era-pulse"
          cx={CX}
          cy={CY}
          r={82}
          fill="none"
          stroke={visuals.glow}
          strokeWidth={2.5}
          onAnimationEnd={() => setPulse(null)}
        />
      )}
    </g>
  )
}
