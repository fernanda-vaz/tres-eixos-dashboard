import { ValidationError } from "../http/errors.js"
import { allowOnly, parseGrams, parseInteger, parseObject, parsePagination, parseText, parseUuid } from "../http/validation.js"
import type { PageRequest } from "../pagination.js"
import type { CostSheet, PricingSettings } from "./pricing-rules.js"

const MAX_CENTS = 2_147_483_647
const MAX_MINUTES = 100_000

/** Percentual com até 2 casas (ex.: 16.5) → pontos-base (1650). A API fala em %, o banco em bp. */
export function parsePercentToBp(value: unknown, label: string, maxPercent: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maxPercent) {
    throw new ValidationError(`${label} deve ser um percentual entre 0 e ${maxPercent}`)
  }
  const bp = Math.round(value * 100)
  if (Math.abs(bp - value * 100) > 1e-6) throw new ValidationError(`${label} aceita no máximo 2 casas decimais`)
  return bp
}

const cents = (value: unknown, label: string) => parseInteger(value, label, 0, MAX_CENTS)
const minutes = (value: unknown, label: string) => parseInteger(value, label, 0, MAX_MINUTES)

/** PUT /pricing/settings: todos os campos são obrigatórios (a configuração é substituída inteira). */
export function parseSettings(body: unknown): PricingSettings {
  const data = parseObject(body)
  allowOnly(data, [
    "energyCentsPerKwh",
    "printerPowerWatts",
    "printerPriceCents",
    "printerLifetimeHours",
    "laborCentsPerHour",
    "failureRatePercent",
    "taxRatePercent",
  ])
  return {
    energyCentsPerKwh: cents(data.energyCentsPerKwh, "energyCentsPerKwh"),
    printerPowerWatts: parseInteger(data.printerPowerWatts, "printerPowerWatts", 0, 20_000),
    printerPriceCents: cents(data.printerPriceCents, "printerPriceCents"),
    printerLifetimeHours: parseInteger(data.printerLifetimeHours, "printerLifetimeHours", 1, 1_000_000),
    laborCentsPerHour: cents(data.laborCentsPerHour, "laborCentsPerHour"),
    failureRateBp: parsePercentToBp(data.failureRatePercent, "failureRatePercent", 50),
    taxRateBp: parsePercentToBp(data.taxRatePercent, "taxRatePercent", 50),
  }
}

export type ChannelInput = { name: string; feeBp: number; fixedFeeCents: number; active: boolean }

export function parseNewChannel(body: unknown): ChannelInput {
  const data = parseObject(body)
  allowOnly(data, ["name", "feePercent", "fixedFeeCents", "active"])
  return {
    name: parseText(data.name, "name", 60),
    feeBp: parsePercentToBp(data.feePercent ?? 0, "feePercent", 90),
    fixedFeeCents: cents(data.fixedFeeCents ?? 0, "fixedFeeCents"),
    active: parseActive(data.active ?? true),
  }
}

export function parseChannelPatch(body: unknown): Partial<ChannelInput> {
  const data = parseObject(body)
  allowOnly(data, ["name", "feePercent", "fixedFeeCents", "active"])
  const patch: Partial<ChannelInput> = {}
  if (data.name !== undefined) patch.name = parseText(data.name, "name", 60)
  if (data.feePercent !== undefined) patch.feeBp = parsePercentToBp(data.feePercent, "feePercent", 90)
  if (data.fixedFeeCents !== undefined) patch.fixedFeeCents = cents(data.fixedFeeCents, "fixedFeeCents")
  if (data.active !== undefined) patch.active = parseActive(data.active)
  if (!Object.keys(patch).length) throw new ValidationError("Informe name, feePercent, fixedFeeCents ou active")
  return patch
}

function parseActive(value: unknown): boolean {
  if (typeof value !== "boolean") throw new ValidationError("active deve ser true ou false")
  return value
}

export function parseChannelId(value: unknown): string {
  return parseUuid(value, "ID de canal")
}

/** Ficha de custo do produto (tudo que não vem da receita de filamento). */
export function parseCostSheet(body: unknown): CostSheet {
  const data = parseObject(body)
  allowOnly(data, ["printMinutes", "purgeGrams", "laborMinutes", "packagingCents", "extraCents", "targetMarginPercent"])
  return {
    printMinutes: minutes(data.printMinutes, "printMinutes"),
    purgeGrams: parseOptionalGrams(data.purgeGrams, "purgeGrams"),
    laborMinutes: minutes(data.laborMinutes, "laborMinutes"),
    packagingCents: cents(data.packagingCents, "packagingCents"),
    extraCents: cents(data.extraCents, "extraCents"),
    targetMarginBp: parsePercentToBp(data.targetMarginPercent, "targetMarginPercent", 90),
  }
}

/** Gramas opcionais que podem ser zero (ex.: peça de uma cor só não tem purga). */
function parseOptionalGrams(value: unknown, label: string): string {
  if (value === undefined || value === 0 || value === "0") return "0"
  return parseGrams(value, label)
}

export function parseCostListQuery(query: unknown): PageRequest {
  return parsePagination(query)
}
