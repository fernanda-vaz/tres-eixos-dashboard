import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './Button.tsx'

type DrawerProps = { title: string; open: boolean; onClose: () => void; children: ReactNode }

/** Painel lateral modal (detalhes e formulários longos). Fecha com Esc e devolve o foco ao sair. */
export function Drawer({ title, open, onClose, children }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className="drawer glass-strong"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <h2 className="card-title">{title}</h2>
          <Button variant="ghost" size="sm" icon="close" aria-label="Fechar" onClick={onClose} />
        </header>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  )
}
