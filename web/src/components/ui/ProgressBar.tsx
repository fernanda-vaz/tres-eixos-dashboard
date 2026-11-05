import type { Tone } from '../../lib/labels.ts'

type ProgressBarProps = { value: number; max: number; label: string; tone?: Tone }

export function ProgressBar({ value, max, label, tone = 'accent' }: ProgressBarProps) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <span className={`progress-fill tone-${tone}`} style={{ width: `${percent}%` }} />
    </div>
  )
}
