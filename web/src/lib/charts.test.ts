import assert from 'node:assert/strict'
import test from 'node:test'
import { donutArcs } from './charts.ts'

test('arcos da rosca somam a circunferência e pulam valores zero', () => {
  const arcs = donutArcs([{ value: 1 }, { value: 0 }, { value: 3 }], 100)
  assert.deepEqual(arcs.map((arc) => [arc.length, arc.offset]), [[25, 0], [75, 25]])
  assert.deepEqual(donutArcs([{ value: 0 }], 100), [])
})
