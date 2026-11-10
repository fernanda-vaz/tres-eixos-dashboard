import { Button } from '../../components/ui/Button.tsx'
import { TextField } from '../../components/ui/Field.tsx'
import { Form, FormActions } from '../../components/ui/Form.tsx'
import { useOrderForm } from './useOrders.ts'

export function OrderForm({ onCreated }: { onCreated: (orderId: string) => void }) {
  const form = useOrderForm(onCreated)
  return (
    <Form onSubmit={form.submit} feedback={form.action.feedback} label="Novo pedido manual">
      <TextField label="Identificador (opcional)" maxLength={120} placeholder="Ex.: BALCAO-0042"
        value={form.externalOrderId} onValueChange={form.setExternalOrderId} />
      <TextField label="Prazo de envio (opcional)" type="datetime-local" value={form.shipBy} onValueChange={form.setShipBy} />
      <fieldset className="fieldset span-2">
        <legend>Itens</legend>
        {form.items.map((item, index) => (
          <div className="item-row" key={index}>
            <TextField label={`SKU do item ${index + 1}`} required value={item.sku}
              onValueChange={(sku) => form.updateItem(index, { sku })} />
            <TextField label="Quantidade" required type="number" min={1} max={10000} step={1} value={item.quantity}
              onValueChange={(quantity) => form.updateItem(index, { quantity })} />
            {form.items.length > 1 && (
              <Button variant="ghost" size="sm" icon="close" aria-label={`Remover item ${index + 1}`}
                onClick={() => form.removeItem(index)} />
            )}
          </div>
        ))}
        <Button size="sm" icon="plus" onClick={form.addItem}>Adicionar item</Button>
      </fieldset>
      <FormActions>
        <Button type="submit" variant="primary" loading={form.action.busy} loadingText="Registrando…">Registrar pedido</Button>
      </FormActions>
    </Form>
  )
}
