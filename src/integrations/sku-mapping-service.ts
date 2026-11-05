import { findProductById } from "../catalog/product-repository.js"
import { withTransaction, type Tx } from "../db.js"
import { ConflictError, ValidationError } from "../http/errors.js"
import { allocateOrder } from "../orders/allocation.js"
import { lockInventory } from "../inventory/inventory-repository.js"
import {
  assignProductToPendingItems,
  findMappedProductIds,
  findOrdersPendingSku,
  lockOrder,
  type NewOrderItem,
} from "../orders/order-repository.js"
import type { ExternalOrderItem } from "./connector.js"
import type { SkuMapping } from "./integration-input.js"
import {
  findSkuMappings,
  listUnmappedSkus,
  registerExternalSkus,
  upsertSkuMapping,
  type PendingSku,
} from "./integration-repository.js"

/** Resolve os SKUs externos. Desconhecidos viram pendência (product_id nulo), nunca são descartados. */
export async function mapExternalItems(tx: Tx, channelId: string, items: ExternalOrderItem[]): Promise<NewOrderItem[]> {
  const skus = [...new Set(items.map((item) => item.externalSku))]
  await registerExternalSkus(tx, channelId, skus)
  const productBySku = await findSkuMappings(tx, channelId, skus)
  return items.map((item) => ({
    productId: productBySku.get(item.externalSku) ?? null,
    externalSku: item.externalSku,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
  }))
}

/**
 * Mapeia um SKU externo para um produto e reprocessa os pedidos pendentes por causa dele.
 *
 * Ordem de locks, para não haver deadlock nem reserva em pedido já cancelado:
 * 1. trava TODOS os pedidos afetados, em ordem de id, antes de tocar no estoque;
 * 2. depois de travados, confere de novo o status (um cancelamento pode ter acontecido
 *    entre a busca e a trava) e descarta os que não estão mais pendentes;
 * 3. trava de uma vez, em ordem de produto, o estoque de todos os itens envolvidos;
 * 4. só então atribui o produto e reserva.
 */
export function mapExternalSku(
  mapping: SkuMapping,
): Promise<{ externalSku: string; productId: string; ordersUpdated: number }> {
  const { channelId, externalSku, productId } = mapping
  return withTransaction(async (tx) => {
    const product = await findProductById(tx, productId)
    if (!product) throw new ValidationError("Produto não encontrado")
    if (!product.active) throw new ConflictError("Produto inativo não pode receber mapeamento")
    await upsertSkuMapping(tx, channelId, externalSku, productId)

    const stillPending = await lockPendingOrders(tx, await findOrdersPendingSku(tx, channelId, externalSku))
    await lockInventory(tx, [productId, ...(await findMappedProductIds(tx, stillPending))])
    for (const orderId of stillPending) {
      await assignProductToPendingItems(tx, orderId, externalSku, productId)
      await allocateOrder(tx, orderId, `SKU ${externalSku} mapeado`)
    }
    return { externalSku, productId, ordersUpdated: stillPending.length }
  })
}

/** Trava os pedidos em ordem de id e devolve só os que continuam aguardando mapeamento. */
async function lockPendingOrders(tx: Tx, orderIds: string[]): Promise<string[]> {
  const pending: string[] = []
  for (const orderId of [...orderIds].sort()) {
    const order = await lockOrder(tx, orderId)
    if (order?.status === "pending_mapping") pending.push(orderId)
  }
  return pending
}

export function listPendingSkus(): Promise<PendingSku[]> {
  return listUnmappedSkus()
}
