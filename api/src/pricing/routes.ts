import { Router } from "express"
import { parseProductId } from "../catalog/product-input.js"
import {
  parseChannelId,
  parseChannelPatch,
  parseCostListQuery,
  parseCostSheet,
  parseNewChannel,
  parseSettings,
} from "./pricing-input.js"
import {
  createChannel,
  getChannels,
  getProductPricing,
  getSettings,
  listProductCosts,
  patchChannel,
  saveCostSheet,
  updateSettings,
} from "./pricing-service.js"

export const pricingRouter = Router()

pricingRouter.get("/pricing/settings", async (_req, res) => {
  res.json(await getSettings())
})

pricingRouter.put("/pricing/settings", async (req, res) => {
  res.json(await updateSettings(parseSettings(req.body)))
})

pricingRouter.get("/pricing/channels", async (_req, res) => {
  res.json(await getChannels())
})

pricingRouter.post("/pricing/channels", async (req, res) => {
  res.status(201).json(await createChannel(parseNewChannel(req.body)))
})

pricingRouter.patch("/pricing/channels/:id", async (req, res) => {
  res.json(await patchChannel(parseChannelId(req.params.id), parseChannelPatch(req.body)))
})

pricingRouter.get("/pricing/products", async (req, res) => {
  res.json(await listProductCosts(parseCostListQuery(req.query)))
})

pricingRouter.get("/products/:id/pricing", async (req, res) => {
  res.json(await getProductPricing(parseProductId(req.params.id)))
})

// Pré-visualização: calcula com a ficha enviada, sem salvar (recalcular enquanto se digita).
pricingRouter.post("/products/:id/pricing/preview", async (req, res) => {
  res.json(await getProductPricing(parseProductId(req.params.id), parseCostSheet(req.body)))
})

pricingRouter.put("/products/:id/cost-sheet", async (req, res) => {
  res.json(await saveCostSheet(parseProductId(req.params.id), parseCostSheet(req.body)))
})
