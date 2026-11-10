import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { Client, createOrder, loggedClient, productWithStock, startTestEnv, uniqueSku, type TestEnv } from "./setup.js"

// Operação e observabilidade: códigos de erro, dashboard, dead-letter do outbox, retenção, rehash de senha.

let env: TestEnv
let api: Client

before(async () => {
  env = await startTestEnv()
  api = await loggedClient(env)
})
after(async () => {
  await env.close()
})

test("erros trazem um código estável além da mensagem", async () => {
  const sku = uniqueSku()
  assert.equal((await api.post("/products", { sku, name: "Peça", priceCents: 100 })).status, 201)
  const duplicate = await api.post("/products", { sku, name: "Peça", priceCents: 100 })
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.body.code, "sku_taken")
  assert.deepEqual(duplicate.body.details, { sku })

  const missing = await api.get("/orders/00000000-0000-4000-8000-00000000dead")
  assert.equal(missing.status, 404)
  assert.equal(missing.body.code, "not_found")

  const invalid = await api.post("/products", { sku: "x", name: "", priceCents: -1 })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.code, "validation")

  const noCsrf = new Client(env.base)
  noCsrf.cookie = api.cookie
  const forbidden = await noCsrf.post("/products", { sku: uniqueSku(), name: "Peça", priceCents: 100 })
  assert.equal(forbidden.status, 403)
  assert.equal(forbidden.body.code, "csrf")

  const notFoundRoute = await api.get("/nao-existe")
  assert.equal(notFoundRoute.status, 404)
  assert.equal(notFoundRoute.body.code, "not_found")
})

test("toda resposta leva X-Request-Id (gerado ou vindo do proxy)", async () => {
  const generated = await api.get("/health")
  assert.match(generated.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/)
  const forwarded = await api.request("GET", "/health", undefined, { "x-request-id": "nginx-abc-123" })
  assert.equal(forwarded.headers.get("x-request-id"), "nginx-abc-123")
  const rejected = await api.request("GET", "/health", undefined, { "x-request-id": "<script>" })
  assert.notEqual(rejected.headers.get("x-request-id"), "<script>")
})

test("produto pelo SKU exato; estoque lista preço e filtra por ativo", async () => {
  const product = await productWithStock(api, 3, 2500)
  const found = await api.get(`/products/by-sku/${product.sku.toLowerCase()}`)
  assert.equal(found.status, 200)
  assert.equal(found.body.id, product.id)
  assert.equal((await api.get("/products/by-sku/NAO-EXISTE-XYZ")).status, 404)
  assert.equal((await api.get("/products/by-sku/sku%20invalido")).status, 400)

  const inventory = await api.get(`/inventory?search=${product.sku}&active=true`)
  assert.equal(inventory.body.items.length, 1)
  assert.equal(inventory.body.items[0].priceCents, 2500)
  assert.equal(inventory.body.items[0].available, 3)
  await api.patch(`/products/${product.id}`, { active: false })
  assert.equal((await api.get(`/inventory?search=${product.sku}&active=true`)).body.items.length, 0)
  assert.equal((await api.get(`/inventory?search=${product.sku}&active=false`)).body.items.length, 1)
})

test("resumo do dashboard em uma requisição: contagens, atrasados, produção e menores saldos", async () => {
  const inStock = await productWithStock(api, 5)
  const outOfStock = await productWithStock(api, 0)
  const reserved = await createOrder(api, [{ sku: inStock.sku, quantity: 1 }], { shipBy: "2020-01-01T10:00:00-03:00" })
  assert.equal(reserved.body.status, "reserved")
  const waiting = await createOrder(api, [{ sku: outOfStock.sku, quantity: 2 }])
  assert.equal(waiting.body.status, "awaiting_stock")

  const summary = (await api.get("/dashboard/summary")).body
  assert.ok(summary.orders.byStatus.reserved >= 1)
  assert.ok(summary.orders.byStatus.awaiting_stock >= 1)
  assert.ok(summary.orders.overdue >= 1, "pedido com prazo vencido conta como atrasado")
  assert.ok(summary.production.queued >= 1, "a falta virou job na fila")
  assert.ok(summary.production.pieces >= 2)
  assert.ok(summary.upcomingShipments.length >= 2 && summary.upcomingShipments.length <= 6)
  assert.equal(summary.upcomingShipments[0].id, reserved.body.id, "prazo vencido aparece primeiro")
  assert.ok(summary.lowStock.length <= 6)
  assert.equal(summary.lowStock[0].available, 0, "menor saldo livre primeiro")
  assert.ok(summary.lowStock.every((item: { active: boolean }) => item.active))
  assert.ok(Array.isArray(summary.lowFilament))
})

test("outbox: evento que esgota as tentativas vai para a dead-letter e pode voltar à fila", async () => {
  const { publishPendingBatch, MAX_ATTEMPTS } = await import("../../src/outbox/worker.js")
  await env.pool.query("UPDATE outbox SET published_at = now() WHERE published_at IS NULL")
  const product = await productWithStock(api, 1)
  const order = await createOrder(api, [{ sku: product.sku, quantity: 1 }])
  await env.pool.query("UPDATE outbox SET attempts = $2 WHERE aggregate_id = $1 AND published_at IS NULL", [order.body.id, MAX_ATTEMPTS - 1])

  const failing = { publish: async () => { throw new Error("destino recusou") } }
  assert.deepEqual(await publishPendingBatch(failing, 100), { published: 0, failed: 0, dead: 1 })
  const dead = await api.get("/outbox/dead")
  assert.equal(dead.status, 200)
  const event = dead.body.find((entry: { aggregateId: string }) => entry.aggregateId === order.body.id)
  assert.ok(event, "aparece na dead-letter")
  assert.equal(event.aggregateType, "order")
  assert.equal(event.lastError, "destino recusou")
  assert.equal(event.attempts, MAX_ATTEMPTS)

  const ok = { publish: async () => {} }
  assert.deepEqual(await publishPendingBatch(ok, 100), { published: 0, failed: 0, dead: 0 }, "morto não é reenviado e segura os seguintes")

  const retried = await api.post(`/outbox/${event.id}/retry`)
  assert.equal(retried.status, 200)
  assert.equal(retried.body.deadAt, null)
  assert.equal((await api.post(`/outbox/${event.id}/retry`)).status, 404, "só eventos mortos voltam à fila")
  const after = await publishPendingBatch(ok, 100)
  assert.ok(after.published >= 1 && after.dead === 0)

  const metrics = await api.get("/metrics")
  assert.equal(metrics.status, 200)
  assert.ok(metrics.body.counters.http_requests_total > 0)
  assert.equal(typeof metrics.body.outbox.pending, "number")
  assert.equal(typeof metrics.body.outbox.dead, "number")
})

test("retenção apaga só o que passou do prazo nas tabelas operacionais", async () => {
  const { runRetention } = await import("../../src/retention.js")
  await env.pool.query(
    `INSERT INTO idempotency_keys (scope, key, request_hash, created_at)
     VALUES ('t', 'velha', repeat('a', 64), now() - interval '8 days'), ('t', 'nova', repeat('b', 64), now())`,
  )
  await env.pool.query(
    `INSERT INTO outbox (id, topic, aggregate_type, aggregate_id, payload, published_at)
     VALUES (gen_random_uuid(), 'order.created', 'order', gen_random_uuid(), '{}', now() - interval '31 days')`,
  )
  await env.pool.query(
    `INSERT INTO login_attempts (key_hash, attempts, window_started_at) VALUES (repeat('c', 64), 1, now() - interval '2 days')`,
  )
  const result = await runRetention(env.pool)
  assert.equal(result.idempotencyKeys, 1)
  assert.ok(result.publishedOutbox >= 1)
  assert.ok(result.loginAttempts >= 1)
  const left = await env.pool.query("SELECT key FROM idempotency_keys WHERE scope = 't'")
  assert.deepEqual(left.rows.map((row) => row.key), ["nova"])
})

test("hash de senha com parâmetros antigos é refeito no login", async () => {
  const { scryptSync, randomBytes } = await import("node:crypto")
  const email = "antiga@tres-eixos.test"
  const password = "senha-antiga-12345"
  const salt = randomBytes(16)
  const legacy = scryptSync(password.normalize("NFKC"), salt, 64, { N: 16_384, r: 8, p: 1 })
  const stored = ["scrypt", 16_384, 8, 1, salt.toString("base64"), legacy.toString("base64")].join("$")
  await env.pool.query("INSERT INTO users (id, email, name, password_hash) VALUES (gen_random_uuid(), $1, 'Antiga', $2)", [email, stored])

  const client = new Client(env.base)
  assert.equal((await client.login(email, password)).status, 200)
  const updated = await env.pool.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = $1", [email])
  assert.notEqual(updated.rows[0].password_hash, stored)
  assert.ok(updated.rows[0].password_hash.startsWith("scrypt$32768$8$3$"))
  assert.equal((await new Client(env.base).login(email, password)).status, 200, "a senha continua valendo com o hash novo")
})

test("limite de corpo: 32 kB nas rotas comuns, 256 kB na importação", async () => {
  const bigName = "x".repeat(40_000)
  const tooLarge = await api.post("/products", { sku: uniqueSku(), name: bigName, priceCents: 1 })
  assert.equal(tooLarge.status, 413)
  assert.equal(tooLarge.body.code, "payload_too_large")

  const orders = Array.from({ length: 50 }, (_, i) => ({
    externalOrderId: `GRANDE-${i}`,
    status: "paid",
    updatedAt: "2026-11-01T10:00:00-03:00",
    orderedAt: "2026-11-01T10:00:00-03:00",
    shipBy: null,
    items: Array.from({ length: 30 }, (_, j) => ({ externalSku: `SKU-IMPORT-${i}-${j}`, quantity: 1, unitPriceCents: 100 })),
  }))
  const body = JSON.stringify({ orders })
  assert.ok(body.length > 32 * 1024 && body.length < 256 * 1024, `corpo de ${body.length} bytes`)
  const imported = await api.post("/imports/orders", { orders })
  assert.equal(imported.status, 200, JSON.stringify(imported.body).slice(0, 200))
  assert.equal(imported.body.created, 50)
})
