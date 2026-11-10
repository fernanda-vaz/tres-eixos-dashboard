import { useState } from 'react'
import { SelectField, TextField } from '../../components/ui/Field.tsx'
import { useProductSearch } from './useProductSearch.ts'

type ProductPickerProps = {
  label: string
  value: string
  onChange: (productId: string) => void
  hideLabel?: boolean
  required?: boolean
}

/**
 * Seleção de produto com busca: campo de texto (SKU ou nome) e lista com os resultados.
 * O produto já escolhido continua na lista mesmo que a busca mude.
 */
export function ProductPicker({ label, value, onChange, hideLabel, required }: ProductPickerProps) {
  const search = useProductSearch()
  const [chosen, setChosen] = useState<{ value: string; label: string } | null>(null)
  const options = search.items.map((product) => ({ value: product.id, label: `${product.sku} — ${product.name}` }))
  if (chosen && chosen.value === value && !options.some((option) => option.value === value)) options.unshift(chosen)

  return (
    <div className="picker">
      <TextField label={`Buscar ${label.toLowerCase()}`} hideLabel placeholder="Buscar por SKU ou nome" value={search.search}
        onValueChange={search.setSearch} autoComplete="off" />
      <SelectField
        label={label}
        hideLabel={hideLabel}
        required={required}
        options={options}
        placeholder={search.loading && !options.length ? 'Carregando…' : 'Selecione…'}
        value={value}
        hint={search.error ?? search.hint}
        onValueChange={(productId) => {
          setChosen(options.find((option) => option.value === productId) ?? null)
          onChange(productId)
        }}
      />
    </div>
  )
}
