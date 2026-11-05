import { Icon } from './Icon.tsx'

/** Lista de avisos (ex.: dados que faltam para um cálculo ficar correto). */
export function AlertList({ items, label }: { items: string[]; label: string }) {
  if (!items.length) return null
  return (
    <ul className="alert-list" aria-label={label}>
      {items.map((item) => (
        <li key={item} className="alert-line"><Icon name="alert" size={16} /> {item}</li>
      ))}
    </ul>
  )
}
