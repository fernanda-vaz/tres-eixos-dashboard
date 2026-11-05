import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createOrder, inventoryOf, loggedClient, productWithStock, startTestEnv, type Client, type TestEnv } from "./setup.js"

let env: TestEnv
let api: Client

before(async () => {
  env = await startTestEnv()
  api = await loggedClient(env)
})
after(async () => {
  await env.close()
})

async function materialWithGrams(color: string, grams: string): Promise<string> {
  const material = await api.post("/materials", { name: "PLA", color })
  assert.equal(material.status, 201)
  if (grams !== "0") {
    await api.post(`/materials/${material.body.id}/adjustments`, { gramsDelta: grams, reason: "Rolo novo" })
  }
  return material.body.id
}

async function jobsForOrder(orderId: string) {
  return (await api.get(`/orders/${orderId}`)).body.productionJobs
}

test("falta de estoque cria job; falta de cor bloqueia; produzir reserva para o pedido sem enviá-lo", async () => {
  const product = await productWithStock(api, 1)
  const rosa = await materialWithGrams("Rosa", "50")
  await api.put(`/products/${product.id}/materials/${rosa}`, { gramsPerUnit: "30" })

  const order = await createOrder(api, [{ sku: product.sku, quantity: 3 }], { shipBy: "2026-12-01T18:00:00-03:00" })
  assert.equal(order.body.status, "awaiting_stock")
  const [job] = await jobsForOrder(order.body.id)
  assert.equal(job.quantity, 2, "produz apenas a falta: 3 pedidas − 1 livre")

  const queue = await api.get("/production/jobs?color=os")
  assert.equal((await api.get("/materials?color=%25")).body.total, 0, "% digitado é texto, não curinga")
  const queued = queue.body.items.find((item: { id: string }) => item.id === job.id)
  assert.equal(queued.blockedBy[0].color, "Rosa", "precisa de 60 g, há 50 g")
  const blocked = await api.post(`/production/jobs/${job.id}/start`)
  assert.equal(blocked.status, 409)
  assert.equal(blocked.body.details.materials[0].requiredGrams, "60.000")

  await api.post(`/materials/${rosa}/adjustments`, { gramsDelta: "20", reason: "Outro rolo" })
  assert.equal((await api.post(`/production/jobs/${job.id}/start`)).body.status, "printing")
  const done = await api.post(`/production/jobs/${job.id}/complete`, { actualGrams: { [rosa]: "62.5" } })
  assert.equal(done.body.status, "done")
  assert.equal((await api.post(`/production/jobs/${job.id}/complete`)).body.status, "done", "concluir de novo não duplica")

  const view = await api.get(`/orders/${order.body.id}`)
  assert.equal(view.body.status, "reserved", "produzir não marca como enviado")
  assert.deepEqual(await inventoryOf(api, product.id), { productId: product.id, physical: 3, reserved: 3, available: 0 })

  const consumption = await env.pool.query(
    "SELECT grams_delta::text, estimated_grams::text FROM material_movements WHERE production_job_id = $1",
    [job.id],
  )
  assert.deepEqual(consumption.rows[0], { grams_delta: "-62.500", estimated_grams: "60.000" })
  const material = (await api.get("/materials?color=Rosa")).body.items[0]
  assert.equal(material.physicalGrams, "7.500")
  assert.equal(material.reservedGrams, "0.000")
})

test("etiqueta não muda o status externo; cancelamento põe produção em espera até decisão explícita", async () => {
  const product = await productWithStock(api, 0)
  const order = await createOrder(api, [{ sku: product.sku, quantity: 2 }])
  const [job] = await jobsForOrder(order.body.id)
  await api.post(`/production/jobs/${job.id}/start`)

  await api.post(`/orders/${order.body.id}/cancel`, { reason: "Desistência" })
  const held = (await api.get(`/production/jobs/${job.id}`)).body
  assert.equal(held.status, "on_hold")
  assert.equal((await api.post(`/production/jobs/${job.id}/complete`)).status, 409, "não continua sem decisão")

  const decided = await api.post(`/production/jobs/${job.id}/decision`, {
    action: "continue_for_stock",
    reason: "Item de giro",
  })
  assert.equal(decided.body.status, "printing")
  assert.equal(decided.body.purpose, "stock")
  await api.post(`/production/jobs/${job.id}/complete`)
  assert.deepEqual(await inventoryOf(api, product.id), { productId: product.id, physical: 2, reserved: 0, available: 2 })

  const shipped = await productWithStock(api, 1)
  const ready = await createOrder(api, [{ sku: shipped.sku, quantity: 1 }])
  await api.post(`/orders/${ready.body.id}/ready`)
  const labelled = await api.post(`/orders/${ready.body.id}/label`)
  assert.ok(labelled.body.shipment.labelPrintedAt)
  assert.equal(labelled.body.status, "ready")
  assert.equal(labelled.body.externalStatus, null)
})

test("prioridade manual exige motivo e reordena a fila", async () => {
  const product = await productWithStock(api, 0)
  const job = await api.post("/production/jobs", { productId: product.id, quantity: 1 })
  assert.equal(job.status, 201)
  assert.equal((await api.put(`/production/jobs/${job.body.id}/priority`, { priority: 5 })).status, 400)
  await api.put(`/production/jobs/${job.body.id}/priority`, { priority: 50, reason: "Feira no sábado" })
  const queue = await api.get("/production/jobs")
  assert.equal(queue.body.items[0].id, job.body.id)
})
