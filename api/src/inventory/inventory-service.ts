import { randomUUID } from "node:crypto"
import { pool, withTransaction, type Tx } from "../db.js"
import { ConflictError, NotFoundError } from "../http/errors.js"
import { runIdempotent, type StoredResponse } from "../http/idempotency.js"
import { isUuid } from "../http/validation.js"
import { toPage, type Page, type PageRequest } from "../pagination.js"
import type { AdjustmentInput } from "./inventory-input.js"
import {
  applyInventoryDelta,
  findInventory,
  listInventory,
  listMovements,
  lockInventory,
  recordMovement,
  type InventoryFilter,
  type InventoryItem,
  type InventoryRow,
  type Movement,
  type MovementFilter,
} from "./inventory-repository.js"
import { canAdjust } from "./rules.js"
import { notifyStockIncreased } from "./stock-events.js"

export type InventoryBalance = InventoryRow & { available: number }

function withAvailable(inventory: InventoryRow): InventoryBalance {
  return { ...inventory, available: inventory.physical - inventory.reserved }
}

/**
 * Ajuste de peças prontas: recebe delta e motivo (nunca um "novo total" sem histórico).
 * Saldo físico não pode ficar abaixo do reservado. Um aumento atende pedidos em espera.
 * Sem Idempotency-Key, cada envio vale como uma operação nova.
 */
export function adjustInventory(
  input: AdjustmentInput,
  request: { idempotencyKey: string | undefined; body: unknown },
): Promise<StoredResponse & { replayed: boolean }> {
  const key = request.idempotencyKey ?? randomUUID()
  return withTransaction((tx) =>
    runIdempotent(tx, "inventory.adjust", key, request.body, async () => ({
      status: 201,
      body: withAvailable(await applyAdjustment(tx, input, `adjust:${key}`)),
    })),
  )
}

async function applyAdjustment(tx: Tx, input: AdjustmentInput, operationKey: string): Promise<InventoryRow> {
  const current = (await lockInventory(tx, [input.productId])).get(input.productId)
  if (!current) throw new NotFoundError("Produto não encontrado")
  if (!canAdjust(current.physical, current.reserved, input.delta)) {
    throw new ConflictError("Ajuste deixaria menos peças do que as reservadas para pedidos", {
      physical: current.physical,
      reserved: current.reserved,
    })
  }
  await recordMovement(tx, {
    productId: input.productId,
    kind: "adjustment",
    physicalDelta: input.delta,
    reservedDelta: 0,
    reason: input.reason,
    operationKey,
  })
  const inventory = await applyInventoryDelta(tx, input.productId, input.delta, 0)
  if (input.delta <= 0) return inventory
  // Saldo subiu: o fulfillment (registrado em app.ts) reserva para os pedidos em espera.
  await notifyStockIncreased(tx, input.productId)
  return (await lockInventory(tx, [input.productId])).get(input.productId)!
}

export async function getInventory(filter: InventoryFilter, page: PageRequest): Promise<Page<InventoryItem>> {
  return toPage(page, await listInventory(pool, filter, page))
}

export async function getMovements(filter: MovementFilter, page: PageRequest): Promise<Page<Movement>> {
  return toPage(page, await listMovements(pool, filter, page))
}

export async function getProductInventory(productId: string): Promise<InventoryBalance> {
  if (!isUuid(productId)) throw new NotFoundError("Produto não encontrado")
  const inventory = await findInventory(pool, productId)
  if (!inventory) throw new NotFoundError("Produto não encontrado")
  return withAvailable(inventory)
}
