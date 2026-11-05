import { withTransaction, type Tx } from "../db.js"
import { ConflictError, ValidationError } from "../http/errors.js"
import { findOrderIdByExternal, lockOrder, updateExternalStatus } from "../orders/order-repository.js"
import { externalStatusRank, shouldApplyExternalStatus } from "../orders/order-rules.js"
import { SIMULATOR_CHANNEL_ID } from "../orders/channels.js"
import { cancelOrderInTransaction, createOrderInTransaction } from "../orders/order-service.js"
import {
  callWithRetry,
  ConnectorError,
  type ExternalOrder,
  type MarketplaceConnector,
  type OrderPage,
  type RetryOptions,
} from "./connector.js"
import { parseExternalOrder } from "./integration-input.js"
import {
  clearOrderFailure,
  deleteCursor,
  findCursor,
  finishEvent,
  insertOrderEvent,
  listChannels as listChannelRows,
  listFailedEvents,
  recordOrderFailure,
  saveCursor,
  type Channel,
  type IntegrationError,
} from "./integration-repository.js"
import { mapExternalItems } from "./sku-mapping-service.js"

export type ImportOutcome = "created" | "updated" | "unchanged" | "duplicate" | "ignored" | "failed"

export type ImportSummary = Record<ImportOutcome, number> & { results: { externalOrderId: string; outcome: ImportOutcome }[] }

export type SyncResult = ImportSummary & {
  status: "completed" | "interrupted"
  cursor: string | null
  error?: string
}

const DEFAULT_RETRY: RetryOptions = { attempts: 3, baseDelayMs: 200, timeoutMs: 5_000 }

function emptySummary(): ImportSummary {
  return { created: 0, updated: 0, unchanged: 0, duplicate: 0, ignored: 0, failed: 0, results: [] }
}

function addToSummary(summary: ImportSummary, externalOrderId: string, outcome: ImportOutcome): void {
  summary[outcome] += 1
  summary.results.push({ externalOrderId, outcome })
}

/**
 * Aplica um pedido externo em UMA transação. Repetições do mesmo evento são descartadas pela
 * chave única (canal, event_id); status antigos ou fora de ordem não fazem o pedido regredir.
 */
async function applyExternalOrder(channelId: string, order: ExternalOrder): Promise<ImportOutcome> {
  const eventId = `order:${order.externalOrderId}:${order.updatedAt}:${order.status}`
  const payload = { externalOrderId: order.externalOrderId, status: order.status, updatedAt: order.updatedAt }
  return withTransaction(async (tx) => {
    const eventRowId = await insertOrderEvent(tx, channelId, eventId, payload)
    if (!eventRowId) return "duplicate"
    const outcome = await applyOrderEvent(tx, channelId, order)
    await finishEvent(tx, eventRowId, outcome === "ignored" ? "ignored" : "processed")
    return outcome
  })
}

async function applyOrderEvent(tx: Tx, channelId: string, order: ExternalOrder): Promise<ImportOutcome> {
  const existingId = await findOrderIdByExternal(tx, channelId, order.externalOrderId)
  if (existingId) return updateExistingOrder(tx, existingId, order)

  // Pedido que já nasce cancelado não entra na operação, mas o evento fica registrado.
  if (order.status === "cancelled") return "ignored"
  await createImportedOrder(tx, channelId, order)
  return "created"
}

/** Atualiza só o estado externo (que nunca regride); cancelado na plataforma cancela o pedido interno. */
async function updateExistingOrder(tx: Tx, orderId: string, order: ExternalOrder): Promise<ImportOutcome> {
  const locked = (await lockOrder(tx, orderId))!
  const current =
    locked.externalStatus && locked.externalUpdatedAt
      ? { status: locked.externalStatus, updatedAt: locked.externalUpdatedAt }
      : null
  const incoming = { status: order.status, updatedAt: new Date(order.updatedAt) }
  if (!shouldApplyExternalStatus(current, incoming)) return "unchanged"

  await updateExternalStatus(tx, locked.id, {
    status: order.status,
    rank: externalStatusRank(order.status),
    updatedAt: incoming.updatedAt,
  })
  if (order.status === "cancelled" && locked.status !== "shipped") {
    await cancelOrderInTransaction(tx, locked, "Cancelado na plataforma")
  }
  return "updated"
}

async function createImportedOrder(tx: Tx, channelId: string, order: ExternalOrder): Promise<void> {
  const items = await mapExternalItems(tx, channelId, order.items)
  await createOrderInTransaction(tx, {
    channelId,
    externalOrderId: order.externalOrderId,
    orderedAt: new Date(order.orderedAt),
    shipBy: order.shipBy ? new Date(order.shipBy) : null,
    externalStatus: order.status,
    externalStatusRank: externalStatusRank(order.status),
    externalUpdatedAt: new Date(order.updatedAt),
    items,
  })
}

/** Aplica o pedido e registra a falha fora da transação desfeita, para aparecer em "erros de integração". */
async function applyAndTrack(channelId: string, order: ExternalOrder): Promise<ImportOutcome> {
  try {
    const outcome = await applyExternalOrder(channelId, order)
    await clearOrderFailure(channelId, order.externalOrderId)
    return outcome
  } catch (error) {
    // Dois envios simultâneos do mesmo pedido novo: o segundo esbarra na UNIQUE e é uma duplicata.
    if (error instanceof ConflictError) return "duplicate"
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
    await recordOrderFailure(channelId, order.externalOrderId, message)
    return "failed"
  }
}

/** POST /imports/orders: arquivo JSON pequeno, sempre rotulado como simulador. */
export async function importOrders(orders: ExternalOrder[]): Promise<ImportSummary & { source: "simulador" }> {
  const summary = emptySummary()
  for (const order of orders) {
    addToSummary(summary, order.externalOrderId, await applyAndTrack(SIMULATOR_CHANNEL_ID, order))
  }
  return { ...summary, source: "simulador" }
}

/**
 * Sincroniza um canal página a página. O cursor só avança depois que todos os pedidos da página
 * foram gravados; uma interrupção retoma da última página completa, e as chaves únicas absorvem
 * pedidos repetidos. A chamada ao provedor nunca acontece dentro de uma transação aberta.
 */
export async function syncChannel(
  channelId: string,
  connector: MarketplaceConnector,
  retry: RetryOptions = DEFAULT_RETRY,
): Promise<SyncResult> {
  let cursor = await findCursor(channelId)
  const summary = emptySummary()
  try {
    for (;;) {
      const page = await callWithRetry(() => connector.listOrders(cursor), retry)
      await importPage(channelId, connector, page, summary, retry)
      if (!page.nextCursor) break
      cursor = page.nextCursor
      await saveCursor(channelId, cursor)
    }
  } catch (error) {
    if (!(error instanceof ConnectorError)) throw error
    return { ...summary, status: "interrupted", cursor, error: `${error.kind}: ${error.message}` }
  }
  // Ciclo completo: a próxima sincronização relê desde o início e reconcilia status externos.
  await deleteCursor(channelId)
  return { ...summary, status: "completed", cursor: null }
}

async function importPage(
  channelId: string,
  connector: MarketplaceConnector,
  page: OrderPage,
  summary: ImportSummary,
  retry: RetryOptions,
): Promise<void> {
  for (const entry of page.orders) {
    let raw: unknown
    try {
      raw = await callWithRetry(() => connector.fetchOrder(entry.externalOrderId), retry)
    } catch (error) {
      // Pedido listado mas não encontrado (ex.: apagado no provedor): registra e segue. Sem isso, a
      // sincronização pararia sempre nesta página. Falhas temporárias continuam interrompendo.
      if (!(error instanceof ConnectorError) || error.kind !== "not_found") throw error
      await recordOrderFailure(channelId, entry.externalOrderId, `Pedido não encontrado no provedor: ${error.message}`.slice(0, 500))
      addToSummary(summary, entry.externalOrderId, "failed")
      continue
    }
    let order: ExternalOrder
    try {
      order = parseExternalOrder(raw)
    } catch (error) {
      // Pedido malformado vindo do provedor: vira erro de integração visível, sem derrubar a sincronização.
      if (!(error instanceof ValidationError)) throw error
      await recordOrderFailure(channelId, entry.externalOrderId, `Pedido inválido do provedor: ${error.message}`.slice(0, 500))
      addToSummary(summary, entry.externalOrderId, "failed")
      continue
    }
    addToSummary(summary, order.externalOrderId, await applyAndTrack(channelId, order))
  }
}

export function listIntegrationErrors(): Promise<IntegrationError[]> {
  return listFailedEvents()
}

export function listChannels(): Promise<Channel[]> {
  return listChannelRows()
}
