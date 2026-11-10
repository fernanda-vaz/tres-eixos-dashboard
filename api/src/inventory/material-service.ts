import { pool, withTransaction } from "../db.js"
import { ConflictError, NotFoundError } from "../http/errors.js"
import { toPage, type Page, type PageRequest } from "../pagination.js"
import { pgConstraint, pgErrorCode } from "../pg-errors.js"
import {
  applyMaterialDelta,
  deleteRecipeLine,
  insertAdjustmentMovement,
  insertMaterial,
  listMaterials,
  listRecipe,
  lockMaterialForAdjustment,
  updateMaterialCost,
  upsertRecipeLine,
  type Material,
  type NewMaterial,
  type RecipeLine,
} from "./material-repository.js"

export async function createMaterial(material: NewMaterial): Promise<Material> {
  try {
    return await insertMaterial(pool, material)
  } catch (error) {
    if (pgErrorCode(error) === "23505" && pgConstraint(error) === "materials_name_color_unique") {
      throw new ConflictError("Material com esse nome e cor já cadastrado")
    }
    throw error
  }
}

export async function updateMaterial(materialId: string, patch: { costPerKgCents: number }): Promise<Material> {
  const material = await updateMaterialCost(pool, materialId, patch.costPerKgCents)
  if (!material) throw new NotFoundError("Material não encontrado")
  return material
}

export async function getMaterials(color: string | null, page: PageRequest): Promise<Page<Material>> {
  return toPage(page, await listMaterials(pool, color, page))
}

/** Entrada (compra de rolo) ou ajuste de filamento, em gramas, sempre com motivo. */
export function adjustMaterial(materialId: string, adjustment: { gramsDelta: string; reason: string }): Promise<Material> {
  return withTransaction(async (tx) => {
    const locked = await lockMaterialForAdjustment(tx, materialId, adjustment.gramsDelta)
    if (!locked) throw new NotFoundError("Material não encontrado")
    if (!locked.enough) {
      throw new ConflictError("Ajuste deixaria menos filamento do que o reservado para impressões em andamento")
    }
    await insertAdjustmentMovement(tx, { materialId, ...adjustment })
    return applyMaterialDelta(tx, materialId, adjustment.gramsDelta)
  })
}

export function getRecipe(productId: string): Promise<RecipeLine[]> {
  return listRecipe(pool, productId)
}

/** Define quantos gramas de um material uma unidade do produto consome (estimativa da receita). */
export async function setRecipeLine(productId: string, materialId: string, gramsPerUnit: string): Promise<RecipeLine[]> {
  try {
    await upsertRecipeLine(pool, productId, materialId, gramsPerUnit)
  } catch (error) {
    if (pgErrorCode(error) === "23503") throw new NotFoundError("Produto ou material não encontrado")
    throw error
  }
  return getRecipe(productId)
}

export async function removeRecipeLine(productId: string, materialId: string): Promise<RecipeLine[]> {
  await deleteRecipeLine(pool, productId, materialId)
  return getRecipe(productId)
}
