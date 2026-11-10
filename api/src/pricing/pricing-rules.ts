// Regras puras de custo e preço. Só inteiros: centavos, minutos, miligramas e pontos-base
// (1% = 100 bp). Sem banco nem HTTP, para serem testadas isoladamente.
import { gramsToMilli } from "../grams.js"

const BP = 10_000n

export type PricingSettings = {
  energyCentsPerKwh: number
  printerPowerWatts: number
  printerPriceCents: number
  printerLifetimeHours: number
  laborCentsPerHour: number
  failureRateBp: number
  taxRateBp: number
}

export type CostSheet = {
  printMinutes: number
  /** Filamento descartado na troca de cor (peças multicoloridas), em gramas. */
  purgeGrams: string
  laborMinutes: number
  packagingCents: number
  extraCents: number
  targetMarginBp: number
}

export type MaterialUsage = { materialId: string; name: string; color: string; grams: string; costPerKgCents: number }

export type SalesChannel = { id: string; name: string; feeBp: number; fixedFeeCents: number; active: boolean }

export type CostBreakdown = {
  filamentCents: number
  purgeCents: number
  energyCents: number
  depreciationCents: number
  failureCents: number
  laborCents: number
  packagingCents: number
  extraCents: number
  unitCostCents: number
}

export type PriceResult = { priceCents: number; feeCents: number; taxCents: number; profitCents: number; marginBp: number }

/**
 * Divisão inteira arredondando para o mais próximo, com o meio afastando-se do zero
 * (2,5 → 3; −2,5 → −3). A divisão de BigInt trunca em direção a zero, então o sinal é tratado à parte.
 */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator < 0n) return divRound(-numerator, -denominator)
  if (numerator < 0n) return -divRound(-numerator, denominator)
  return (numerator * 2n + denominator) / (denominator * 2n)
}

function divCeil(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator
}

const big = (value: number) => BigInt(value)

/** Custo do filamento de uma linha da receita: gramas × preço por kg. */
export function materialCostCents(usage: Pick<MaterialUsage, "grams" | "costPerKgCents">): number {
  // miligramas × (centavos/kg) ÷ 1.000.000 mg/kg
  return Number(divRound(gramsToMilli(usage.grams) * big(usage.costPerKgCents), 1_000_000n))
}

/**
 * Purga da troca de cor: gramas descartados × preço médio dos filamentos da receita,
 * ponderado pelos gramas de cada cor (a purga mistura as cores da peça).
 */
export function purgeCostCents(purgeGrams: string, materials: Pick<MaterialUsage, "grams" | "costPerKgCents">[]): number {
  const purgeMg = gramsToMilli(purgeGrams)
  const totalMg = materials.reduce((sum, usage) => sum + gramsToMilli(usage.grams), 0n)
  if (purgeMg === 0n || totalMg === 0n) return 0
  const weightedCost = materials.reduce((sum, usage) => sum + gramsToMilli(usage.grams) * big(usage.costPerKgCents), 0n)
  // purga(mg) × custo médio (centavos/kg) ÷ 1.000.000 mg/kg, com custo médio = Σ(mg × preço) ÷ Σ mg
  return Number(divRound(purgeMg * weightedCost, totalMg * 1_000_000n))
}

/** Energia: watts × minutos × (centavos/kWh) ÷ 60.000 (60 min/h × 1.000 W/kW). */
export function energyCents(settings: PricingSettings, printMinutes: number): number {
  return Number(divRound(big(settings.printerPowerWatts) * big(printMinutes) * big(settings.energyCentsPerKwh), 60_000n))
}

/** Desgaste da impressora: valor da máquina rateado pela vida útil, proporcional ao tempo de impressão. */
export function depreciationCents(settings: PricingSettings, printMinutes: number): number {
  return Number(divRound(big(settings.printerPriceCents) * big(printMinutes), big(settings.printerLifetimeHours) * 60n))
}

export function laborCents(settings: PricingSettings, laborMinutes: number): number {
  return Number(divRound(big(settings.laborCentsPerHour) * big(laborMinutes), 60n))
}

/**
 * Custo por peça vendável. A margem de falhas incide sobre o que se perde quando uma impressão
 * dá errado (filamento, purga, energia e desgaste); mão de obra, embalagem e extras não.
 */
export function costBreakdown(settings: PricingSettings, sheet: CostSheet, materials: MaterialUsage[]): CostBreakdown {
  const filament = materials.reduce((sum, usage) => sum + materialCostCents(usage), 0)
  const purge = purgeCostCents(sheet.purgeGrams, materials)
  const energy = energyCents(settings, sheet.printMinutes)
  const depreciation = depreciationCents(settings, sheet.printMinutes)
  const failure = Number(divRound(big(filament + purge + energy + depreciation) * big(settings.failureRateBp), BP))
  const labor = laborCents(settings, sheet.laborMinutes)
  return {
    filamentCents: filament,
    purgeCents: purge,
    energyCents: energy,
    depreciationCents: depreciation,
    failureCents: failure,
    laborCents: labor,
    packagingCents: sheet.packagingCents,
    extraCents: sheet.extraCents,
    unitCostCents: filament + purge + energy + depreciation + failure + labor + sheet.packagingCents + sheet.extraCents,
  }
}

/** Resultado de vender a um preço: tarifa do canal (% + fixa), imposto (%) e o que sobra. */
export function evaluatePrice(priceCents: number, unitCostCents: number, channel: SalesChannel, taxRateBp: number): PriceResult {
  const price = big(priceCents)
  const fee = Number(divRound(price * big(channel.feeBp), BP)) + channel.fixedFeeCents
  const tax = Number(divRound(price * big(taxRateBp), BP))
  const profit = priceCents - unitCostCents - fee - tax
  const marginBp = priceCents > 0 ? Number(divRound(big(profit) * BP, price)) : 0
  return { priceCents, feeCents: fee, taxCents: tax, profitCents: profit, marginBp }
}

/**
 * Preço que cobre o custo, a tarifa fixa e deixa a margem desejada depois da tarifa % e do imposto:
 *   preço = (custo + tarifa fixa) ÷ (1 − tarifa% − imposto% − margem%), arredondado para cima.
 * null quando tarifa + imposto + margem chegam a 100% (não existe preço que feche a conta).
 */
export function suggestPrice(unitCostCents: number, channel: SalesChannel, taxRateBp: number, targetMarginBp: number): PriceResult | null {
  const remaining = BP - big(channel.feeBp) - big(taxRateBp) - big(targetMarginBp)
  if (remaining <= 0n) return null
  const price = Number(divCeil(big(unitCostCents + channel.fixedFeeCents) * BP, remaining))
  return evaluatePrice(price, unitCostCents, channel, taxRateBp)
}

/** Alertas para a dona da loja: dados que faltam e deixariam o custo subestimado. */
export function pricingWarnings(settings: PricingSettings, sheet: CostSheet, materials: MaterialUsage[]): string[] {
  const warnings: string[] = []
  if (!materials.length) warnings.push("O produto não tem receita de filamento: cadastre os gramas por unidade em Materiais.")
  for (const usage of materials.filter((item) => item.costPerKgCents === 0)) {
    warnings.push(`O filamento ${usage.name} ${usage.color} está sem preço por kg.`)
  }
  if (sheet.printMinutes === 0) warnings.push("Informe o tempo de impressão para calcular energia e desgaste da impressora.")
  if (sheet.printMinutes > 0 && (settings.energyCentsPerKwh === 0 || settings.printerPowerWatts === 0)) {
    warnings.push("Configure o preço do kWh e a potência da impressora para incluir a energia.")
  }
  if (sheet.printMinutes > 0 && settings.printerPriceCents === 0) {
    warnings.push("Configure o valor da impressora para incluir o desgaste da máquina.")
  }
  if (sheet.laborMinutes > 0 && settings.laborCentsPerHour === 0) {
    warnings.push("Configure o valor da sua hora de trabalho para incluir a mão de obra.")
  }
  return warnings
}
