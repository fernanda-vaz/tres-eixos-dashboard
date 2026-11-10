import type { ReactNode } from 'react'

type CardProps = {
  title?: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** Área de grade: 'span-2' ocupa duas colunas no layout de cards. */
  span?: 1 | 2 | 3
}

/** Painel translúcido (glass) usado por todas as seções. */
export function Card({ title, subtitle, actions, children, className = '', span = 1 }: CardProps) {
  return (
    <section className={`card glass span-${span} ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
