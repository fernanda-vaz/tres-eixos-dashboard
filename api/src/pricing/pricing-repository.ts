import { randomUUID } from "node:crypto"
import type { Queryable } from "../db.js"
import type { ChannelInput } from "./pricing-input.js"
import type { CostSheet, MaterialUsage, PricingSettings, SalesChannel } from "./pricing-rules.js"

type SettingsRow = {
  energy_cents_per_kwh: number
  printer_power_watts: number
  printer_price_cents: number
  printer_lifetime_hours: number
  labor_cents_per_hour: number
  failure_rate_bp: number
  tax_rate_bp: number
}

const SETTINGS_COLUMNS = `energy_cents_per_kwh, printer_power_watts, printer_price_cents, printer_lifetime_hours,
                          labor_cents_per_hour, failure_rate_bp, tax_rate_bp`

const toSettings = (row: SettingsRow): PricingSettings => ({
  energyCentsPerKwh: row.energy_cents_per_kwh,
  printerPowerWatts: row.printer_power_watts,
  printerPriceCents: row.printer_price_cents,
  printerLifetimeHours: row.printer_lifetime_hours,
  laborCentsPerHour: row.labor_cents_per_hour,
  failureRateBp: row.failure_rate_bp,
  taxRateBp: row.tax_rate_bp,
})

export async function findSettings(db: Queryable): Promise<PricingSettings> {
  const result = await db.query<SettingsRow>(`SELECT ${SETTINGS_COLUMNS} FROM pricing_settings WHERE id`)
  return toSettings(result.rows[0])
}

export async function saveSettings(db: Queryable, settings: PricingSettings): Promise<PricingSettings> {
  const result = await db.query<SettingsRow>(
    `UPDATE pricing_settings SET energy_cents_per_kwh = $1, printer_power_watts = $2, printer_price_cents = $3,
       printer_lifetime_hours = $4, labor_cents_per_hour = $5, failure_rate_bp = $6, tax_rate_bp = $7, updated_at = now()
     WHERE id RETURNING ${SETTINGS_COLUMNS}`,
    [
      settings.energyCentsPerKwh,
      settings.printerPowerWatts,
      settings.printerPriceCents,
      settings.printerLifetimeHours,
      settings.laborCentsPerHour,
      settings.failureRateBp,
      settings.taxRateBp,
    ],
  )
  return toSettings(result.rows[0])
}

type ChannelRow = { id: string; name: string; fee_bp: number; fixed_fee_cents: number; active: boolean }

const toChannel = (row: ChannelRow): SalesChannel => ({
  id: row.id,
  name: row.name,
  feeBp: row.fee_bp,
  fixedFeeCents: row.fixed_fee_cents,
  active: row.active,
})

export async function listChannels(db: Queryable, onlyActive: boolean): Promise<SalesChannel[]> {
  const result = await db.query<ChannelRow>(
    `SELECT id, name, fee_bp, fixed_fee_cents, active FROM pricing_channels
     WHERE ($1::boolean = false OR active) ORDER BY created_at, id`,
    [onlyActive],
  )
  return result.rows.map(toChannel)
}

export async function insertChannel(db: Queryable, channel: ChannelInput): Promise<SalesChannel> {
  const result = await db.query<ChannelRow>(
    `INSERT INTO pricing_channels (id, name, fee_bp, fixed_fee_cents, active) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, fee_bp, fixed_fee_cents, active`,
    [randomUUID(), channel.name, channel.feeBp, channel.fixedFeeCents, channel.active],
  )
  return toChannel(result.rows[0])
}

export async function updateChannel(db: Queryable, id: string, patch: Partial<ChannelInput>): Promise<SalesChannel | null> {
  const result = await db.query<ChannelRow>(
    `UPDATE pricing_channels SET
       name = COALESCE($2, name), fee_bp = COALESCE($3, fee_bp),
       fixed_fee_cents = COALESCE($4, fixed_fee_cents), active = COALESCE($5, active)
     WHERE id = $1
     RETURNING id, name, fee_bp, fixed_fee_cents, active`,
    [id, patch.name ?? null, patch.feeBp ?? null, patch.fixedFeeCents ?? null, patch.active ?? null],
  )
  return result.rows[0] ? toChannel(result.rows[0]) : null
}

type SheetRow = {
  product_id: string
  print_minutes: number
  purge_grams: string
  labor_minutes: number
  packaging_cents: number
  extra_cents: number
  target_margin_bp: number
}

const toSheet = (row: SheetRow): CostSheet => ({
  printMinutes: row.print_minutes,
  purgeGrams: row.purge_grams,
  laborMinutes: row.labor_minutes,
  packagingCents: row.packaging_cents,
  extraCents: row.extra_cents,
  targetMarginBp: row.target_margin_bp,
})

/** Ficha salva do produto, ou null se ainda não foi preenchida. */
export async function findCostSheet(db: Queryable, productId: string): Promise<CostSheet | null> {
  const result = await db.query<SheetRow>(
    `SELECT product_id, print_minutes, purge_grams::text AS purge_grams, labor_minutes, packaging_cents,
            extra_cents, target_margin_bp
     FROM product_cost_sheets WHERE product_id = $1`,
    [productId],
  )
  return result.rows[0] ? toSheet(result.rows[0]) : null
}

export async function upsertCostSheet(db: Queryable, productId: string, sheet: CostSheet): Promise<void> {
  await db.query(
    `INSERT INTO product_cost_sheets
       (product_id, print_minutes, purge_grams, labor_minutes, packaging_cents, extra_cents, target_margin_bp)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (product_id) DO UPDATE SET
       print_minutes = EXCLUDED.print_minutes, purge_grams = EXCLUDED.purge_grams,
       labor_minutes = EXCLUDED.labor_minutes, packaging_cents = EXCLUDED.packaging_cents,
       extra_cents = EXCLUDED.extra_cents, target_margin_bp = EXCLUDED.target_margin_bp, updated_at = now()`,
    [productId, sheet.printMinutes, sheet.purgeGrams, sheet.laborMinutes, sheet.packagingCents, sheet.extraCents, sheet.targetMarginBp],
  )
}

/** Linhas da receita de filamento com o preço por kg de cada material. */
export async function listMaterialUsage(db: Queryable, productId: string): Promise<MaterialUsage[]> {
  const result = await db.query<{ material_id: string; name: string; color: string; grams: string; cost_per_kg_cents: number }>(
    `SELECT m.id AS material_id, m.name, m.color, pm.grams_per_unit::text AS grams, m.cost_per_kg_cents
     FROM product_materials pm JOIN materials m ON m.id = pm.material_id
     WHERE pm.product_id = $1 ORDER BY m.name, m.color`,
    [productId],
  )
  return result.rows.map((row) => ({
    materialId: row.material_id,
    name: row.name,
    color: row.color,
    grams: row.grams,
    costPerKgCents: row.cost_per_kg_cents,
  }))
}

/** Fichas salvas de vários produtos em uma consulta (para listagens). */
export async function findCostSheets(db: Queryable, productIds: string[]): Promise<Map<string, CostSheet>> {
  if (!productIds.length) return new Map()
  const result = await db.query<SheetRow>(
    `SELECT product_id, print_minutes, purge_grams::text AS purge_grams, labor_minutes, packaging_cents,
            extra_cents, target_margin_bp
     FROM product_cost_sheets WHERE product_id = ANY($1::uuid[])`,
    [productIds],
  )
  return new Map(result.rows.map((row) => [row.product_id, toSheet(row)]))
}

/** Receitas de vários produtos em uma consulta, agrupadas por produto. */
export async function listMaterialUsageByProduct(db: Queryable, productIds: string[]): Promise<Map<string, MaterialUsage[]>> {
  const byProduct = new Map<string, MaterialUsage[]>()
  if (!productIds.length) return byProduct
  const result = await db.query<{ product_id: string; material_id: string; name: string; color: string; grams: string; cost_per_kg_cents: number }>(
    `SELECT pm.product_id, m.id AS material_id, m.name, m.color, pm.grams_per_unit::text AS grams, m.cost_per_kg_cents
     FROM product_materials pm JOIN materials m ON m.id = pm.material_id
     WHERE pm.product_id = ANY($1::uuid[]) ORDER BY m.name, m.color`,
    [productIds],
  )
  for (const row of result.rows) {
    const usage = { materialId: row.material_id, name: row.name, color: row.color, grams: row.grams, costPerKgCents: row.cost_per_kg_cents }
    byProduct.set(row.product_id, [...(byProduct.get(row.product_id) ?? []), usage])
  }
  return byProduct
}
