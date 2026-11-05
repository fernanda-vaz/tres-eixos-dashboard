import { useId, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react'

type FieldShell = { label: string; hint?: string; hideLabel?: boolean; className?: string }

function FieldLabel({ id, label, hide }: { id: string; label: string; hide?: boolean }) {
  return (
    <label htmlFor={id} className={hide ? 'visually-hidden' : 'field-label'}>
      {label}
    </label>
  )
}

type TextFieldProps = FieldShell & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> & {
  onValueChange?: (value: string) => void
}

/** Campo de texto com label sempre associado (acessível) e dica opcional. */
export function TextField({ label, hint, hideLabel, className = '', onValueChange, onChange, ...input }: TextFieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  return (
    <div className={`field ${className}`}>
      <FieldLabel id={id} label={label} hide={hideLabel} />
      <input
        id={id}
        className="input"
        aria-describedby={hintId}
        onChange={(event) => {
          onChange?.(event)
          onValueChange?.(event.target.value)
        }}
        {...input}
      />
      {hint && <small id={hintId} className="field-hint">{hint}</small>}
    </div>
  )
}

export type Option = { value: string; label: string }

type SelectFieldProps = FieldShell & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> & {
  options: Option[]
  placeholder?: string
  onValueChange?: (value: string) => void
}

export function SelectField({
  label,
  hint,
  hideLabel,
  className = '',
  options,
  placeholder,
  onValueChange,
  onChange,
  ...select
}: SelectFieldProps) {
  const id = useId()
  return (
    <div className={`field ${className}`}>
      <FieldLabel id={id} label={label} hide={hideLabel} />
      <select
        id={id}
        className="input"
        onChange={(event) => {
          onChange?.(event)
          onValueChange?.(event.target.value)
        }}
        {...select}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {hint && <small className="field-hint">{hint}</small>}
    </div>
  )
}
