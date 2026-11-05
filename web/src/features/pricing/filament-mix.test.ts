import assert from 'node:assert/strict'
import test from 'node:test'
import type { Material } from '../../api/types.ts'
import { availableFilaments, summarizeMix } from './filament-mix.ts'

const line = (materialId: string, grams: string, costCents: number) =>
  ({ materialId, name: 'PLA', color: materialId, grams, costPerKgCents: 0, costCents })

test('mistura de cores: total e participação de cada cor no peso', () => {
  const summary = summarizeMix([line('Branco', '30.000', 270), line('Dourado', '10.000', 210)])
  assert.equal(summary.totalGrams, 40)
  assert.equal(summary.totalCostCents, 480)
  assert.deepEqual(summary.shares.map((s) => s.percent), [75, 25])
  assert.deepEqual(summarizeMix([]).shares, [])
})

test('só oferece filamentos ativos que ainda não estão na peça', () => {
  const material = (id: string, active = true) => ({ id, active }) as Material
  const options = availableFilaments([material('Branco'), material('Dourado'), material('Velho', false)], [line('Branco', '1', 0)])
  assert.deepEqual(options.map((m) => m.id), ['Dourado'])
})
