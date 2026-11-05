import { randomUUID } from "node:crypto"
import { parseSku } from "../catalog/product-input.js"
import { ValidationError } from "../http/errors.js"
import {
  allowOnly,
  parseEnum,
  parseInteger,
  parseObject,
  parseOptionalDate,
  parseOptionalText,
  parsePagination,
  parseUuid,
  queryBoolean,
  queryText,
} from "../http/validation.js"
import type { PageRequest } from "../pagination.js"
import { ORDER_STATUSES, type OrderStatus } from "./order-rules.js"

const MAX_ITEMS = 50
const MAX_QUANTITY = 10_000

export type ManualOrderInput = {
  externalOrderId: string
  orderedAt: Date
  shipBy: Date | null
  items: { sku: string; quantity: number }[]
}

export function parseOrderId(value: unknown): string {
  return parseUuid(value, "ID de pedido")
}

/** Pedido digitado pela loja. Sem número externo, gera um MAN-<uuid>; sem data, vale agora. */
export function parseManualOrder(value: unknown): ManualOrderInput {
  const data = parseObject(value)
  allowOnly(data, ["externalOrderId", "orderedAt", "shipBy", "items"])
  const items = parseManualItems(data.items)
  return {
    externalOrderId: parseOptionalText(data.externalOrderId, "externalOrderId", 120) ?? `MAN-${randomUUID()}`,
    orderedAt: parseOptionalDate(data.orderedAt, "orderedAt") ?? new Date(),
    shipBy: parseOptionalDate(data.shipBy, "shipBy"),
    items,
  }
}

function parseManualItems(value: unknown): ManualOrderInput["items"] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS) {
    throw new ValidationError(`items deve ter de 1 a ${MAX_ITEMS} itens`)
  }
  const items = value.map((raw, index) => {
    const item = parseObject(raw)
    allowOnly(item, ["sku", "quantity"])
    return { sku: parseSku(item.sku), quantity: parseInteger(item.quantity, `items[${index}].quantity`, 1, MAX_QUANTITY) }
  })
  if (new Set(items.map((item) => item.sku)).size !== items.length) {
    throw new ValidationError("Cada SKU deve aparecer uma única vez; some as quantidades")
  }
  return items
}

/** Motivo opcional do cancelamento; sem corpo ou sem motivo, vale o padrão. */
export function parseCancelReason(body: unknown): string {
  const fallback = "Cancelado pela loja"
  if (body === undefined) return fallback
  const data = parseObject(body)
  allowOnly(data, ["reason"])
  return parseOptionalText(data.reason, "reason", 255) ?? fallback
}

export type OrderListFilter = { status?: OrderStatus; overdue?: boolean }

/** ?status=… e ?overdue=true (pedidos em aberto com prazo de envio vencido). */
export function parseOrderListQuery(query: unknown): { filter: OrderListFilter; page: PageRequest } {
  const page = parsePagination(query)
  const statusText = queryText(query, "status", 30)
  const status = statusText === undefined ? undefined : parseEnum(statusText, "status", ORDER_STATUSES)
  return { filter: { status, overdue: queryBoolean(query, "overdue") }, page }
}
