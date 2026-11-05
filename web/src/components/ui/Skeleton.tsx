/** Placeholder de carregamento; o texto acessível fica para leitores de tela. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" role="status">
      <span className="visually-hidden">Carregando…</span>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="skeleton-line" aria-hidden />
      ))}
    </div>
  )
}
