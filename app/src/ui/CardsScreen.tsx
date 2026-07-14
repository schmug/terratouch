// CardsScreen.tsx — the Reigns swipe surface (SPEC §2.5, §3). Drag the card
// left/right; the edges telegraph WHICH systems each choice moves (subtle
// directional hints, revealed as the card is dragged — magnitudes stay
// hidden). Buttons under the card mirror the choices for accessibility.

import { useRef, useState } from 'react'
import { content } from '../data'
import { canDraw, cardById } from '../sim/cards'
import type { CardChoice } from '../sim/types'
import { useGame } from '../state/store'
import { prettyDuration } from './format'
import { SHAPE_GLYPH, SYSTEM_META } from './meta'

const SWIPE_THRESHOLD = 72
const reducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function ChoiceChips({ choice }: { choice: CardChoice }) {
  const systems = Object.entries(choice.effects.systems ?? {})
  return (
    <span className="choice-chips" aria-hidden>
      {systems.map(([id, delta]) => {
        const meta = SYSTEM_META[id as keyof typeof SYSTEM_META]
        return (
          <span key={id} className="effect-chip" style={{ color: meta.color }}>
            {SHAPE_GLYPH[meta.shape]}
            {delta > 0 ? '▲' : '▼'}
          </span>
        )
      })}
      {choice.effects.instability !== undefined && (
        <span
          className={`effect-chip ${choice.effects.instability > 0 ? 'chip-danger' : 'chip-calm'}`}
        >
          ⌁{choice.effects.instability > 0 ? '▲' : '▼'}
        </span>
      )}
      {choice.effects.minerals !== undefined && (
        <span className="effect-chip chip-mineral">
          ◇{choice.effects.minerals > 0 ? '▲' : '▼'}
        </span>
      )}
      {choice.effects.energy !== undefined && choice.effects.energy > 0 && (
        <span className="effect-chip chip-energy">⚡▲</span>
      )}
    </span>
  )
}

export function CardsScreen() {
  const run = useGame((s) => s.run)
  const draw = useGame((s) => s.draw)
  const resolve = useGame((s) => s.resolve)
  const lastOutcome = useGame((s) => s.lastOutcome)

  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [leaving, setLeaving] = useState<'left' | 'right' | null>(null)
  const startX = useRef<number | null>(null)

  if (!run) return null
  const card = run.activeCardId ? cardById(content, run.activeCardId) : null
  const { balance } = content

  const commit = (side: 'left' | 'right') => {
    if (leaving) return
    if (reducedMotion) {
      resolve(side)
      setDragX(0)
      return
    }
    setLeaving(side)
    setTimeout(() => {
      resolve(side)
      setLeaving(null)
      setDragX(0)
    }, 190)
  }

  if (!card) {
    const drawable = canDraw(run, content)
    const secToNext =
      run.energy < balance.energy.drawCost
        ? ((balance.energy.drawCost - run.energy) /
            balance.energy.regenPerSec) *
          1000
        : 0
    return (
      <div className="screen cards-screen">
        {lastOutcome && (
          <div className="outcome-note" role="status">
            <p className="outcome-title">
              {lastOutcome.cardTitle} — <em>{lastOutcome.choiceLabel}</em>
            </p>
            <p className="outcome-chips">
              {Object.entries(lastOutcome.applied.systems).map(
                ([id, delta]) => {
                  const meta = SYSTEM_META[id as keyof typeof SYSTEM_META]
                  return (
                    <span key={id} style={{ color: meta.color }}>
                      {SHAPE_GLYPH[meta.shape]} {delta > 0 ? '+' : ''}
                      {delta}{' '}
                    </span>
                  )
                },
              )}
              {lastOutcome.applied.instability !== 0 && (
                <span
                  className={
                    lastOutcome.applied.instability > 0
                      ? 'text-danger'
                      : 'text-calm'
                  }
                >
                  ⌁ {lastOutcome.applied.instability > 0 ? '+' : ''}
                  {lastOutcome.applied.instability}{' '}
                </span>
              )}
              {lastOutcome.applied.minerals !== 0 && (
                <span className="text-mineral">
                  ◇ {lastOutcome.applied.minerals > 0 ? '+' : ''}
                  {Math.round(lastOutcome.applied.minerals)}
                </span>
              )}
            </p>
          </div>
        )}
        {drawable ? (
          <>
            <p className="cards-empty-line">
              The world has something to show you.
            </p>
            <button type="button" className="btn-primary" onClick={draw}>
              Draw a card — 1 ⚡
            </button>
          </>
        ) : (
          <>
            <p className="cards-empty-line">The world rests. Let it.</p>
            <p className="cards-empty-sub">
              energy returns in about {prettyDuration(secToNext)} — machines
              keep working while you wait
            </p>
          </>
        )}
      </div>
    )
  }

  const shownDrag = leaving ? (leaving === 'left' ? -440 : 440) : dragX
  const rotation = shownDrag * 0.055
  const leftHint = Math.min(1, Math.max(0, (-shownDrag - 16) / 64))
  const rightHint = Math.min(1, Math.max(0, (shownDrag - 16) / 64))

  return (
    <div className="screen cards-screen">
      <div className="card-arena">
        <div
          className={`event-card${dragging ? ' dragging' : ''}${leaving ? ' leaving' : ''}`}
          style={{
            transform: `translateX(${shownDrag}px) rotate(${rotation}deg)`,
          }}
          onPointerDown={(e) => {
            if (leaving) return
            e.currentTarget.setPointerCapture(e.pointerId)
            startX.current = e.clientX
            setDragging(true)
          }}
          onPointerMove={(e) => {
            if (startX.current === null || leaving) return
            setDragX(e.clientX - startX.current)
          }}
          onPointerUp={() => {
            if (startX.current === null) return
            startX.current = null
            setDragging(false)
            if (dragX <= -SWIPE_THRESHOLD) commit('left')
            else if (dragX >= SWIPE_THRESHOLD) commit('right')
            else setDragX(0)
          }}
          onPointerCancel={() => {
            startX.current = null
            setDragging(false)
            setDragX(0)
          }}
        >
          {/* drag-revealed telegraph, Reigns-style: which way you're leaning */}
          <div
            className="card-reveal reveal-left"
            style={{ opacity: leftHint }}
            aria-hidden
          >
            <span className="edge-label">{card.left.label}</span>
            <ChoiceChips choice={card.left} />
          </div>
          <div
            className="card-reveal reveal-right"
            style={{ opacity: rightHint }}
            aria-hidden
          >
            <span className="edge-label">{card.right.label}</span>
            <ChoiceChips choice={card.right} />
          </div>

          <h2 className="card-title">{card.title}</h2>
          <p className="card-text">{card.text}</p>
          <div className="card-foot" aria-hidden>
            <span>◀ {card.left.label}</span>
            <span>{card.right.label} ▶</span>
          </div>
        </div>
      </div>

      <div className="choice-buttons">
        <button
          type="button"
          className="btn-choice"
          onClick={() => commit('left')}
        >
          <span className="btn-choice-label">◀ {card.left.label}</span>
          <ChoiceChips choice={card.left} />
        </button>
        <button
          type="button"
          className="btn-choice"
          onClick={() => commit('right')}
        >
          <span className="btn-choice-label">{card.right.label} ▶</span>
          <ChoiceChips choice={card.right} />
        </button>
      </div>
    </div>
  )
}
