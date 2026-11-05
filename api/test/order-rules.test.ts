import assert from "node:assert/strict"
import test from "node:test"
import { deriveAllocationStatus, shouldApplyExternalStatus } from "../src/orders/order-rules.js"

test("status de alocação: pendência de SKU tem precedência", () => {
  assert.equal(deriveAllocationStatus([{ mapped: false, reserved: false }, { mapped: true, reserved: true }]), "pending_mapping")
  assert.equal(deriveAllocationStatus([{ mapped: true, reserved: true }, { mapped: true, reserved: false }]), "awaiting_stock")
  assert.equal(deriveAllocationStatus([{ mapped: true, reserved: true }]), "reserved")
})

const at = (iso: string) => new Date(iso)

test("status externo antigo não faz pedido enviado voltar para novo", () => {
  const current = { status: "shipped" as const, updatedAt: at("2026-11-02T10:00:00Z") }
  assert.equal(shouldApplyExternalStatus(current, { status: "new", updatedAt: at("2026-11-01T10:00:00Z") }), false)
  // Mesmo com data mais nova, regressão no ciclo de vida é ignorada.
  assert.equal(shouldApplyExternalStatus(current, { status: "paid", updatedAt: at("2026-11-03T10:00:00Z") }), false)
})

test("avanço de status externo é aplicado; repetição não", () => {
  const current = { status: "paid" as const, updatedAt: at("2026-11-01T10:00:00Z") }
  assert.equal(shouldApplyExternalStatus(current, { status: "shipped", updatedAt: at("2026-11-02T10:00:00Z") }), true)
  assert.equal(shouldApplyExternalStatus(current, { status: "paid", updatedAt: at("2026-11-02T10:00:00Z") }), false)
  assert.equal(shouldApplyExternalStatus(null, { status: "new", updatedAt: at("2026-11-01T10:00:00Z") }), true)
})

test("cancelamento externo é aplicado mesmo após pagamento", () => {
  const current = { status: "paid" as const, updatedAt: at("2026-11-01T10:00:00Z") }
  assert.equal(shouldApplyExternalStatus(current, { status: "cancelled", updatedAt: at("2026-11-01T12:00:00Z") }), true)
})
