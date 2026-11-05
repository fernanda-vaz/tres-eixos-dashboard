import assert from "node:assert/strict"
import test from "node:test"
import { parseProduct, parseProductPatch } from "../src/catalog/product-input.js"
import { ValidationError } from "../src/http/errors.js"
import { canonicalJson, requestHash } from "../src/http/idempotency.js"
import { allowOnly, parseGrams, parsePagination, queryBoolean } from "../src/http/validation.js"
import { likePattern } from "../src/sql.js"

test("produto: SKU normalizado e preço em centavos validado", () => {
  assert.deepEqual(parseProduct({ sku: " cubo-azul ", name: " Cubo ", priceCents: 1500 }), {
    sku: "CUBO-AZUL",
    name: "Cubo",
    priceCents: 1500,
  })
  assert.throws(() => parseProduct({ sku: "CUBO", name: "Cubo", priceCents: -1 }), ValidationError)
  assert.throws(() => parseProduct({ sku: "CUBO", name: "Cubo", priceCents: 15.5 }), ValidationError)
  assert.throws(() => parseProduct({ sku: "CUBO", name: "Cubo", priceCents: 1, id: "x" }), ValidationError)
})

test("PATCH não permite alterar id nem SKU", () => {
  assert.throws(() => parseProductPatch({ id: "outro" }), ValidationError)
  assert.throws(() => parseProductPatch({ sku: "OUTRO" }), ValidationError)
  assert.throws(() => parseProductPatch({}), ValidationError)
  assert.deepEqual(parseProductPatch({ name: "Novo", active: false }), { name: "Novo", active: false })
})

test("idempotência: mesmo conteúdo com chaves em outra ordem gera o mesmo hash", () => {
  assert.equal(requestHash({ a: 1, b: [{ y: 2, x: 1 }] }), requestHash({ b: [{ x: 1, y: 2 }], a: 1 }))
  assert.notEqual(requestHash({ a: 1 }), requestHash({ a: 2 }))
  assert.equal(canonicalJson({ b: 1, a: null }), '{"a":null,"b":1}')
})

test("validação: campos extras, gramas e paginação", () => {
  assert.throws(() => allowOnly({ a: 1, b: 2 }, ["a"]), ValidationError)
  assert.equal(parseGrams("12.5", "g"), "12.5")
  assert.throws(() => parseGrams("1.2345", "g"), ValidationError)
  assert.throws(() => parseGrams("-1", "g"), ValidationError)
  assert.deepEqual(parsePagination({ page: "2", pageSize: "10" }), { page: 2, pageSize: 10, offset: 10 })
  assert.throws(() => parsePagination({ pageSize: "1000" }), ValidationError)
  assert.equal(likePattern("50%_x"), "%50\\%\\_x%")
})

test("booleano de query aceita só true/false", () => {
  assert.equal(queryBoolean({ active: "true" }, "active"), true)
  assert.equal(queryBoolean({ active: "false" }, "active"), false)
  assert.equal(queryBoolean({}, "active"), undefined)
  assert.throws(() => queryBoolean({ active: "1" }, "active"), ValidationError)
})
