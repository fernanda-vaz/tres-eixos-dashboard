import { Button } from '../../components/ui/Button.tsx'
import { TextField } from '../../components/ui/Field.tsx'
import { Form, FormActions } from '../../components/ui/Form.tsx'
import { ResourceView } from '../../components/ui/ResourceView.tsx'
import type { SettingsForm } from './pricing-view.ts'
import { usePricingSettings } from './usePricingConfig.ts'

const FIELDS: { name: keyof SettingsForm; label: string; hint: string; inputMode: 'decimal' | 'numeric' }[] = [
  { name: 'energyPerKwh', label: 'Energia (R$ por kWh)', hint: 'Valor da sua conta de luz, com impostos.', inputMode: 'decimal' },
  { name: 'printerPowerWatts', label: 'Potência média da impressora (W)', hint: 'Consumo médio imprimindo.', inputMode: 'numeric' },
  { name: 'printerPrice', label: 'Valor da impressora (R$)', hint: 'Para ratear o desgaste da máquina.', inputMode: 'decimal' },
  { name: 'printerLifetimeHours', label: 'Vida útil estimada (horas)', hint: 'Horas de impressão até precisar trocar.', inputMode: 'numeric' },
  { name: 'laborPerHour', label: 'Sua hora de trabalho (R$)', hint: 'Quanto vale uma hora do seu trabalho.', inputMode: 'decimal' },
  { name: 'failureRate', label: 'Margem de falhas (%)', hint: 'Impressões perdidas a cada 100.', inputMode: 'decimal' },
  { name: 'taxRate', label: 'Imposto sobre a venda (%)', hint: 'Ex.: alíquota do seu regime (MEI, Simples).', inputMode: 'decimal' },
]

export function PricingSettingsForm({ onSaved }: { onSaved: () => void }) {
  const config = usePricingSettings(onSaved)
  return (
    <ResourceView resource={config.settings} skeletonRows={4}>
      {() =>
        config.form && (
          <Form onSubmit={config.save} feedback={config.action.feedback} label="Configuração de custos">
            {FIELDS.map((field) => (
              <TextField key={field.name} label={field.label} hint={field.hint} inputMode={field.inputMode} required
                value={config.form![field.name]} onValueChange={(value) => config.updateField(field.name, value)} />
            ))}
            <FormActions>
              <Button type="submit" variant="primary" loading={config.action.busy} loadingText="Salvando…">Salvar configuração</Button>
            </FormActions>
          </Form>
        )
      }
    </ResourceView>
  )
}
