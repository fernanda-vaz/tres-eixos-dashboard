import type { CostBreakdown, CostSheet, PricingSettings } from '../../api/types.ts'
import type { BarItem } from '../../components/ui/BarList.tsx'
import { formatCents } from '../../lib/format.ts'
import type { Tone } from '../../lib/labels.ts'
import { centsToInput, gramsToInput, parseGrams, parsePercent, parseReaisToCents, parseWholeNumber, percentToInput } from '../../lib/parse.ts'

// Conversões puras entre os formulários (texto digitado) e a API (números), mais derivações de exibição.

export type SheetForm = {
  printMinutes: string
  purgeGrams: string
  laborMinutes: string
  packaging: string
  extra: string
  targetMargin: string
}

export function sheetToForm(sheet: CostSheet): SheetForm {
  return {
    printMinutes: String(sheet.printMinutes),
    purgeGrams: gramsToInput(sheet.purgeGrams),
    laborMinutes: String(sheet.laborMinutes),
    packaging: centsToInput(sheet.packagingCents),
    extra: centsToInput(sheet.extraCents),
    targetMargin: percentToInput(sheet.targetMarginPercent),
  }
}

/** Ficha válida para a API, ou null enquanto algum campo estiver incompleto/inválido. */
export function formToSheet(form: SheetForm): CostSheet | null {
  const sheet = {
    printMinutes: parseWholeNumber(form.printMinutes, 100_000),
    purgeGrams: parseGrams(form.purgeGrams, { allowZero: true }),
    laborMinutes: parseWholeNumber(form.laborMinutes, 100_000),
    packagingCents: parseReaisToCents(form.packaging),
    extraCents: parseReaisToCents(form.extra),
    targetMarginPercent: parsePercent(form.targetMargin, 90),
  }
  return Object.values(sheet).some((value) => value === null) ? null : (sheet as CostSheet)
}

export type SettingsForm = {
  energyPerKwh: string
  printerPowerWatts: string
  printerPrice: string
  printerLifetimeHours: string
  laborPerHour: string
  failureRate: string
  taxRate: string
}

export function settingsToForm(settings: PricingSettings): SettingsForm {
  return {
    energyPerKwh: centsToInput(settings.energyCentsPerKwh),
    printerPowerWatts: String(settings.printerPowerWatts),
    printerPrice: centsToInput(settings.printerPriceCents),
    printerLifetimeHours: String(settings.printerLifetimeHours),
    laborPerHour: centsToInput(settings.laborCentsPerHour),
    failureRate: percentToInput(settings.failureRatePercent),
    taxRate: percentToInput(settings.taxRatePercent),
  }
}

export function formToSettings(form: SettingsForm): PricingSettings | null {
  const lifetime = parseWholeNumber(form.printerLifetimeHours)
  const settings = {
    energyCentsPerKwh: parseReaisToCents(form.energyPerKwh),
    printerPowerWatts: parseWholeNumber(form.printerPowerWatts, 20_000),
    printerPriceCents: parseReaisToCents(form.printerPrice),
    printerLifetimeHours: lifetime && lifetime > 0 ? lifetime : null,
    laborCentsPerHour: parseReaisToCents(form.laborPerHour),
    failureRatePercent: parsePercent(form.failureRate, 50),
    taxRatePercent: parsePercent(form.taxRate, 50),
  }
  return Object.values(settings).some((value) => value === null) ? null : (settings as PricingSettings)
}

const COMPONENTS: { key: keyof Omit<CostBreakdown, 'unitCostCents'>; label: string; tone: Tone }[] = [
  { key: 'filamentCents', label: 'Filamento', tone: 'accent' },
  { key: 'purgeCents', label: 'Purga (troca de cor)', tone: 'accent' },
  { key: 'energyCents', label: 'Energia', tone: 'warning' },
  { key: 'depreciationCents', label: 'Desgaste da impressora', tone: 'info' },
  { key: 'failureCents', label: 'Margem de falhas', tone: 'danger' },
  { key: 'laborCents', label: 'Mão de obra', tone: 'success' },
  { key: 'packagingCents', label: 'Embalagem', tone: 'neutral' },
  { key: 'extraCents', label: 'Outros custos', tone: 'neutral' },
]

/** Composição do custo por peça, do maior para o menor (zeros de fora). */
export function breakdownBars(breakdown: CostBreakdown): BarItem[] {
  const max = Math.max(1, breakdown.unitCostCents)
  return COMPONENTS.map((component) => ({ ...component, value: breakdown[component.key] }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((item) => ({
      key: item.key,
      label: item.label,
      detail: `${formatCents(item.value)} · ${Math.round((item.value / max) * 100)}%`,
      value: item.value,
      max,
      tone: item.tone,
    }))
}

/** Prejuízo em vermelho; abaixo da margem desejada em amarelo; na meta ou acima em verde. */
export function marginTone(marginPercent: number | null, targetPercent: number): Tone {
  if (marginPercent === null) return 'neutral'
  if (marginPercent < 0) return 'danger'
  return marginPercent < targetPercent ? 'warning' : 'success'
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}
