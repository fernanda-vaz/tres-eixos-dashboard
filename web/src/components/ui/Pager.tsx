import { Button } from './Button.tsx'

type PagerProps = { page: number; pageSize: number; total: number; onChange: (page: number) => void }

export function Pager({ page, pageSize, total, onChange }: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages === 1) return null
  return (
    <nav className="pager" aria-label="Paginação">
      <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</Button>
      <span className="pager-info">Página {page} de {pages}</span>
      <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>Próxima</Button>
    </nav>
  )
}
