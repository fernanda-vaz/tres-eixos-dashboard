import { Button } from '../../components/ui/Button.tsx'
import { TextField } from '../../components/ui/Field.tsx'
import { Form, FormActions } from '../../components/ui/Form.tsx'
import type { CostCalculator } from './useCostCalculator.ts'

/** Ficha de custo: o que não vem da receita de filamento. Recalcula enquanto se digita. */
export function CostSheetForm({ calculator }: { calculator: CostCalculator }) {
  const { form, updateField, saveAction: action } = calculator
  if (!form) return null
  return (
    <Form onSubmit={calculator.save} feedback={action.feedback} label="Ficha de custo">
      <TextField label="Tempo de impressão (min)" inputMode="numeric" required value={form.printMinutes}
        onValueChange={(value) => updateField('printMinutes', value)} hint="Do fatiador, por peça." />
      <TextField label="Purga na troca de cor (g)" inputMode="decimal" required value={form.purgeGrams}
        onValueChange={(value) => updateField('purgeGrams', value)} hint="Peças multicoloridas: filamento descartado por peça. 0 se for uma cor só." />
      <TextField label="Mão de obra (min)" inputMode="numeric" required value={form.laborMinutes}
        onValueChange={(value) => updateField('laborMinutes', value)} hint="Preparo, acabamento e embalagem." />
      <TextField label="Embalagem (R$)" inputMode="decimal" required value={form.packaging}
        onValueChange={(value) => updateField('packaging', value)} />
      <TextField label="Outros custos (R$)" inputMode="decimal" required value={form.extra}
        onValueChange={(value) => updateField('extra', value)} hint="Ex.: argola, ímã, tinta." />
      <TextField label="Margem de lucro desejada (%)" inputMode="decimal" required value={form.targetMargin}
        onValueChange={(value) => updateField('targetMargin', value)} hint="Sobre o preço de venda, depois de taxas e imposto." />
      <FormActions>
        <Button type="submit" variant="primary" icon="check" disabled={!calculator.formValid}
          loading={action.busy} loadingText="Salvando…">
          Salvar ficha
        </Button>
      </FormActions>
    </Form>
  )
}
