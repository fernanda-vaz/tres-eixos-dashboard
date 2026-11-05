import type { Tx } from "../db.js"
import {
  applyInventoryDelta,
  demandAndSupply,
  lockInventory,
  recordMovement,
  reserveIfAvailable,
} from "../inventory/inventory-repository.js"
import { productionShortage } from "../inventory/rules.js"
import { enqueueOutbox } from "../outbox.js"
import { cancelQueuedJobsForItem, insertJobHistory, insertOrderJob } from "../production/production-repository.js"
import {
  getOrderStatus,
  listItemAllocationStates,
  listUnreservedItems,
  lockWaitingItemsForProduct,
  updateStatus,
  type UnreservedItem,
} from "./order-repository.js"
import { ALLOCATING_STATUSES, deriveAllocationStatus, type OrderStatus } from "./order-rules.js"
import { insertReservation, listActiveReservations, setReservationStatus } from "./reservation-repository.js"

/**
 * O item acabou de ser reservado com peças já prontas: um job ainda não iniciado para ele
 * deixou de ser necessário e é cancelado (job em impressão segue e abastece o estoque).
 */
async function cancelQueuedJobForItem(tx: Tx, orderItemId: string): Promise<void> {
  for (const jobId of await cancelQueuedJobsForItem(tx, orderItemId)) {
    await insertJobHistory(tx, {
      jobId,
      from: "queued",
      to: "cancelled",
      reason: "Item atendido com estoque disponível",
    })
  }
}

/** Registra a reserva já descontada do saldo livre (reserveIfAvailable) e o movimento de auditoria. */
async function confirmReservation(tx: Tx, item: UnreservedItem, reason: string): Promise<void> {
  await insertReservation(tx, { orderItemId: item.id, productId: item.productId, quantity: item.quantity })
  await recordMovement(tx, {
    productId: item.productId,
    kind: "reservation",
    physicalDelta: 0,
    reservedDelta: item.quantity,
    reason,
    operationKey: `reserve:${item.id}`,
    orderId: item.orderId,
  })
  await cancelQueuedJobForItem(tx, item.id)
}

/**
 * Sem saldo para o item: cria (no máximo) um job de produção para a falta real:
 * demanda em espera − saldo livre − produção já na fila.
 */
async function enqueueShortageProduction(tx: Tx, item: UnreservedItem): Promise<void> {
  // Bloqueia a linha do estoque para que o cálculo da falta não dispute com outra transação.
  const inventory = (await lockInventory(tx, [item.productId])).get(item.productId)
  if (!inventory) throw new Error(`Estoque inexistente para o produto ${item.productId}`)
  const { waitingDemand, openProduction } = await demandAndSupply(tx, item.productId)
  const shortage = productionShortage({
    waitingDemand,
    available: inventory.physical - inventory.reserved,
    openProduction,
  })
  if (shortage > 0) {
    await insertOrderJob(tx, {
      productId: item.productId,
      orderItemId: item.id,
      quantity: Math.min(item.quantity, shortage),
    })
  }
}

/** Tenta reservar um item; sem saldo, enfileira produção. Quem chama deve ter bloqueado o pedido. */
async function reserveItem(tx: Tx, item: UnreservedItem): Promise<void> {
  if (await reserveIfAvailable(tx, item.productId, item.quantity)) {
    await confirmReservation(tx, item, "Reserva para pedido")
  } else {
    await enqueueShortageProduction(tx, item)
  }
}

/** Recalcula o status de alocação do pedido e registra a transição, se houver. */
async function refreshOrderStatus(tx: Tx, orderId: string, reason: string): Promise<OrderStatus> {
  const current = await getOrderStatus(tx, orderId)
  if (!ALLOCATING_STATUSES.includes(current)) return current

  const next = deriveAllocationStatus(await listItemAllocationStates(tx, orderId))
  if (next !== current) {
    await updateStatus(tx, orderId, current, next, reason)
    await enqueueOutbox(tx, "order.status_changed", orderId, { from: current, to: next })
  }
  return next
}

/**
 * Reserva todos os itens mapeados e ainda sem reserva de um pedido JÁ BLOQUEADO por quem chama.
 * Itens são processados em ordem de product_id (ordem estável de locks).
 */
export async function allocateOrder(tx: Tx, orderId: string, reason: string): Promise<OrderStatus> {
  for (const item of await listUnreservedItems(tx, orderId)) {
    await reserveItem(tx, item)
  }
  return refreshOrderStatus(tx, orderId, reason)
}

/**
 * Depois que o saldo livre de um produto aumenta (produção, ajuste, liberação), reserva para os
 * pedidos em espera: prazo de envio mais próximo, depois data do pedido. Para no primeiro que não
 * couber, preservando a ordem de quem pediu primeiro.
 *
 * Quem chama já detém o lock do estoque desse produto. Pedidos bloqueados por outra transação
 * (por exemplo, sendo cancelados) são pulados com SKIP LOCKED em vez de esperar: esperar aqui,
 * segurando o estoque, inverteria a ordem de locks (pedido → estoque) e poderia gerar deadlock.
 * Um pedido pulado pode ser realocado depois via POST /orders/:id/allocation.
 */
export async function allocateWaitingForProduct(tx: Tx, productId: string): Promise<void> {
  const touched = new Set<string>()
  for (const item of await lockWaitingItemsForProduct(tx, productId)) {
    if (!(await reserveIfAvailable(tx, productId, item.quantity))) break
    await confirmReservation(tx, item, "Reserva para pedido em espera")
    touched.add(item.orderId)
  }
  for (const orderId of touched) {
    await refreshOrderStatus(tx, orderId, "Estoque disponível para o pedido")
  }
}

/** Libera as reservas ativas de um pedido (já bloqueado). Retorna os produtos liberados. */
export async function releaseReservations(tx: Tx, orderId: string, reason: string): Promise<string[]> {
  const reservations = await listActiveReservations(tx, orderId)
  await lockInventory(tx, reservations.map((reservation) => reservation.productId))
  for (const reservation of reservations) {
    const recorded = await recordMovement(tx, {
      productId: reservation.productId,
      kind: "release",
      physicalDelta: 0,
      reservedDelta: -reservation.quantity,
      reason,
      operationKey: `release:${reservation.id}`,
      orderId,
    })
    if (!recorded) continue
    await applyInventoryDelta(tx, reservation.productId, 0, -reservation.quantity)
    await setReservationStatus(tx, reservation.id, "released")
  }
  return [...new Set(reservations.map((reservation) => reservation.productId))]
}
