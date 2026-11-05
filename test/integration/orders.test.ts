import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import {
  Client,
  createOrder,
  inventoryOf,
  loggedClient,
  productWithStock,
  startTestEnv,
  uniqueSku,
  type TestEnv,
} from "./setup.js"

let env: TestEnv
let api: Client

before(async () => {
  env = await startTestEnv()
  api = await loggedClient(env)
})
after(async () => {
  await env.close()
})

describe("segurança", () => {
  test("API nega acesso não autenticado; /health e /ready são públicos", async () => {
    const anonymous = new Client(env.base)
    assert.equal((await anonymous.get("/health")).status, 200)
    assert.equal((await anonymous.get("/ready")).status, 200)
    assert.equal((await anonymous.get("/products")).status, 401)
    assert.equal((await anonymous.get("/orders")).status, 401)
  })

  test("escrita sem token CSRF é recusada mesmo com sessão válida", async () => {
    const noCsrf = new Client(env.base)
    noCsrf.cookie = api.cookie
    assert.equal((await noCsrf.get("/products")).status, 200)
    const response = await noCsrf.post("/products", { sku: uniqueSku(), name: "X", priceCents: 1 })
    assert.equal(response.status, 403)
  })

  test("login: senha errada 401, cookie HttpOnly, sessão persistida e logout invalida", async () => {
    const client = new Client(env.base)
    assert.equal((await client.login(undefined, "senha-errada-000")).status, 401)
    const ok = await client.login()
    assert.equal(ok.status, 200)
    assert.match(ok.headers.getSetCookie()[0], /HttpOnly/i)
    const sessions = await env.pool.query("SELECT count(*)::int AS n FROM user_sessions")
    assert.ok(sessions.rows[0].n >= 1, "sessão gravada no PostgreSQL, não em memória")

    const cookie = client.cookie
    assert.equal((await client.post("/auth/logout")).status, 204)
    const reused = new Client(env.base)
    reused.cookie = cookie
    assert.equal((await reused.get("/auth/me")).status, 401)
  })
})

describe("catálogo", () => {
  test("cadastro persiste, SKU duplicado (inclusive concorrente) recebe 409 e há paginação", async () => {
    const sku = uniqueSku()
    const results = await Promise.all(
      [1, 2, 3].map(() => api.post("/products", { sku: sku.toLowerCase(), name: "Cubo infinito", priceCents: 1500 })),
    )
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409])
    const created = results.find((r) => r.status === 201)!.body
    assert.equal(created.sku, sku)
    assert.equal((await api.get(`/products/${created.id}`)).body.name, "Cubo infinito")
    assert.equal((await api.get("/products/nao-e-uuid")).status, 400)
    assert.equal((await api.get("/products?active=yes")).status, 400, "booleano inválido não vira false em silêncio")

    const page = await api.get(`/products?search=${sku}&pageSize=5`)
    assert.equal(page.body.total, 1)
    assert.equal(page.body.pageSize, 5)
  })
})

describe("estoque e pedidos manuais", () => {
  test("ajuste exige motivo e não deixa físico abaixo do reservado", async () => {
    const product = await productWithStock(api, 3)
    assert.equal((await api.post("/inventory/adjustments", { productId: product.id, delta: 1 })).status, 400)
    await createOrder(api, [{ sku: product.sku, quantity: 2 }])
    const tooMuch = await api.post("/inventory/adjustments", { productId: product.id, delta: -2, reason: "Quebra" })
    assert.equal(tooMuch.status, 409)
    assert.deepEqual(await inventoryOf(api, product.id), { productId: product.id, physical: 3, reserved: 2, available: 1 })
  })

  test("pedido manual exige Idempotency-Key; repetir devolve o mesmo pedido; outro conteúdo é 409", async () => {
    const product = await productWithStock(api, 5)
    const body = { items: [{ sku: product.sku, quantity: 1 }] }
    assert.equal((await api.post("/orders", body)).status, 400)

    const headers = { "Idempotency-Key": `pedido-${uniqueSku()}` }
    const [first, second] = await Promise.all([api.post("/orders", body, headers), api.post("/orders", body, headers)])
    assert.equal(first.status, 201)
    assert.equal(second.status, 201)
    assert.equal(first.body.id, second.body.id, "duas tentativas resultam em um registro")
    assert.equal((await inventoryOf(api, product.id)).reserved, 1)

    const different = await api.post("/orders", { items: [{ sku: product.sku, quantity: 2 }] }, headers)
    assert.equal(different.status, 409)
  })

  test("com uma unidade disponível e dois pedidos simultâneos, apenas um reserva", async () => {
    const product = await productWithStock(api, 1)
    const orders = await Promise.all([1, 2, 3, 4].map(() => createOrder(api, [{ sku: product.sku, quantity: 1 }])))
    assert.ok(orders.every((o) => o.status === 201))
    const statuses = orders.map((o) => o.body.status).sort()
    assert.deepEqual(statuses, ["awaiting_stock", "awaiting_stock", "awaiting_stock", "reserved"])
    assert.deepEqual(await inventoryOf(api, product.id), { productId: product.id, physical: 1, reserved: 1, available: 0 })
  })

  test("cancelar libera uma vez e repassa o saldo ao próximo da fila", async () => {
    const product = await productWithStock(api, 1)
    const first = await createOrder(api, [{ sku: product.sku, quantity: 1 }])
    const second = await createOrder(api, [{ sku: product.sku, quantity: 1 }])
    assert.equal(first.body.status, "reserved")
    assert.equal(second.body.status, "awaiting_stock")

    const [c1, c2] = await Promise.all([
      api.post(`/orders/${first.body.id}/cancel`, { reason: "Cliente desistiu" }),
      api.post(`/orders/${first.body.id}/cancel`, { reason: "Cliente desistiu" }),
    ])
    assert.equal(c1.body.status, "cancelled")
    assert.equal(c2.body.status, "cancelled")
    const releases = await env.pool.query(
      "SELECT count(*)::int AS n FROM stock_movements WHERE order_id = $1 AND kind = 'release'",
      [first.body.id],
    )
    assert.equal(releases.rows[0].n, 1)
    assert.equal((await api.get(`/orders/${second.body.id}`)).body.status, "reserved")
    assert.equal((await inventoryOf(api, product.id)).reserved, 1)
  })

  test("expedição baixa físico e reservado uma vez; pedido enviado não cancela", async () => {
    const product = await productWithStock(api, 2)
    const order = await createOrder(api, [{ sku: product.sku, quantity: 2 }])
    assert.equal((await api.post(`/orders/${order.body.id}/dispatch`)).status, 409, "precisa estar pronto")
    assert.equal((await api.post(`/orders/${order.body.id}/ready`)).body.status, "ready")

    const dispatched = await Promise.all([1, 2].map(() => api.post(`/orders/${order.body.id}/dispatch`)))
    assert.ok(dispatched.every((r) => r.body.status === "shipped"))
    assert.deepEqual(await inventoryOf(api, product.id), { productId: product.id, physical: 0, reserved: 0, available: 0 })
    assert.equal((await api.post(`/orders/${order.body.id}/cancel`)).status, 409)
  })

  test("preço fica congelado no pedido e produto inativo não entra em novo pedido", async () => {
    const product = await productWithStock(api, 5, 1000)
    const order = await createOrder(api, [{ sku: product.sku, quantity: 2 }])
    await api.patch(`/products/${product.id}`, { priceCents: 9999, active: false })
    const view = await api.get(`/orders/${order.body.id}`)
    assert.equal(view.body.items[0].unitPriceCents, 1000)
    assert.equal(view.body.totalCents, 2000)
    assert.equal((await createOrder(api, [{ sku: product.sku, quantity: 1 }])).status, 409)
  })
})

describe("atrasados", () => {
  test("?overdue=true conta todos os pedidos em aberto com prazo vencido", async () => {
    const product = await productWithStock(api, 0)
    const past = "2026-01-01T12:00:00Z"
    const before = (await api.get("/orders?overdue=true&pageSize=1")).body.total
    for (let i = 0; i < 25; i++) await createOrder(api, [{ sku: product.sku, quantity: 1 }], { shipBy: past })
    const future = await createOrder(api, [{ sku: product.sku, quantity: 1 }], { shipBy: "2099-01-01T12:00:00Z" })
    const cancelled = await createOrder(api, [{ sku: product.sku, quantity: 1 }], { shipBy: past })
    await api.post(`/orders/${cancelled.body.id}/cancel`)

    const overdue = await api.get("/orders?overdue=true&pageSize=1")
    assert.equal(overdue.body.total - before, 25, "conta além de 20, ignora cancelado e prazo futuro")
    assert.ok(future.body.id)
    assert.equal((await api.get("/orders?overdue=talvez")).status, 400)
  })
})
