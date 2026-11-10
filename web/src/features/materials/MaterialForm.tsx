import { Button } from '../../components/ui/Button.tsx'
import { TextField } from '../../components/ui/Field.tsx'
import { Form, FormActions } from '../../components/ui/Form.tsx'
import { useMaterialForm } from './useMaterials.ts'

export function MaterialForm({ onCreated }: { onCreated: () => void }) {
  const form = useMaterialForm(onCreated)
  return (
    <Form onSubmit={form.submit} feedback={form.action.feedback} label="Novo material">
      <TextField label="Tipo" required maxLength={80} value={form.name} onValueChange={form.setName} />
      <TextField label="Cor" required maxLength={60} value={form.color} onValueChange={form.setColor} />
      <FormActions>
        <Button type="submit" variant="primary" icon="plus" loading={form.action.busy} loadingText="Salvando…">Cadastrar</Button>
      </FormActions>
    </Form>
  )
}
