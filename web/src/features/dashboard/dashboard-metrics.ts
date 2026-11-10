import type { InventoryItem, Material, OrderStatus } from '@tres-eixos/contracts'
import type { BarItem } from '../../components/ui/BarList.tsx'
import type { Segment } from '../../components/ui/DonutChart.tsx'
import { daysUntil, formatDayMonth, formatGrams } from '../../lib/format.ts'
import { ORDER_STATUS } from '../../lib/labels.ts'

// Derivações puras dos dados do dashboard: sem React e sem rede, fáceis de testar.
// As contagens e as listas "menor saldo" já vêm prontas da API; aqui só se dá forma visual.

export const OPEN_ORDER_STATUSES: OrderStatus[] = ['pending_mapping', 'awaiting_stock', 'reserved', 'ready']

export type StatusTotals = Record<OrderStatus, number>

export function orderSegments(totals: StatusTotals): Segment[] {
  return OPEN_ORDER_STATUSES.map((status) => ({
    label: ORDER_STATUS[status].label,
    value: totals[status],
    tone: ORDER_STATUS[status].tone,
  }))
}

export function openOrdersCount(totals: StatusTotals): number {
  return OPEN_ORDER_STATUSES.reduce((sum, status) => sum + totals[status], 0)
}

/** Barras de peças livres (a API já manda os produtos ativos com menor saldo primeiro). */
export function lowStockBars(items: InventoryItem[]): BarItem[] {
  const active = items.filter((item) => item.active)
  const max = Math.max(1, ...active.map((item) => item.physical))
  return active.map((item) => ({
    key: item.productId,
    label: item.sku,
    detail: `${item.available} livres · ${item.reserved} reservadas`,
    value: item.available,
    max,
    tone: item.available === 0 ? 'danger' : item.available <= 2 ? 'warning' : 'success',
  }))
}

export function filamentBars(materials: Material[]): BarItem[] {
  const max = Math.max(1, ...materials.map((material) => Number(material.physicalGrams)))
  return materials.map((material) => ({
    key: material.id,
    label: `${material.name} ${material.color}`,
    detail: `${formatGrams(material.availableGrams)} livres`,
    value: Number(material.availableGrams),
    max,
    tone: Number(material.availableGrams) < 100 ? 'warning' : 'info',
  }))
}

/** Texto do prazo de envio: "Hoje", "05 de nov. · em 1 d", "Atrasado 2 d" ou "Sem prazo". */
export function deadlineText(shipBy: string | null, now = new Date()): { text: string; overdue: boolean } {
  const days = daysUntil(shipBy, now)
  if (days === null) return { text: 'Sem prazo', overdue: false }
  if (days < 0) return { text: `Atrasado ${-days} d`, overdue: true }
  if (days === 0) return { text: 'Hoje', overdue: false }
  return { text: `${formatDayMonth(shipBy)} · em ${days} d`, overdue: false }
}
