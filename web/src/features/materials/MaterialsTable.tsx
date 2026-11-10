import type { Material } from '@tres-eixos/contracts'
import { Button } from '../../components/ui/Button.tsx'
import { DataTable, type Column } from '../../components/ui/DataTable.tsx'
import { TextField } from '../../components/ui/Field.tsx'
import { Form } from '../../components/ui/Form.tsx'
import { ProgressBar } from '../../components/ui/ProgressBar.tsx'
import { formatGrams } from '../../lib/format.ts'
import { useMaterialAdjustment, useMaterialCost } from './useMaterials.ts'

function AdjustCell({ material, onDone }: { material: Material; onDone: () => void }) {
  const form = useMaterialAdjustment(material.id, onDone)
  return (
    <Form layout="inline" onSubmit={form.submit} feedback={form.action.feedback} label={`Ajustar ${material.name} ${material.color}`}>
      <TextField label={`Gramas para ${material.name} ${material.color}`} hideLabel className="short" inputMode="decimal"
        placeholder="+1000" value={form.grams} onValueChange={form.setGrams} />
      <Button type="submit" size="sm" loading={form.action.busy} loadingText="…">Registrar</Button>
    </Form>
  )
}

function CostCell({ material, onDone }: { material: Material; onDone: () => void }) {
  const form = useMaterialCost(material.id, material.costPerKgCents, onDone)
  return (
    <Form layout="inline" onSubmit={form.submit} feedback={form.action.feedback} label={`Preço por kg de ${material.name} ${material.color}`}>
      <TextField label={`R$ por kg de ${material.name} ${material.color}`} hideLabel className="short" inputMode="decimal"
        placeholder="R$/kg" value={form.price} onValueChange={form.setPrice} />
      <Button type="submit" size="sm" variant="ghost" loading={form.action.busy} loadingText="…">Salvar</Button>
    </Form>
  )
}

export function MaterialsTable({ materials, onChanged }: { materials: Material[]; onChanged: () => void }) {
  const columns: Column<Material>[] = [
    { key: 'name', header: 'Material', render: (row) => <strong>{row.name} {row.color}</strong> },
    { key: 'physical', header: 'Físico', align: 'right', render: (row) => formatGrams(row.physicalGrams) },
    { key: 'reserved', header: 'Reservado', align: 'right', render: (row) => formatGrams(row.reservedGrams) },
    {
      key: 'available',
      header: 'Livre',
      render: (row) => (
        <div className="cell-meter">
          <span>{formatGrams(row.availableGrams)}</span>
          <ProgressBar value={Number(row.availableGrams)} max={Math.max(1, Number(row.physicalGrams))}
            label={`Livre de ${row.name} ${row.color}`} tone={Number(row.availableGrams) < 100 ? 'warning' : 'info'} />
        </div>
      ),
    },
    { key: 'cost', header: 'Preço por kg', render: (row) => <CostCell material={row} onDone={onChanged} /> },
    { key: 'adjust', header: 'Entrada / ajuste', render: (row) => <AdjustCell material={row} onDone={onChanged} /> },
  ]
  return <DataTable caption="Filamento em estoque" columns={columns} rows={materials} rowKey={(row) => row.id} />
}
