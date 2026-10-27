import test from "node:test"
import assert from "node:assert/strict"
import { available, canFulfill } from "../src/stock.js"

test("calcula saldo disponível descontando peças defeituosas", () => {
  assert.equal(available(5, 2), 3)
})
test("recusa quantidade maior que o saldo disponível", () => {
  assert.equal(canFulfill(5, 2, 4), false)
})
test("recusa quantidade inválida", () => {
  assert.throws(() => canFulfill(5, 2, 0))
})
