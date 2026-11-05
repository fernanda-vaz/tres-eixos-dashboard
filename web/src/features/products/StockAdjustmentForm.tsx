import { Button } from '../../components/ui/Button.tsx'
import { TextField } from '../../components/ui/Field.tsx'
import { Form, FormActions } from '../../components/ui/Form.tsx'
import { useStockAdjustment } from './useStockAdjustment.ts'

export function StockAdjustmentForm({ onAdjusted }: { onAdjusted: () => void }) {
  const form = useStockAdjustment(onAdjusted)
  return (
    <Form onSubmit={form.submit} feedback={form.action.feedback} label="Ajustar estoque">
      <TextField label="SKU" required value={form.sku} onValueChange={form.setSku} />
      <TextField label="Quantidade" required type="number" step={1} value={form.delta} onValueChange={form.setDelta}
        hint="Positivo para entrada, negativo para saída." />
      <TextField label="Motivo" required maxLength={255} className="span-2" placeholder="Ex.: saldo inicial, peça quebrada"
        value={form.reason} onValueChange={form.setReason} />
      <FormActions>
        <Button type="submit" variant="primary" loading={form.action.busy} loadingText="Ajustando…">
          Registrar ajuste
        </Button>
      </FormActions>
    </Form>
  )
}
