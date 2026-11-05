import { Router } from "express"
import { readIdempotencyKey } from "../http/idempotency.js"
import { parseCancelReason, parseManualOrder, parseOrderId, parseOrderListQuery } from "./order-input.js"
import {
  cancelOrder,
  createManualOrder,
  dispatchOrder,
  getOrder,
  getOrders,
  markLabelPrinted,
  markReady,
  retryAllocation,
} from "./order-service.js"

export const ordersRouter = Router()

ordersRouter.post("/orders", async (req, res) => {
  const idempotencyKey = readIdempotencyKey(req, { required: true })!
  const result = await createManualOrder(parseManualOrder(req.body), { idempotencyKey, body: req.body })
  const order = result.body as { id: string }
  if (result.replayed) res.set("Idempotent-Replayed", "true")
  res.status(result.status).location(`/orders/${order.id}`).json(result.body)
})

ordersRouter.get("/orders", async (req, res) => {
  const { filter, page } = parseOrderListQuery(req.query)
  res.json(await getOrders(filter, page))
})

ordersRouter.get("/orders/:id", async (req, res) => {
  res.json(await getOrder(parseOrderId(req.params.id)))
})

// Ações explícitas em vez de um PATCH livre de status.
ordersRouter.post("/orders/:id/cancel", async (req, res) => {
  const orderId = parseOrderId(req.params.id)
  res.json(await cancelOrder(orderId, parseCancelReason(req.body)))
})

ordersRouter.post("/orders/:id/allocation", async (req, res) => {
  res.json(await retryAllocation(parseOrderId(req.params.id)))
})

ordersRouter.post("/orders/:id/ready", async (req, res) => {
  res.json(await markReady(parseOrderId(req.params.id)))
})

ordersRouter.post("/orders/:id/label", async (req, res) => {
  res.json(await markLabelPrinted(parseOrderId(req.params.id)))
})

ordersRouter.post("/orders/:id/dispatch", async (req, res) => {
  res.json(await dispatchOrder(parseOrderId(req.params.id)))
})
