import assert from "node:assert/strict"
import test from "node:test"
import { callWithRetry, ConnectorError } from "../src/integrations/connector.js"
import { SimulatedConnector } from "../src/integrations/simulated-connector.js"
import { hashPassword, verifyPassword } from "../src/security/password.js"

const fast = { attempts: 3, baseDelayMs: 1, timeoutMs: 50 }

test("senha: hash com salt aleatório, sem texto puro, verificação correta", async () => {
  const a = await hashPassword("senha-bem-longa-1")
  const b = await hashPassword("senha-bem-longa-1")
  assert.notEqual(a, b)
  assert.ok(!a.includes("senha-bem-longa-1"))
  assert.equal(await verifyPassword("senha-bem-longa-1", a), true)
  assert.equal(await verifyPassword("errada", a), false)
  assert.equal(await verifyPassword("x", "formato-invalido"), false)
})

test("conector: pagina pelos pedidos com cursor", async () => {
  const connector = new SimulatedConnector({ pageSize: 2 })
  const first = await connector.listOrders(null)
  assert.equal(first.orders.length, 2)
  const second = await connector.listOrders(first.nextCursor)
  assert.equal(second.orders.length, 1)
  assert.equal(second.nextCursor, null)
})

test("conector: 429 e 500 são tentados de novo; not_found não", async () => {
  const connector = new SimulatedConnector({ failures: { 1: "rate_limited", 2: "server_error" } })
  const page = await callWithRetry(() => connector.listOrders(null), fast)
  assert.equal(page.orders.length, 2)
  assert.equal(connector.callCount, 3)

  const missing = new SimulatedConnector()
  await assert.rejects(callWithRetry(() => missing.fetchOrder("NAO-EXISTE"), fast), (error: unknown) => {
    return error instanceof ConnectorError && error.kind === "not_found"
  })
  assert.equal(missing.callCount, 1)
})

test("conector: chamada sem resposta vira timeout e é tentada de novo", async () => {
  const connector = new SimulatedConnector({ hangOnCalls: [1] })
  const page = await callWithRetry(() => connector.listOrders(null), fast)
  assert.equal(page.orders.length, 2)

  const alwaysHangs = new SimulatedConnector({ hangOnCalls: [1, 2, 3] })
  await assert.rejects(callWithRetry(() => alwaysHangs.listOrders(null), fast), (error: unknown) => {
    return error instanceof ConnectorError && error.kind === "timeout"
  })
})
