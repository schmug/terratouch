// TabBar.tsx — bottom navigation (SPEC §3): four thumb-sized tabs.

export type Tab = 'planet' | 'cards' | 'build' | 'synthesis'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'planet',
    label: 'Planet',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
        <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <ellipse cx="12" cy="12" rx="10.5" ry="3.6" fill="none" stroke="currentColor" strokeWidth="1.4" transform="rotate(-18 12 12)" />
      </svg>
    ),
  },
  {
    id: 'cards',
    label: 'Cards',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
        <rect x="4" y="4.5" width="11" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" transform="rotate(-8 9.5 12)" />
        <rect x="10" y="4.5" width="11" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" transform="rotate(8 15.5 12)" />
      </svg>
    ),
  },
  {
    id: 'build',
    label: 'Build',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
        <path d="M5 19 L5 12 L9 12 L9 19 M10.5 19 L10.5 7 L14.5 7 L14.5 19 M16 19 L16 10 L20 10 L20 19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M3.5 19.5 H21.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'synthesis',
    label: 'Synthesis',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
        <path d="M10 4.5 h4 M12 4.5 V10 L17.5 18 a1.5 1.5 0 0 1 -1.3 2.3 H7.8 A1.5 1.5 0 0 1 6.5 18 L12 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
]

export function TabBar({ tab, onSelect }: { tab: Tab; onSelect: (t: Tab) => void }) {
  return (
    <nav className="tab-bar" aria-label="Main">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tab-btn${tab === t.id ? ' active' : ''}`}
          aria-current={tab === t.id ? 'page' : undefined}
          onClick={() => onSelect(t.id)}
        >
          {t.icon}
          <span className="tab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
