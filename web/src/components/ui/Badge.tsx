import type { ReactNode } from 'react'
import type { Tone } from '../../lib/labels.ts'

type BadgeProps = { tone?: Tone; children: ReactNode; dot?: boolean }

export function Badge({ tone = 'neutral', children, dot = true }: BadgeProps) {
  return (
    <span className={`badge tone-${tone}`}>
      {dot && <span className="badge-dot" aria-hidden />}
      {children}
    </span>
  )
}

/** Badge a partir de um mapa de status ({ label, tone }), por exemplo ORDER_STATUS[status]. */
export function StatusBadge({ status }: { status: { label: string; tone: Tone } }) {
  return <Badge tone={status.tone}>{status.label}</Badge>
}
