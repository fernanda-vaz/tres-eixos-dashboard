import { Button } from '../../components/ui/Button.tsx'
import { TextField } from '../../components/ui/Field.tsx'
import { Form, FormActions } from '../../components/ui/Form.tsx'
import { useProductForm } from './useProductForm.ts'

export function ProductForm({ onCreated }: { onCreated: () => void }) {
  const form = useProductForm(onCreated)
  return (
    <Form onSubmit={form.submit} feedback={form.action.feedback} label="Novo produto">
      <TextField label="SKU" required maxLength={64} pattern="[A-Za-z0-9_\-]+" value={form.sku}
        onValueChange={form.setSku} hint="Letras, números, hífen e sublinhado. Vira maiúsculas." />
      <TextField label="Nome" required maxLength={120} value={form.name} onValueChange={form.setName} />
      <TextField label="Preço (R$)" required inputMode="decimal" placeholder="15,90" value={form.price}
        onValueChange={form.setPrice} />
      <FormActions>
        <Button type="submit" variant="primary" icon="plus" loading={form.action.busy} loadingText="Salvando…">
          Cadastrar
        </Button>
      </FormActions>
    </Form>
  )
}
