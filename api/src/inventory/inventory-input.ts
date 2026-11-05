import { ValidationError } from "../http/errors.js"
import { allowOnly, parseInteger, parseObject, parsePagination, parseText, parseUuid, queryText } from "../http/validation.js"
import type { PageRequest } from "../pagination.js"
import type { InventoryFilter, MovementFilter } from "./inventory-repository.js"

const MAX_DELTA = 100_000

export type AdjustmentInput = { productId: string; delta: number; reason: string }

export function parseAdjustment(value: unknown): AdjustmentInput {
  const data = parseObject(value)
  allowOnly(data, ["productId", "delta", "reason"])
  const delta = parseInteger(data.delta, "delta", -MAX_DELTA, MAX_DELTA)
  if (delta === 0) throw new ValidationError("delta não pode ser zero")
  return {
    productId: parseUuid(data.productId, "productId"),
    delta,
    reason: parseText(data.reason, "reason", 255),
  }
}

export function parseInventoryListQuery(query: unknown): { filter: InventoryFilter; page: PageRequest } {
  const page = parsePagination(query)
  return { filter: { search: queryText(query, "search") }, page }
}

export function parseMovementListQuery(query: unknown): { filter: MovementFilter; page: PageRequest } {
  const page = parsePagination(query)
  const productId = queryText(query, "productId", 36)
  const orderId = queryText(query, "orderId", 36)
  const filter = {
    productId: productId === undefined ? undefined : parseUuid(productId, "productId"),
    orderId: orderId === undefined ? undefined : parseUuid(orderId, "orderId"),
  }
  return { filter, page }
}
