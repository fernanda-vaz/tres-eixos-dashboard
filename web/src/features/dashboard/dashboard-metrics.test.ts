import assert from 'node:assert/strict'
import test from 'node:test'
import type { OrderSummary } from '../../api/types.ts'
import { deadlineText, lowStockBars, openOrdersCount, upcomingShipments } from './dashboard-metrics.ts'

const order = (id: string, shipBy: string | null): OrderSummary => ({
  id, shipBy, channelProvider: 'manual', externalOrderId: id, status: 'reserved',
  externalStatus: null, orderedAt: '2026-11-01T00:00:00Z', itemCount: 1, totalCents: 100,
})
const now = new Date('2026-11-04T12:00:00Z')

test('próximos envios: prazo mais próximo primeiro, sem prazo por último', () => {
  const sorted = upcomingShipments([order('sem', null), order('tarde', '2026-11-10T00:00:00Z'), order('cedo', '2026-11-05T00:00:00Z')])
  assert.deepEqual(sorted.map((o) => o.id), ['cedo', 'tarde', 'sem'])
})

test('texto do prazo', () => {
  assert.deepEqual(deadlineText('2026-11-02T12:00:00Z', now), { text: 'Atrasado 2 d', overdue: true })
  assert.deepEqual(deadlineText(null, now), { text: 'Sem prazo', overdue: false })
})

test('em aberto soma só os status abertos; estoque baixo ignora inativos', () => {
  const totals = { pending_mapping: 1, awaiting_stock: 2, reserved: 3, ready: 4, shipped: 50, cancelled: 9 }
  assert.equal(openOrdersCount(totals), 10)
  const bars = lowStockBars([
    { productId: '1', sku: 'A', name: 'A', active: true, physical: 5, reserved: 0, available: 5, openProduction: 0 },
    { productId: '2', sku: 'B', name: 'B', active: true, physical: 1, reserved: 1, available: 0, openProduction: 0 },
    { productId: '3', sku: 'C', name: 'C', active: false, physical: 0, reserved: 0, available: 0, openProduction: 0 },
  ])
  assert.deepEqual(bars.map((bar) => [bar.label, bar.tone]), [['B', 'danger'], ['A', 'success']])
})
