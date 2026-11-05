import { Router } from "express"
import { SIMULATOR_CHANNEL_ID } from "../orders/channels.js"
import { importOrders, listChannels, listIntegrationErrors, syncChannel } from "./import-service.js"
import { parseOrderImport, parseSkuMapping } from "./integration-input.js"
import { SimulatedConnector } from "./simulated-connector.js"
import { listPendingSkus, mapExternalSku } from "./sku-mapping-service.js"

export const integrationsRouter = Router()

// Importação manual de um arquivo JSON pequeno. A origem é sempre "simulador", nunca um marketplace real.
integrationsRouter.post("/imports/orders", async (req, res) => {
  res.json(await importOrders(parseOrderImport(req.body)))
})

// Executa o conector simulado com as fixtures (normal, SKU não mapeado, sem estoque).
integrationsRouter.post("/integrations/simulator/sync", async (_req, res) => {
  res.json(await syncChannel(SIMULATOR_CHANNEL_ID, new SimulatedConnector()))
})

integrationsRouter.get("/integrations/channels", async (_req, res) => {
  res.json(await listChannels())
})

integrationsRouter.get("/integrations/pending-skus", async (_req, res) => {
  res.json(await listPendingSkus())
})

integrationsRouter.put("/integrations/sku-mappings", async (req, res) => {
  res.json(await mapExternalSku(parseSkuMapping(req.body)))
})

integrationsRouter.get("/integrations/errors", async (_req, res) => {
  res.json(await listIntegrationErrors())
})
