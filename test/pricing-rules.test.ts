import assert from "node:assert/strict"
import test from "node:test"
import {
  costBreakdown,
  divRound,
  evaluatePrice,
  materialCostCents,
  purgeCostCents,
  pricingWarnings,
  suggestPrice,
  type PricingSettings,
} from "../src/pricing/pricing-rules.js"

const settings: PricingSettings = {
  energyCentsPerKwh: 100, // R$ 1,00/kWh
  printerPowerWatts: 120,
  printerPriceCents: 300_000, // R$ 3.000,00
  printerLifetimeHours: 5000,
  laborCentsPerHour: 3000, // R$ 30,00/h
  failureRateBp: 1000, // 10%
  taxRateBp: 600, // 6%
}
const sheet = { printMinutes: 150, purgeGrams: "0", laborMinutes: 20, packagingCents: 150, extraCents: 0, targetMarginBp: 3000 }
const pla = { materialId: "m", name: "PLA", color: "Azul", grams: "40", costPerKgCents: 12_000 } // R$ 120/kg
const direct = { id: "c", name: "Direta", feeBp: 0, fixedFeeCents: 0, active: true }

test("filamento: gramas × preço por kg, arredondado ao centavo", () => {
  assert.equal(materialCostCents(pla), 480) // 40 g × R$ 120/kg = R$ 4,80
  assert.equal(materialCostCents({ grams: "12.345", costPerKgCents: 9_990 }), 123) // 1,2333… → R$ 1,23
})

test("custo por peça soma produção (com falhas), mão de obra, embalagem e extras", () => {
  const cost = costBreakdown(settings, sheet, [pla])
  assert.equal(cost.filamentCents, 480)
  assert.equal(cost.energyCents, 30) // 120 W × 2,5 h = 0,3 kWh × R$ 1
  assert.equal(cost.depreciationCents, 150) // R$ 3.000 ÷ 5.000 h × 2,5 h
  assert.equal(cost.failureCents, 66) // 10% de (480 + 30 + 150)
  assert.equal(cost.laborCents, 1000) // 20 min de R$ 30/h
  assert.equal(cost.unitCostCents, 480 + 30 + 150 + 66 + 1000 + 150)
})

test("preço sugerido deixa a margem desejada depois de tarifa e imposto", () => {
  const marketplace = { id: "ml", name: "Marketplace", feeBp: 1600, fixedFeeCents: 600, active: true }
  const price = suggestPrice(1876, marketplace, 600, 3000)!
  // (18,76 + 6,00) ÷ (1 − 0,16 − 0,06 − 0,30) = 51,58… → R$ 51,59 (para cima)
  assert.equal(price.priceCents, 5159)
  assert.ok(price.marginBp >= 3000, "margem efetiva não fica abaixo da desejada")
  assert.equal(price.profitCents, 5159 - 1876 - price.feeCents - price.taxCents)
})

test("sem preço possível quando tarifa + imposto + margem chegam a 100%", () => {
  assert.equal(suggestPrice(1000, { ...direct, feeBp: 5000 }, 2000, 3000), null)
})

test("avaliar o preço atual mostra prejuízo quando o preço não cobre o custo", () => {
  const result = evaluatePrice(1500, 1876, direct, 600)
  assert.equal(result.taxCents, 90)
  assert.equal(result.profitCents, 1500 - 1876 - 90)
  assert.ok(result.marginBp < 0)
})

test("alertas apontam dados que deixariam o custo subestimado", () => {
  const empty = { ...settings, energyCentsPerKwh: 0, laborCentsPerHour: 0 }
  const warnings = pricingWarnings(empty, sheet, [{ ...pla, costPerKgCents: 0 }])
  assert.ok(warnings.some((w) => w.includes("sem preço por kg")))
  assert.ok(warnings.some((w) => w.includes("kWh")))
  assert.ok(warnings.some((w) => w.includes("hora de trabalho")))
  assert.ok(pricingWarnings(settings, sheet, []).some((w) => w.includes("receita")))
})

test("peça multicolorida: cada cor com seu preço; purga pelo preço médio ponderado", () => {
  const branco = { materialId: "b", name: "PLA", color: "Branco", grams: "30", costPerKgCents: 9_000 } // R$ 90/kg
  const silk = { materialId: "s", name: "PLA Silk", color: "Dourado", grams: "10", costPerKgCents: 21_000 } // R$ 210/kg
  // média ponderada: (30 × 90 + 10 × 210) ÷ 40 = R$ 120/kg → 20 g de purga = R$ 2,40
  assert.equal(purgeCostCents("20", [branco, silk]), 240)
  assert.equal(purgeCostCents("0", [branco, silk]), 0)
  assert.equal(purgeCostCents("20", []), 0)

  const cost = costBreakdown({ ...settings, failureRateBp: 1000 }, { ...sheet, printMinutes: 0, laborMinutes: 0, packagingCents: 0, purgeGrams: "20" }, [branco, silk])
  assert.equal(cost.filamentCents, 270 + 210) // R$ 2,70 + R$ 2,10
  assert.equal(cost.purgeCents, 240)
  assert.equal(cost.failureCents, 72) // 10% de (4,80 + 2,40)
  assert.equal(cost.unitCostCents, 480 + 240 + 72)
})

test("arredondamento simétrico também para negativos (margens de prejuízo)", () => {
  assert.equal(divRound(5n, 2n), 3n)
  assert.equal(divRound(-5n, 2n), -3n)
  assert.equal(divRound(-40000n, 6n), -6667n) // −6666,67 → −6667 (antes saía −6666)
  assert.equal(evaluatePrice(3, 5, { id: "c", name: "c", feeBp: 0, fixedFeeCents: 0, active: true }, 0).marginBp, -6667)
})
