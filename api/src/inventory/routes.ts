import { Router } from "express"
import { parseProductId } from "../catalog/product-input.js"
import { readIdempotencyKey } from "../http/idempotency.js"
import { parseAdjustment, parseInventoryListQuery, parseMovementListQuery } from "./inventory-input.js"
import { adjustInventory, getInventory, getMovements, getProductInventory } from "./inventory-service.js"
import {
  parseMaterialAdjustment,
  parseMaterialId,
  parseMaterialListQuery,
  parseMaterialPatch,
  parseNewMaterial,
  parseRecipeGrams,
} from "./material-input.js"
import {
  adjustMaterial,
  createMaterial,
  getMaterials,
  getRecipe,
  removeRecipeLine,
  setRecipeLine,
  updateMaterial,
} from "./material-service.js"

export const inventoryRouter = Router()

inventoryRouter.get("/inventory", async (req, res) => {
  const { filter, page } = parseInventoryListQuery(req.query)
  res.json(await getInventory(filter, page))
})

inventoryRouter.get("/inventory/movements", async (req, res) => {
  const { filter, page } = parseMovementListQuery(req.query)
  res.json(await getMovements(filter, page))
})

// ID inválido responde 404 (não 400): para quem consulta, é um produto que não existe.
inventoryRouter.get("/inventory/:productId", async (req, res) => {
  res.json(await getProductInventory(req.params.productId))
})

// Idempotency-Key é opcional aqui, mas recomendado: repetir o envio não duplica o ajuste.
inventoryRouter.post("/inventory/adjustments", async (req, res) => {
  const idempotencyKey = readIdempotencyKey(req, { required: false })
  const result = await adjustInventory(parseAdjustment(req.body), { idempotencyKey, body: req.body })
  if (result.replayed) res.set("Idempotent-Replayed", "true")
  res.status(result.status).json(result.body)
})

inventoryRouter.post("/materials", async (req, res) => {
  res.status(201).json(await createMaterial(parseNewMaterial(req.body)))
})

inventoryRouter.get("/materials", async (req, res) => {
  const { color, page } = parseMaterialListQuery(req.query)
  res.json(await getMaterials(color, page))
})

inventoryRouter.patch("/materials/:id", async (req, res) => {
  res.json(await updateMaterial(parseMaterialId(req.params.id), parseMaterialPatch(req.body)))
})

inventoryRouter.post("/materials/:id/adjustments", async (req, res) => {
  const materialId = parseMaterialId(req.params.id)
  res.status(201).json(await adjustMaterial(materialId, parseMaterialAdjustment(req.body)))
})

inventoryRouter.get("/products/:id/materials", async (req, res) => {
  res.json(await getRecipe(parseProductId(req.params.id)))
})

inventoryRouter.put("/products/:id/materials/:materialId", async (req, res) => {
  const productId = parseProductId(req.params.id)
  const materialId = parseMaterialId(req.params.materialId)
  res.json(await setRecipeLine(productId, materialId, parseRecipeGrams(req.body)))
})

inventoryRouter.delete("/products/:id/materials/:materialId", async (req, res) => {
  const productId = parseProductId(req.params.id)
  res.json(await removeRecipeLine(productId, parseMaterialId(req.params.materialId)))
})
