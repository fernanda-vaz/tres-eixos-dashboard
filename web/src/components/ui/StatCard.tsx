import type { Tone } from '../../lib/labels.ts'
import { Icon, type IconName } from './Icon.tsx'

type StatCardProps = {
  label: string
  value: string
  hint?: string
  icon: IconName
  tone?: Tone
  href?: string
}

/** Indicador (KPI) com ícone colorido. Com href, o card inteiro vira link para a seção. */
export function StatCard({ label, value, hint, icon, tone = 'accent', href }: StatCardProps) {
  const content = (
    <>
      <span className={`stat-icon tone-${tone}`}><Icon name={icon} size={20} /></span>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </>
  )
  return href ? (
    <a className="stat-card glass" href={href}>{content}</a>
  ) : (
    <div className="stat-card glass">{content}</div>
  )
}
