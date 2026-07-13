// Placeholder shell. The real UI (Planet / Cards / Build / Synthesis / Loss —
// SPEC §3) is built only after the sim engine is pure and green (SPEC §9).

export function App() {
  return (
    <main
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        textAlign: 'center',
        padding: '1rem',
      }}
    >
      <div
        aria-hidden
        style={{
          width: 96,
          height: 96,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 35% 30%, #4fe0b8, #1f9d7a 55%, #14504a)',
          boxShadow: '0 0 48px rgba(45, 212, 167, 0.35)',
        }}
      />
      <h1 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '0.04em' }}>
        TerraTouch
      </h1>
      <p style={{ margin: 0, color: 'var(--muted)', maxWidth: '24ch' }}>
        A dead world waits. The sim engine comes first.
      </p>
    </main>
  )
}
