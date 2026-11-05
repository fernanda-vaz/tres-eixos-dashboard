import { randomUUID } from "node:crypto"
import { pool, queryPage, type Queryable, type Tx } from "../db.js"
import type { PageRequest } from "../pagination.js"
import { likePattern } from "../sql.js"

export type Material = {
  id: string
  name: string
  color: string
  physicalGrams: string
  reservedGrams: string
  availableGrams: string
  costPerKgCents: number
  active: boolean
}

type MaterialRow = {
  id: string
  name: string
  color: string
  physical_grams: string
  reserved_grams: string
  available_grams: string
  cost_per_kg_cents: number
  active: boolean
}

const COLUMNS = `id, name, color, physical_grams, reserved_grams,
                 (physical_grams - reserved_grams)::numeric(12,3) AS available_grams, cost_per_kg_cents, active`

export type NewMaterial = { name: string; color: string; costPerKgCents: number }

// Gramas trafegam como texto decimal ("250.500"): numeric no banco, sem arredondamento binário.
const toMaterial = (row: MaterialRow): Material => ({
  id: row.id,
  name: row.name,
  color: row.color,
  physicalGrams: row.physical_grams,
  reservedGrams: row.reserved_grams,
  availableGrams: row.available_grams,
  costPerKgCents: row.cost_per_kg_cents,
  active: row.active,
})

export async function insertMaterial(material: NewMaterial): Promise<Material> {
  const result = await pool.query<MaterialRow>(
    `INSERT INTO materials (id, name, color, cost_per_kg_cents) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
    [randomUUID(), material.name, material.color, material.costPerKgCents],
  )
  return toMaterial(result.rows[0])
}

/** Atualiza o preço pago por quilo do filamento (usado na calculadora de custos). */
export async function updateMaterialCost(id: string, costPerKgCents: number): Promise<Material | null> {
  const result = await pool.query<MaterialRow>(
    `UPDATE materials SET cost_per_kg_cents = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, costPerKgCents],
  )
  return result.rows[0] ? toMaterial(result.rows[0]) : null
}

export async function listMaterials(color: string | null, page: PageRequest): Promise<{ items: Material[]; total: number }> {
  const { rows, total } = await queryPage<MaterialRow>(
    `SELECT ${COLUMNS} FROM materials WHERE ($1::text IS NULL OR color ILIKE $1)
     ORDER BY name, color LIMIT $2 OFFSET $3`,
    "SELECT count(*) AS total FROM materials WHERE ($1::text IS NULL OR color ILIKE $1)",
    [color ? likePattern(color) : null],
    page,
  )
  return { items: rows.map(toMaterial), total }
}

/**
 * Bloqueia o material e informa se o ajuste mantém o físico acima do reservado.
 * null = material inexistente.
 */
export async function lockMaterialForAdjustment(
  tx: Tx,
  materialId: string,
  gramsDelta: string,
): Promise<{ enough: boolean } | null> {
  const result = await tx.query<{ enough: boolean }>(
    `SELECT physical_grams + $2::numeric >= reserved_grams AS enough FROM materials WHERE id = $1 FOR UPDATE`,
    [materialId, gramsDelta],
  )
  return result.rows[0] ?? null
}

export async function insertAdjustmentMovement(
  tx: Tx,
  movement: { materialId: string; gramsDelta: string; reason: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO material_movements (id, material_id, kind, grams_delta, reason, operation_key)
     VALUES ($1, $2, 'adjustment', $3, $4, $5)`,
    [randomUUID(), movement.materialId, movement.gramsDelta, movement.reason, `material-adjust:${randomUUID()}`],
  )
}

export async function applyMaterialDelta(tx: Tx, materialId: string, gramsDelta: string): Promise<Material> {
  const result = await tx.query<MaterialRow>(
    `UPDATE materials SET physical_grams = physical_grams + $2::numeric WHERE id = $1 RETURNING ${COLUMNS}`,
    [materialId, gramsDelta],
  )
  return toMaterial(result.rows[0])
}

export type RecipeLine = { materialId: string; name: string; color: string; gramsPerUnit: string }

export async function listRecipe(db: Queryable, productId: string): Promise<RecipeLine[]> {
  const result = await db.query<{ material_id: string; name: string; color: string; grams_per_unit: string }>(
    `SELECT pm.material_id, m.name, m.color, pm.grams_per_unit
     FROM product_materials pm JOIN materials m ON m.id = pm.material_id
     WHERE pm.product_id = $1 ORDER BY m.name, m.color`,
    [productId],
  )
  return result.rows.map((row) => ({
    materialId: row.material_id,
    name: row.name,
    color: row.color,
    gramsPerUnit: row.grams_per_unit,
  }))
}

export async function upsertRecipeLine(productId: string, materialId: string, gramsPerUnit: string): Promise<void> {
  await pool.query(
    `INSERT INTO product_materials (product_id, material_id, grams_per_unit) VALUES ($1, $2, $3)
     ON CONFLICT (product_id, material_id) DO UPDATE SET grams_per_unit = EXCLUDED.grams_per_unit`,
    [productId, materialId, gramsPerUnit],
  )
}

export async function deleteRecipeLine(productId: string, materialId: string): Promise<void> {
  await pool.query("DELETE FROM product_materials WHERE product_id = $1 AND material_id = $2", [productId, materialId])
}

export type MaterialRequirement = {
  materialId: string
  name: string
  color: string
  requiredGrams: string
  availableGrams: string
  enough: boolean
}

/** Filamento que a receita exige para `quantity` unidades, com os materiais bloqueados em ordem de id. */
export async function lockRecipeRequirements(
  tx: Tx,
  productId: string,
  quantity: number,
): Promise<MaterialRequirement[]> {
  const result = await tx.query<{
    material_id: string
    name: string
    color: string
    required: string
    available: string
    enough: boolean
  }>(
    `SELECT m.id AS material_id, m.name, m.color,
            (pm.grams_per_unit * $2)::numeric(12,3)::text AS required,
            (m.physical_grams - m.reserved_grams)::numeric(12,3)::text AS available,
            m.physical_grams - m.reserved_grams >= pm.grams_per_unit * $2 AS enough
     FROM product_materials pm JOIN materials m ON m.id = pm.material_id
     WHERE pm.product_id = $1
     ORDER BY m.id
     FOR UPDATE OF m`,
    [productId, quantity],
  )
  return result.rows.map((row) => ({
    materialId: row.material_id,
    name: row.name,
    color: row.color,
    requiredGrams: row.required,
    availableGrams: row.available,
    enough: row.enough,
  }))
}

export async function reserveMaterialGrams(tx: Tx, materialId: string, grams: string): Promise<void> {
  await tx.query("UPDATE materials SET reserved_grams = reserved_grams + $2::numeric WHERE id = $1", [materialId, grams])
}

export async function releaseMaterialGrams(tx: Tx, materialId: string, grams: string): Promise<void> {
  await tx.query("UPDATE materials SET reserved_grams = reserved_grams - $2::numeric WHERE id = $1", [materialId, grams])
}

/**
 * Baixa a reserva e o físico consumido. false = o consumo deixaria o físico abaixo do
 * reservado restante (nada é alterado).
 */
export async function consumeMaterialGrams(
  tx: Tx,
  materialId: string,
  reservedGrams: string,
  consumedGrams: string,
): Promise<boolean> {
  const result = await tx.query<{ ok: boolean }>(
    `UPDATE materials
     SET reserved_grams = reserved_grams - $2::numeric, physical_grams = physical_grams - $3::numeric
     WHERE id = $1 AND physical_grams - $3::numeric >= reserved_grams - $2::numeric
     RETURNING true AS ok`,
    [materialId, reservedGrams, consumedGrams],
  )
  return result.rows[0] !== undefined
}

export async function insertConsumptionMovement(
  tx: Tx,
  movement: { materialId: string; consumedGrams: string; estimatedGrams: string; jobId: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO material_movements
       (id, material_id, kind, grams_delta, estimated_grams, reason, production_job_id, operation_key)
     VALUES ($1, $2, 'consumption', -$3::numeric, $4, 'Consumo da produção', $5, $6)`,
    [
      randomUUID(),
      movement.materialId,
      movement.consumedGrams,
      movement.estimatedGrams,
      movement.jobId,
      `consume:${movement.jobId}:${movement.materialId}`,
    ],
  )
}
