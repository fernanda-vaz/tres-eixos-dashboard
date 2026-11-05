import { donutArcs } from '../../lib/charts.ts'
import type { Tone } from '../../lib/labels.ts'

export type Segment = { label: string; value: number; tone: Tone }

type DonutChartProps = { segments: Segment[]; centerLabel: string; centerValue: string; size?: number }

const STROKE = 14
const GAP = 3

/** Rosca em SVG com legenda. A legenda em texto torna o gráfico acessível sem depender de cor. */
export function DonutChart({ segments, centerLabel, centerValue, size = 168 }: DonutChartProps) {
  const center = size / 2
  const radius = (size - STROKE) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className="donut-track" cx={center} cy={center} r={radius} strokeWidth={STROKE} fill="none" />
        {donutArcs(segments, circumference).map(({ item, length, offset }) => (
          <circle
            key={item.label}
            className={`donut-segment tone-${item.tone}`}
            cx={center}
            cy={center}
            r={radius}
            strokeWidth={STROKE}
            fill="none"
            strokeDasharray={`${Math.max(0, length - GAP)} ${circumference}`}
            strokeDashoffset={-offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${center} ${center})`}
          />
        ))}
        <text x="50%" y="47%" textAnchor="middle" className="donut-value">{centerValue}</text>
        <text x="50%" y="60%" textAnchor="middle" className="donut-label">{centerLabel}</text>
      </svg>
      <ul className="legend">
        {segments.map((segment) => (
          <li key={segment.label}>
            <span className={`legend-dot tone-${segment.tone}`} aria-hidden />
            <span className="legend-label">{segment.label}</span>
            <strong>{segment.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}
