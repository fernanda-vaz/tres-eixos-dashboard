import assert from 'node:assert/strict'
import test from 'node:test'
import { localInputToIso, normalizeSku, parseGrams, parseNonZeroInteger, parseReaisToCents } from './parse.ts'

test('reais em texto viram centavos sem ponto flutuante', () => {
  assert.equal(parseReaisToCents('15,90'), 1590)
  assert.equal(parseReaisToCents('15.9'), 1590)
  assert.equal(parseReaisToCents('0,1'), 10)
  assert.equal(parseReaisToCents('1.234,56'), null)
  assert.equal(parseReaisToCents('-1'), null)
})

test('gramas aceitam vírgula e até 3 casas; negativo só quando permitido', () => {
  assert.equal(parseGrams('12,5'), '12.5')
  assert.equal(parseGrams('-12,5'), null)
  assert.equal(parseGrams('-12,5', { allowNegative: true }), '-12.5')
  assert.equal(parseGrams('0'), null)
  assert.equal(parseGrams('1.2345'), null)
})

test('inteiro diferente de zero, SKU e data local', () => {
  assert.equal(parseNonZeroInteger('-2'), -2)
  assert.equal(parseNonZeroInteger('0'), null)
  assert.equal(parseNonZeroInteger('1.5'), null)
  assert.equal(normalizeSku(' cubo-azul '), 'CUBO-AZUL')
  assert.equal(localInputToIso(''), undefined)
  assert.match(localInputToIso('2026-11-10T18:00')!, /^2026-11-1\dT\d\d:00:00.000Z$/)
})
