import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { loggedClient, productWithStock, startTestEnv, type Client, type TestEnv } from "./setup.js"

let env: TestEnv
let api: Client

before(async () => {
  env = await startTestEnv()
  api = await loggedClient(env)
})
after(async () => {
  await env.close()
})

const SETTINGS = {
  energyCentsPerKwh: 100,
  printerPowerWatts: 120,
  printerPriceCents: 300_000,
  printerLifetimeHours: 5000,
  laborCentsPerHour: 3000,
  failureRatePercent: 10,
  taxRatePercent: 6,
}
const SHEET = { printMinutes: 150, purgeGrams: 0, laborMinutes: 20, packagingCents: 150, extraCents: 0, targetMarginPercent: 30 }

test("calcula custo pela receita e preço sugerido por canal; aplicar o preço muda a margem atual", async () => {
  assert.equal((await api.put("/pricing/settings", SETTINGS)).body.taxRatePercent, 6)
  const channels = (await api.get("/pricing/channels")).body
  assert.deepEqual(channels.map((c: { name: string }) => c.name), ["Venda direta", "Mercado Livre", "Shopee"])
  const ml = channels.find((c: { name: string }) => c.name === "Mercado Livre")
  assert.equal((await api.patch(`/pricing/channels/${ml.id}`, { feePercent: 16, fixedFeeCents: 600 })).body.feePercent, 16)

  const product = await productWithStock(api, 0, 1500)
  const material = await api.post("/materials", { name: "PLA", color: "Azul", costPerKgCents: 10_000 })
  assert.equal((await api.patch(`/materials/${material.body.id}`, { costPerKgCents: 12_000 })).body.costPerKgCents, 12_000)
  await api.put(`/products/${product.id}/materials/${material.body.id}`, { gramsPerUnit: "40" })

  const before = (await api.get(`/products/${product.id}/pricing`)).body
  assert.equal(before.sheet.saved, false)
  assert.ok(before.warnings.some((w: string) => w.includes("tempo de impressão")))

  const preview = (await api.post(`/products/${product.id}/pricing/preview`, SHEET)).body
  assert.equal(preview.breakdown.unitCostCents, 1876)
  assert.equal((await api.get(`/products/${product.id}/pricing`)).body.sheet.saved, false, "pré-visualizar não salva")

  const saved = (await api.put(`/products/${product.id}/cost-sheet`, SHEET)).body
  assert.equal(saved.sheet.saved, true)
  assert.deepEqual(saved.warnings, [])
  const mlPrice = saved.channels.find((c: { channel: { name: string } }) => c.channel.name === "Mercado Livre")
  assert.equal(mlPrice.suggested.priceCents, 5159)
  assert.ok(mlPrice.atCurrentPrice.profitCents < 0, "o preço atual de R$ 15,00 dá prejuízo no marketplace")

  await api.patch(`/products/${product.id}`, { priceCents: mlPrice.suggested.priceCents })
  const overview = (await api.get("/pricing/products")).body
  const row = overview.items.find((item: { productId: string }) => item.productId === product.id)
  assert.equal(row.unitCostCents, 1876)
  assert.ok(row.margins.find((m: { channelName: string }) => m.channelName === "Mercado Livre").marginPercent >= 30)
})

test("valida percentuais e protege nomes de canal", async () => {
  assert.equal((await api.put("/pricing/settings", { ...SETTINGS, taxRatePercent: 6.123 })).status, 400)
  assert.equal((await api.put("/pricing/settings", { ...SETTINGS, printerLifetimeHours: 0 })).status, 400)
  assert.equal((await api.post("/pricing/channels", { name: "Venda direta" })).status, 409)
  assert.equal((await api.post("/pricing/channels", { name: "Feira", feePercent: 0, fixedFeeCents: 0 })).status, 201)
  assert.equal((await api.put(`/products/00000000-0000-4000-8000-000000000999/cost-sheet`, SHEET)).status, 404)
})

test("peça multicolorida usa o preço de cada filamento e custeia a purga", async () => {
  await api.put("/pricing/settings", { ...SETTINGS, failureRatePercent: 0 })
  const product = await productWithStock(api, 0, 5000)
  const white = await api.post("/materials", { name: "PLA", color: "Branco", costPerKgCents: 9_000 })
  const gold = await api.post("/materials", { name: "PLA Silk", color: "Dourado", costPerKgCents: 21_000 })
  await api.put(`/products/${product.id}/materials/${white.body.id}`, { gramsPerUnit: "30" })
  await api.put(`/products/${product.id}/materials/${gold.body.id}`, { gramsPerUnit: "10" })

  const sheet = { printMinutes: 0, purgeGrams: "20", laborMinutes: 0, packagingCents: 0, extraCents: 0, targetMarginPercent: 30 }
  const pricing = (await api.put(`/products/${product.id}/cost-sheet`, sheet)).body
  assert.deepEqual(pricing.materials.map((m: { color: string; costCents: number }) => [m.color, m.costCents]), [["Branco", 270], ["Dourado", 210]])
  assert.equal(pricing.breakdown.purgeCents, 240)
  assert.equal(pricing.sheet.purgeGrams, "20.000")
  assert.equal(pricing.breakdown.unitCostCents, 720)

  // Mudar o preço de um filamento muda o custo dos produtos que o usam.
  await api.patch(`/materials/${gold.body.id}`, { costPerKgCents: 30_000 })
  const updated = (await api.get(`/products/${product.id}/pricing`)).body
  assert.equal(updated.materials.find((m: { color: string }) => m.color === "Dourado").costCents, 300)
  assert.equal((await api.put(`/products/${product.id}/cost-sheet`, { ...sheet, purgeGrams: "-1" })).status, 400)
})
