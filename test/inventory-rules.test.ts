import assert from "node:assert/strict"
import test from "node:test"
import { availableToReserve, canAdjust, canReserve, productionShortage } from "../src/inventory/rules.js"

test("disponível para reserva desconta o reservado", () => {
  assert.equal(availableToReserve(5, 2), 3)
})

test("reserva exatamente igual ao disponível é aceita; acima, recusada", () => {
  assert.equal(canReserve(5, 2, 3), true)
  assert.equal(canReserve(5, 2, 4), false)
})

test("quantidade zero, negativa ou fracionária é recusada", () => {
  for (const quantity of [0, -1, 1.5]) assert.throws(() => canReserve(5, 2, quantity))
})

test("saldo inconsistente é recusado", () => {
  assert.throws(() => availableToReserve(-1, 0))
  assert.throws(() => availableToReserve(2, 3))
})

test("falta de produção considera saldo livre e fila existente", () => {
  assert.equal(productionShortage({ waitingDemand: 4, available: 1, openProduction: 1 }), 2)
  assert.equal(productionShortage({ waitingDemand: 2, available: 3, openProduction: 0 }), 0)
})

test("ajuste não deixa menos peças físicas que as reservadas", () => {
  assert.equal(canAdjust(5, 3, -2), true)
  assert.equal(canAdjust(5, 3, -3), false)
  assert.throws(() => canAdjust(5, 3, 0))
})
