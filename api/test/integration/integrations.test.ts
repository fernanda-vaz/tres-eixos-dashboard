import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { inventoryOf, loggedClient, productWithStock, startTestEnv, type Client, type TestEnv } from "./setup.js"

let env: TestEnv
let api: Client
const SIMULATOR = "00000000-0000-4000-8000-000000000002"

before(async () => {
  env = await startTestEnv()
  api = await loggedClient(env)
})
after(async () => {
  await env.close()
})

async function mapSku(externalSku: string, productId: string) {
  return api.put("/integrations/sku-mappings", { channelId: SIMULATOR, externalSku, productId })
}

async function orderByExternal(externalOrderId: string) {
  const row = await env.pool.query("SELECT id FROM orders WHERE external_order_id = $1", [externalOrderId])
  return (await api.get(`/orders/${row.rows[0].id}`)).body
}

test("importação interrompida retoma sem duplicar; SKU desconhecido vira pendência", async () => {
  const cubo = await productWithStock(api, 5)
  const vaso = await productWithStock(api, 0)
  await mapSku("SIM-CUBO-AZUL", cubo.id)
  await mapSku("SIM-VASO-ROSA", vaso.id)

  const { syncChannel } = await import("../../src/integrations/import-service.js")
  const { SimulatedConnector } = await import("../../src/integrations/simulated-connector.js")
  const retry = { attempts: 2, baseDelayMs: 1, timeoutMs: 200 }

  // Página 1 (2 pedidos) entra; a listagem da página 2 falha duas vezes: sincronização interrompida.
  const failing = new SimulatedConnector({ pageSize: 2, failures: { 4: "server_error", 5: "server_error" } })
  const first = await syncChannel(SIMULATOR, failing, retry)
  assert.equal(first.status, "interrupted")
  assert.equal(first.created, 2)
  assert.equal(first.cursor, "2")

  const second = await syncChannel(SIMULATOR, new SimulatedConnector({ pageSize: 2 }), retry)
  assert.equal(second.status, "completed")
  assert.equal(second.created, 1, "retomou da página 2")

  const again = await syncChannel(SIMULATOR, new SimulatedConnector({ pageSize: 2 }), retry)
  assert.equal(again.created, 0)
  assert.equal(again.duplicate, 3, "eventos repetidos são descartados")
  const count = await env.pool.query("SELECT count(*)::int AS n FROM orders WHERE channel_id = $1", [SIMULATOR])
  assert.equal(count.rows[0].n, 3)

  assert.equal((await orderByExternal("SIM-1001")).status, "reserved")
  assert.equal((await orderByExternal("SIM-1003")).status, "awaiting_stock", "item sem estoque")
  const unmapped = await orderByExternal("SIM-1002")
  assert.equal(unmapped.status, "pending_mapping")
  assert.equal(unmapped.items[0].externalSku, "SIM-SKU-DESCONHECIDO")

  const pending = (await api.get("/integrations/pending-skus")).body
  assert.deepEqual(pending.map((p: { externalSku: string }) => p.externalSku), ["SIM-SKU-DESCONHECIDO"])

  // Mapear resolve a pendência e tenta reservar.
  const mapped = await mapSku("SIM-SKU-DESCONHECIDO", cubo.id)
  assert.equal(mapped.body.ordersUpdated, 1)
  assert.equal((await orderByExternal("SIM-1002")).status, "reserved")
  assert.equal((await inventoryOf(api, cubo.id)).reserved, 2)
})

test("status externo fora de ordem não regride; cancelamento externo libera a reserva", async () => {
  const product = await productWithStock(api, 3)
  await mapSku("IMP-SKU-1", product.id)
  const order = {
    externalOrderId: "IMP-2001",
    status: "shipped",
    orderedAt: "2026-11-01T10:00:00-03:00",
    updatedAt: "2026-11-02T10:00:00-03:00",
    shipBy: null,
    items: [{ externalSku: "IMP-SKU-1", quantity: 1, unitPriceCents: 1000 }],
  }
  const created = await api.post("/imports/orders", { orders: [order] })
  assert.equal(created.body.source, "simulador")
  assert.equal(created.body.created, 1)

  const stale = await api.post("/imports/orders", {
    orders: [{ ...order, status: "new", updatedAt: "2026-11-01T10:00:00-03:00" }],
  })
  assert.equal(stale.body.unchanged, 1)
  assert.equal((await orderByExternal("IMP-2001")).externalStatus, "shipped")

  const repeated = await api.post("/imports/orders", { orders: [order] })
  assert.equal(repeated.body.duplicate, 1)

  const other = { ...order, externalOrderId: "IMP-2002", status: "paid" }
  await api.post("/imports/orders", { orders: [other] })
  assert.equal((await inventoryOf(api, product.id)).reserved, 2)
  await api.post("/imports/orders", {
    orders: [{ ...other, status: "cancelled", updatedAt: "2026-11-03T10:00:00-03:00" }],
  })
  const cancelled = await orderByExternal("IMP-2002")
  assert.equal(cancelled.status, "cancelled")
  assert.equal((await inventoryOf(api, product.id)).reserved, 1)
})

test("importação recusa provedores reais e entradas inválidas", async () => {
  const invalid = await api.post("/imports/orders", { orders: [{ externalOrderId: "X" }] })
  assert.equal(invalid.status, 400)
  const anonymous = await fetch(`${env.base}/imports/orders`, { method: "POST" })
  assert.equal(anonymous.status, 403, "sem sessão nem CSRF")
})

test("pedido malformado vindo do conector vira erro de integração sem derrubar a sincronização", async () => {
  const { syncChannel } = await import("../../src/integrations/import-service.js")
  const { SimulatedConnector } = await import("../../src/integrations/simulated-connector.js")
  const broken = { externalOrderId: "SIM-QUEBRADO", status: "paid", orderedAt: "ontem", updatedAt: "2026-11-01T10:00:00Z", shipBy: null, items: [] }
  const valid = { externalOrderId: "SIM-OK-1", status: "paid", orderedAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z", shipBy: null,
    items: [{ externalSku: "SIM-QUALQUER", quantity: 1, unitPriceCents: 100 }] }
  const connector = new SimulatedConnector({ orders: [broken as never, valid as never], pageSize: 5 })
  const result = await syncChannel("00000000-0000-4000-8000-000000000002", connector, { attempts: 1, baseDelayMs: 1, timeoutMs: 200 })
  assert.equal(result.status, "completed")
  assert.equal(result.failed, 1)
  assert.equal(result.created, 1)
  const errors = (await api.get("/integrations/errors")).body
  assert.ok(errors.some((e: { lastError: string }) => e.lastError.startsWith("Pedido inválido do provedor")))
})

test("pedido listado mas apagado no provedor não trava a sincronização", async () => {
  const { syncChannel } = await import("../../src/integrations/import-service.js")
  const { ConnectorError } = await import("../../src/integrations/connector.js")
  const { SimulatedConnector } = await import("../../src/integrations/simulated-connector.js")
  const valid = { externalOrderId: "SIM-OK-2", status: "paid", orderedAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z", shipBy: null,
    items: [{ externalSku: "SIM-QUALQUER", quantity: 1, unitPriceCents: 100 }] }
  const ghost = { ...valid, externalOrderId: "SIM-APAGADO" }
  // Lista os dois, mas fetchOrder do apagado responde not_found.
  class DeletingConnector extends SimulatedConnector {
    override async fetchOrder(id: string) {
      if (id === "SIM-APAGADO") throw new ConnectorError("not_found", "Pedido SIM-APAGADO não encontrado")
      return super.fetchOrder(id)
    }
  }
  const connector = new DeletingConnector({ orders: [ghost as never, valid as never], pageSize: 1 })
  const result = await syncChannel("00000000-0000-4000-8000-000000000002", connector, { attempts: 1, baseDelayMs: 1, timeoutMs: 200 })
  assert.equal(result.status, "completed", "seguiu para a página seguinte")
  assert.equal(result.failed, 1)
  assert.equal(result.created, 1)
})

test("mapear SKU não reserva estoque para pedido cancelado enquanto o mapeamento esperava", async () => {
  const product = await productWithStock(api, 5)
  const order = {
    externalOrderId: "RACE-1", status: "paid", orderedAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z", shipBy: null,
    items: [{ externalSku: "RACE-SKU", quantity: 1, unitPriceCents: 100 }],
  }
  await api.post("/imports/orders", { orders: [order] })
  const { rows } = await env.pool.query("SELECT id FROM orders WHERE external_order_id = 'RACE-1'")
  const orderId = rows[0].id

  // Outra transação segura o pedido: o mapeamento o encontra como pendente e fica esperando a trava.
  const blocker = await env.pool.connect()
  await blocker.query("BEGIN")
  await blocker.query("SELECT id FROM orders WHERE id = $1 FOR UPDATE", [orderId])
  const mapping = api.put("/integrations/sku-mappings", { channelId: SIMULATOR, externalSku: "RACE-SKU", productId: product.id })
  await new Promise((resolve) => setTimeout(resolve, 400))
  // Enquanto isso, o pedido é cancelado e a trava é liberada.
  await blocker.query("UPDATE orders SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [orderId])
  await blocker.query("COMMIT")
  blocker.release()

  const result = await mapping
  assert.equal(result.status, 200)
  assert.equal(result.body.ordersUpdated, 0, "o pedido cancelado foi descartado depois da trava")
  const reserved = await env.pool.query(
    "SELECT count(*)::int AS n FROM reservations r JOIN order_items oi ON oi.id = r.order_item_id WHERE oi.order_id = $1",
    [orderId],
  )
  assert.equal(reserved.rows[0].n, 0)
  assert.equal((await inventoryOf(api, product.id)).reserved, 0)
})
