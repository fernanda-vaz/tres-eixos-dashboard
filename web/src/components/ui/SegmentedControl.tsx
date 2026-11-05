import type { Option } from './Field.tsx'

type SegmentedControlProps = {
  label: string
  options: Option[]
  value: string
  onChange: (value: string) => void
}

/** Filtro em "pílulas" (um valor por vez). Cada opção é um botão com aria-pressed. */
export function SegmentedControl({ label, options, value, onChange }: SegmentedControlProps) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segment"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
