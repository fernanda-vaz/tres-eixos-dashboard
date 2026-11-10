import assert from 'node:assert/strict'
import test from 'node:test'
import { deadlineText, lowStockBars, openOrdersCount, orderSegments } from './dashboard-metrics.ts'

const now = new Date('2026-11-04T12:00:00Z')

test('texto do prazo', () => {
  assert.deepEqual(deadlineText('2026-11-02T12:00:00Z', now), { text: 'Atrasado 2 d', overdue: true })
  assert.deepEqual(deadlineText('2026-11-04T12:00:00Z', now), { text: 'Hoje', overdue: false })
  assert.deepEqual(deadlineText(null, now), { text: 'Sem prazo', overdue: false })
})

test('em aberto soma só os status abertos; segmentos seguem a mesma ordem', () => {
  const totals = { pending_mapping: 1, awaiting_stock: 2, reserved: 3, ready: 4, shipped: 50, cancelled: 9 }
  assert.equal(openOrdersCount(totals), 10)
  assert.deepEqual(orderSegments(totals).map((segment) => segment.value), [1, 2, 3, 4])
})

test('barras de estoque mantêm a ordem da API, ignoram inativos e colorem pelo saldo', () => {
  const bars = lowStockBars([
    { productId: '2', sku: 'B', name: 'B', active: true, priceCents: 1, physical: 1, reserved: 1, available: 0, openProduction: 0 },
    { productId: '3', sku: 'C', name: 'C', active: false, priceCents: 1, physical: 0, reserved: 0, available: 0, openProduction: 0 },
    { productId: '1', sku: 'A', name: 'A', active: true, priceCents: 1, physical: 5, reserved: 0, available: 5, openProduction: 0 },
  ])
  assert.deepEqual(bars.map((bar) => [bar.label, bar.tone]), [['B', 'danger'], ['A', 'success']])
  assert.equal(bars[1].max, 5)
})
