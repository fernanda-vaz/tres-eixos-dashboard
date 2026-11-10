import type { Tone } from '../../lib/labels.ts'
import { ProgressBar } from './ProgressBar.tsx'

export type BarItem = { key: string; label: string; detail?: string; value: number; max: number; tone?: Tone }

/** Lista de barras horizontais (ex.: estoque livre por produto). */
export function BarList({ items }: { items: BarItem[] }) {
  return (
    <ul className="bar-list">
      {items.map((item) => (
        <li key={item.key}>
          <div className="bar-row">
            <span className="bar-label">{item.label}</span>
            <span className="bar-detail">{item.detail ?? item.value}</span>
          </div>
          <ProgressBar value={item.value} max={item.max} label={item.label} tone={item.tone} />
        </li>
      ))}
    </ul>
  )
}
