import { Button } from '../../components/ui/Button.tsx'
import { SelectField, TextField } from '../../components/ui/Field.tsx'
import { Form, FormActions } from '../../components/ui/Form.tsx'
import { Notice } from '../../components/ui/Notice.tsx'
import { ProgressBar } from '../../components/ui/ProgressBar.tsx'
import { formatCents } from '../../lib/format.ts'
import { availableFilaments, summarizeMix, type FilamentLine } from './filament-mix.ts'
import { NEW_FILAMENT, useAddFilament, useFilamentLine, useFilamentMix, type FilamentMix } from './useFilamentMix.ts'

function FilamentRow({ line, share, mix }: { line: FilamentLine; share: number; mix: FilamentMix }) {
  const row = useFilamentLine(line, mix)
  const label = `${line.name} ${line.color}`
  return (
    <li className="mix-row">
      <div className="mix-head">
        <strong>{label}</strong>
        <span className="muted">{share}% do peso · {formatCents(line.costCents)} na peça</span>
      </div>
      <ProgressBar value={share} max={100} label={`Participação de ${label}`} tone="accent" />
      <Form layout="inline" onSubmit={row.save} label={`Editar ${label}`}>
        <TextField label="Gramas por peça" className="short" inputMode="decimal" value={row.grams} onValueChange={row.setGrams} />
        <TextField label="Preço do kg (R$)" className="short" inputMode="decimal" value={row.price} onValueChange={row.setPrice} />
        <Button type="submit" size="sm" disabled={mix.action.busy}>Salvar</Button>
        <Button size="sm" variant="ghost" icon="close" aria-label={`Remover ${label} da peça`} disabled={mix.action.busy} onClick={row.remove} />
      </Form>
    </li>
  )
}

function AddFilamentForm({ lines, mix }: { lines: FilamentLine[]; mix: FilamentMix }) {
  const form = useAddFilament(mix)
  const options = [
    ...availableFilaments(mix.materials.data?.items ?? [], lines).map((material) => ({
      value: material.id,
      label: `${material.name} ${material.color}${material.costPerKgCents ? ` · ${formatCents(material.costPerKgCents)}/kg` : ' · sem preço'}`,
    })),
    { value: NEW_FILAMENT, label: '+ Novo filamento…' },
  ]
  return (
    <Form onSubmit={form.submit} label="Adicionar cor à peça">
      <SelectField label="Adicionar cor" required options={options} placeholder="Escolha o filamento…"
        value={form.materialId} onValueChange={form.setMaterialId} />
      <TextField label="Gramas por peça" required inputMode="decimal" value={form.grams} onValueChange={form.setGrams} />
      {form.creatingNew && (
        <>
          <TextField label="Tipo" required maxLength={80} value={form.newName} onValueChange={form.setNewName} hint="Ex.: PLA, PETG, PLA Silk" />
          <TextField label="Cor" required maxLength={60} value={form.newColor} onValueChange={form.setNewColor} />
          <TextField label="Preço do kg (R$)" required inputMode="decimal" value={form.newPrice} onValueChange={form.setNewPrice} />
        </>
      )}
      <FormActions>
        <Button type="submit" icon="plus" loading={mix.action.busy} loadingText="Adicionando…">Adicionar cor</Button>
      </FormActions>
    </Form>
  )
}

type FilamentMixEditorProps = { productId: string; lines: FilamentLine[]; onChanged: () => void }

/** Filamentos da peça: uma linha por cor, cada uma com seus gramas e o preço do seu filamento. */
export function FilamentMixEditor({ productId, lines, onChanged }: FilamentMixEditorProps) {
  const mix = useFilamentMix(productId, onChanged)
  const summary = summarizeMix(lines)
  const shareOf = (materialId: string) => summary.shares.find((share) => share.materialId === materialId)?.percent ?? 0

  return (
    <div className="stack">
      {lines.length > 0 && (
        <p className="mix-total">
          <span className="muted">{lines.length > 1 ? `${lines.length} cores` : '1 cor'} · {summary.totalGrams.toLocaleString('pt-BR')} g</span>
          <strong>{formatCents(summary.totalCostCents)}</strong>
        </p>
      )}
      <Notice feedback={mix.action.feedback} />
      {lines.length > 0 ? (
        <ul className="mix-list">
          {lines.map((line) => (
            // A chave inclui os valores salvos: após salvar, a linha recomeça com os dados novos.
            <FilamentRow key={`${line.materialId}|${line.grams}|${line.costPerKgCents}`} line={line}
              share={shareOf(line.materialId)} mix={mix} />
          ))}
        </ul>
      ) : (
        <p className="muted">Nenhum filamento na peça ainda. Adicione uma linha por cor.</p>
      )}
      <AddFilamentForm lines={lines} mix={mix} />
      <p className="field-hint">O preço do kg é do filamento: mudar aqui atualiza todos os produtos que usam essa cor.</p>
    </div>
  )
}
