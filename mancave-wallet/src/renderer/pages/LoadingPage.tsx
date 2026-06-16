export function LoadingPage() {
  return (
    <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="spinner" style={{ marginBottom: 16 }} />
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Initialising…</p>
      </div>
    </div>
  )
}
