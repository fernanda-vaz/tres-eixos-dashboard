import { ValidationError } from "../http/errors.js"
import { allowOnly, parseEnum, parseInteger, parseObject, parseOptionalDate, parseText, parseUuid } from "../http/validation.js"
import { SIMULATOR_CHANNEL_ID } from "../orders/channels.js"
import { EXTERNAL_STATUSES } from "../orders/order-rules.js"
import type { ExternalOrder, ExternalOrderItem } from "./connector.js"

const MAX_ORDERS_PER_IMPORT = 50
const MAX_ITEMS_PER_ORDER = 50

export type SkuMapping = { channelId: string; externalSku: string; productId: string }

/**
 * Valida um pedido externo, venha do arquivo importado ou do conector: dados de terceiros
 * passam pela mesma checagem que a entrada da API.
 */
export function parseExternalOrder(value: unknown, index = 0): ExternalOrder {
  const label = `orders[${index}]`
  const data = parseObject(value)
  allowOnly(data, ["externalOrderId", "status", "updatedAt", "orderedAt", "shipBy", "items"])
  if (!Array.isArray(data.items) || data.items.length === 0 || data.items.length > MAX_ITEMS_PER_ORDER) {
    throw new ValidationError(`${label}.items deve ter de 1 a ${MAX_ITEMS_PER_ORDER} itens`)
  }
  const updatedAt = parseOptionalDate(data.updatedAt, `${label}.updatedAt`)
  const orderedAt = parseOptionalDate(data.orderedAt, `${label}.orderedAt`)
  if (!updatedAt || !orderedAt) throw new ValidationError(`${label}: updatedAt e orderedAt são obrigatórios`)
  const shipBy = parseOptionalDate(data.shipBy, `${label}.shipBy`)
  return {
    externalOrderId: parseText(data.externalOrderId, `${label}.externalOrderId`, 120),
    status: parseEnum(data.status, `${label}.status`, EXTERNAL_STATUSES),
    updatedAt: updatedAt.toISOString(),
    orderedAt: orderedAt.toISOString(),
    shipBy: shipBy?.toISOString() ?? null,
    items: data.items.map((raw, itemIndex) => parseExternalItem(raw, `${label}.items[${itemIndex}]`)),
  }
}

function parseExternalItem(value: unknown, label: string): ExternalOrderItem {
  const item = parseObject(value)
  allowOnly(item, ["externalSku", "quantity", "unitPriceCents"])
  return {
    externalSku: parseText(item.externalSku, `${label}.externalSku`, 120),
    quantity: parseInteger(item.quantity, `${label}.quantity`, 1, 10_000),
    unitPriceCents: parseInteger(item.unitPriceCents, `${label}.unitPriceCents`, 0, 2_147_483_647),
  }
}

/** Corpo de POST /imports/orders: { orders: [...] }, com até MAX_ORDERS_PER_IMPORT pedidos. */
export function parseOrderImport(body: unknown): ExternalOrder[] {
  const data = parseObject(body)
  allowOnly(data, ["orders"])
  if (!Array.isArray(data.orders) || data.orders.length === 0 || data.orders.length > MAX_ORDERS_PER_IMPORT) {
    throw new ValidationError(`orders deve ter de 1 a ${MAX_ORDERS_PER_IMPORT} pedidos`)
  }
  return data.orders.map((order, index) => parseExternalOrder(order, index))
}

/** Sem channelId, o mapeamento vale para o simulador (único canal importável hoje). */
export function parseSkuMapping(body: unknown): SkuMapping {
  const data = parseObject(body)
  allowOnly(data, ["channelId", "externalSku", "productId"])
  return {
    channelId: data.channelId === undefined ? SIMULATOR_CHANNEL_ID : parseUuid(data.channelId, "channelId"),
    externalSku: parseText(data.externalSku, "externalSku", 120),
    productId: parseUuid(data.productId, "productId"),
  }
}
