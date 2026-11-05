import { pool } from "../db.js"
import { findProductById, listProducts } from "../catalog/product-repository.js"
import type { Product } from "../catalog/product.js"
import { ConflictError, NotFoundError } from "../http/errors.js"
import { toPage, type Page, type PageRequest } from "../pagination.js"
import { pgConstraint, pgErrorCode } from "../pg-errors.js"
import type { ChannelInput } from "./pricing-input.js"
import {
  findCostSheet,
  findCostSheets,
  findSettings,
  insertChannel,
  listChannels,
  listMaterialUsage,
  listMaterialUsageByProduct,
  saveSettings,
  updateChannel,
  upsertCostSheet,
} from "./pricing-repository.js"
import {
  costBreakdown,
  evaluatePrice,
  materialCostCents,
  pricingWarnings,
  suggestPrice,
  type CostBreakdown,
  type CostSheet,
  type PriceResult,
  type PricingSettings,
  type SalesChannel,
} from "./pricing-rules.js"

/** Ficha usada enquanto o produto não tem uma salva: só a margem padrão de 30%. */
export const DEFAULT_COST_SHEET: CostSheet = {
  printMinutes: 0,
  purgeGrams: "0",
  laborMinutes: 0,
  packagingCents: 0,
  extraCents: 0,
  targetMarginBp: 3000,
}

// A API expõe percentuais (16.5); internamente tudo é pontos-base (1650).
const percent = (bp: number) => bp / 100

type PriceView = Omit<PriceResult, "marginBp"> & { marginPercent: number }

function toPriceView(result: PriceResult | null): PriceView | null {
  if (!result) return null
  const { marginBp, ...amounts } = result
  return { ...amounts, marginPercent: percent(marginBp) }
}

export type SettingsView = Omit<PricingSettings, "failureRateBp" | "taxRateBp"> & {
  failureRatePercent: number
  taxRatePercent: number
}

function toSettingsView({ failureRateBp, taxRateBp, ...rest }: PricingSettings): SettingsView {
  return { ...rest, failureRatePercent: percent(failureRateBp), taxRatePercent: percent(taxRateBp) }
}

export type ChannelView = { id: string; name: string; feePercent: number; fixedFeeCents: number; active: boolean }

function toChannelView({ feeBp, ...rest }: SalesChannel): ChannelView {
  return { ...rest, feePercent: percent(feeBp) }
}

export async function getSettings(): Promise<SettingsView> {
  return toSettingsView(await findSettings())
}

export async function updateSettings(settings: PricingSettings): Promise<SettingsView> {
  return toSettingsView(await saveSettings(settings))
}

export async function getChannels(): Promise<ChannelView[]> {
  return (await listChannels(false)).map(toChannelView)
}

function channelNameConflict(error: unknown): boolean {
  return pgErrorCode(error) === "23505" && pgConstraint(error) === "pricing_channels_name_unique"
}

export async function createChannel(channel: ChannelInput): Promise<ChannelView> {
  try {
    return toChannelView(await insertChannel(channel))
  } catch (error) {
    if (channelNameConflict(error)) throw new ConflictError("Já existe um canal com esse nome")
    throw error
  }
}

export async function patchChannel(id: string, patch: Partial<ChannelInput>): Promise<ChannelView> {
  try {
    const channel = await updateChannel(id, patch)
    if (!channel) throw new NotFoundError("Canal não encontrado")
    return toChannelView(channel)
  } catch (error) {
    if (channelNameConflict(error)) throw new ConflictError("Já existe um canal com esse nome")
    throw error
  }
}

export type ProductPricing = {
  product: { id: string; sku: string; name: string; priceCents: number }
  sheet: Omit<CostSheet, "targetMarginBp"> & { targetMarginPercent: number; saved: boolean }
  materials: { materialId: string; name: string; color: string; grams: string; costPerKgCents: number; costCents: number }[]
  breakdown: CostBreakdown
  channels: { channel: ChannelView; suggested: PriceView | null; atCurrentPrice: PriceView | null }[]
  warnings: string[]
}

async function requireProduct(productId: string): Promise<Product> {
  const product = await findProductById(pool, productId)
  if (!product) throw new NotFoundError("Produto não encontrado")
  return product
}

/**
 * Custo por peça e preço sugerido por canal. Com `draft`, calcula sem salvar (pré-visualização
 * enquanto a ficha é editada); sem ele, usa a ficha salva ou a padrão.
 */
export async function getProductPricing(productId: string, draft?: CostSheet): Promise<ProductPricing> {
  const product = await requireProduct(productId)
  const [settings, channels, materials, saved] = await Promise.all([
    findSettings(),
    listChannels(true),
    listMaterialUsage(productId),
    findCostSheet(productId),
  ])
  const sheet = draft ?? saved ?? DEFAULT_COST_SHEET
  const breakdown = costBreakdown(settings, sheet, materials)

  return {
    product: { id: product.id, sku: product.sku, name: product.name, priceCents: product.priceCents },
    sheet: {
      printMinutes: sheet.printMinutes,
      purgeGrams: sheet.purgeGrams,
      laborMinutes: sheet.laborMinutes,
      packagingCents: sheet.packagingCents,
      extraCents: sheet.extraCents,
      targetMarginPercent: percent(sheet.targetMarginBp),
      saved: draft === undefined && saved !== null,
    },
    materials: materials.map((usage) => ({ ...usage, costCents: materialCostCents(usage) })),
    breakdown,
    channels: channels.map((channel) => ({
      channel: toChannelView(channel),
      suggested: toPriceView(suggestPrice(breakdown.unitCostCents, channel, settings.taxRateBp, sheet.targetMarginBp)),
      atCurrentPrice:
        product.priceCents > 0
          ? toPriceView(evaluatePrice(product.priceCents, breakdown.unitCostCents, channel, settings.taxRateBp))
          : null,
    })),
    warnings: pricingWarnings(settings, sheet, materials),
  }
}

export async function saveCostSheet(productId: string, sheet: CostSheet): Promise<ProductPricing> {
  await requireProduct(productId)
  await upsertCostSheet(productId, sheet)
  return getProductPricing(productId)
}

export type ProductCost = {
  productId: string
  sku: string
  name: string
  priceCents: number
  unitCostCents: number
  hasCostSheet: boolean
  /** Margem ao preço atual em cada canal ativo (null se o produto não tem preço). */
  margins: { channelId: string; channelName: string; marginPercent: number | null }[]
}

/** Visão geral: custo por peça × preço atual de cada produto ativo. */
export async function listProductCosts(page: PageRequest): Promise<Page<ProductCost>> {
  const [settings, channels, products] = await Promise.all([
    findSettings(),
    listChannels(true),
    listProducts({ active: true }, page),
  ])
  // Duas consultas para a página inteira, em vez de duas por produto.
  const productIds = products.items.map((product) => product.id)
  const [usageByProduct, sheets] = await Promise.all([listMaterialUsageByProduct(productIds), findCostSheets(productIds)])
  const items = products.items.map((product): ProductCost => {
    const sheet = sheets.get(product.id) ?? null
    const { unitCostCents } = costBreakdown(settings, sheet ?? DEFAULT_COST_SHEET, usageByProduct.get(product.id) ?? [])
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      priceCents: product.priceCents,
      unitCostCents,
      hasCostSheet: sheet !== null,
      margins: channels.map((channel) => ({
        channelId: channel.id,
        channelName: channel.name,
        marginPercent:
          product.priceCents > 0
            ? percent(evaluatePrice(product.priceCents, unitCostCents, channel, settings.taxRateBp).marginBp)
            : null,
      })),
    }
  })
  return toPage(page, { items, total: products.total })
}
