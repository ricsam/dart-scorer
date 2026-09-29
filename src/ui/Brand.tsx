export function Brand({ label = 'OCHE' }: { label?: string }) {
  return (
    <div className="brand" aria-label="Oche darts scorer">
      <span className="brand-mark"><i /><i /><i /></span>
      <span>{label}</span>
    </div>
  )
}
