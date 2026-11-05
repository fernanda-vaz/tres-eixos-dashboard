import { Icon, type IconName } from './Icon.tsx'

export function EmptyState({ text, icon = 'box' }: { text: string; icon?: IconName }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon name={icon} size={22} /></span>
      <p>{text}</p>
    </div>
  )
}
