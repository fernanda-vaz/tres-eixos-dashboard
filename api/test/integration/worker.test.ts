import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { Client, createOrder, EMAIL, loggedClient, productWithStock, startTestEnv, type TestEnv } from "./setup.js"

let env: TestEnv
let api: Client

before(async () => {
  env = await startTestEnv()
  api = await loggedClient(env)
})
after(async () => {
  await env.close()
})

test("worker publica cada evento uma vez, em ordem por pedido, mesmo com dois workers simultâneos", async () => {
  const { publishPendingBatch } = await import("../../src/outbox-worker.js")
  const product = await productWithStock(api, 2)
  await createOrder(api, [{ sku: product.sku, quantity: 1 }])
  await createOrder(api, [{ sku: product.sku, quantity: 1 }])
  const pending = await env.pool.query("SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL")
  assert.ok(pending.rows[0].n >= 2)

  const seen: { id: string; aggregateId: string; createdAt: Date }[] = []
  const publisher = { publish: async (event: { id: string; aggregateId: string; createdAt: Date }) => { seen.push(event) } }
  // Vários lotes concorrentes até esvaziar: cada lote leva no máximo um evento por pedido.
  for (let round = 0; round < 10; round++) {
    const results = await Promise.all([publishPendingBatch(publisher, 100), publishPendingBatch(publisher, 100)])
    if (results.every((r) => r.published === 0)) break
  }
  assert.equal(seen.length, pending.rows[0].n)
  assert.equal(new Set(seen.map((e) => e.id)).size, seen.length, "nenhum evento publicado duas vezes")
  for (const aggregate of new Set(seen.map((e) => e.aggregateId))) {
    const times = seen.filter((e) => e.aggregateId === aggregate).map((e) => new Date(e.createdAt).getTime())
    assert.deepEqual(times, [...times].sort((a, b) => a - b), "eventos de um pedido saem na ordem em que aconteceram")
  }
})

test("falha na publicação reagenda o evento e segura os eventos seguintes do mesmo pedido", async () => {
  const { publishPendingBatch } = await import("../../src/outbox-worker.js")
  await env.pool.query("UPDATE outbox SET published_at = now() WHERE published_at IS NULL")
  const product = await productWithStock(api, 1)
  const order = await createOrder(api, [{ sku: product.sku, quantity: 1 }])
  await api.post(`/orders/${order.body.id}/ready`)
  const events = await env.pool.query("SELECT count(*)::int AS n FROM outbox WHERE aggregate_id = $1 AND published_at IS NULL", [order.body.id])
  assert.ok(events.rows[0].n >= 2, "o pedido tem mais de um evento pendente")

  const failing = { publish: async () => { throw new Error("broker fora do ar") } }
  assert.deepEqual(await publishPendingBatch(failing, 100), { published: 0, failed: 1 }, "só o primeiro evento do pedido é tentado")
  const failed = await env.pool.query(
    "SELECT attempts, last_error, next_attempt_at > now() AS later, lease_id FROM outbox WHERE aggregate_id = $1 AND attempts > 0",
    [order.body.id],
  )
  assert.equal(failed.rows[0].attempts, 1)
  assert.equal(failed.rows[0].last_error, "broker fora do ar")
  assert.equal(failed.rows[0].later, true)
  assert.equal(failed.rows[0].lease_id, null)
  const ok = { publish: async () => {} }
  assert.deepEqual(await publishPendingBatch(ok, 100), { published: 0, failed: 0 }, "os seguintes esperam o que falhou")
})

test("limite de login fica no banco, sem guardar e-mail em texto", async () => {
  const client = new Client(env.base)
  for (let i = 0; i < 5; i++) assert.equal((await client.login(EMAIL, "senha-errada-000")).status, 401)
  assert.equal((await client.login(EMAIL, "senha-errada-000")).status, 429)
  assert.equal((await client.login()).status, 429, "bloqueia também a senha certa durante a janela")

  const rows = await env.pool.query("SELECT key_hash, attempts FROM login_attempts")
  assert.ok(rows.rows.some((row) => row.attempts >= 5))
  assert.ok(rows.rows.every((row) => /^[0-9a-f]{64}$/.test(row.key_hash) && !row.key_hash.includes("@")))
})

test("tentativas de login em paralelo não furam o limite", async () => {
  await env.pool.query("DELETE FROM login_attempts")
  const email = "paralelo@tres-eixos.test"
  const clients = await Promise.all(Array.from({ length: 30 }, async () => {
    const client = new Client(env.base)
    const csrf = await client.get("/auth/csrf")
    client.csrf = csrf.body.csrfToken
    return client
  }))
  const results = await Promise.all(clients.map((client) => client.post("/auth/login", { email, password: "errada-errada-1" })))
  const statuses = results.map((r) => r.status)
  assert.equal(statuses.filter((s) => s === 401).length, 5, "só 5 senhas foram de fato conferidas")
  assert.equal(statuses.filter((s) => s === 429).length, 25)
})

test("sessão anônima (só o token do login) expira em minutos, não em horas", async () => {
  await env.pool.query("DELETE FROM user_sessions")
  const anonymous = new Client(env.base)
  await anonymous.get("/auth/csrf")
  const anon = await env.pool.query("SELECT expire - now() < interval '11 minutes' AS short FROM user_sessions")
  assert.equal(anon.rows.length, 1)
  assert.equal(anon.rows[0].short, true)

  await loggedClient(env)
  const logged = await env.pool.query("SELECT count(*)::int AS n FROM user_sessions WHERE expire - now() > interval '11 hours'")
  assert.equal(logged.rows[0].n, 1, "depois do login a sessão volta a durar 12 horas")
})
