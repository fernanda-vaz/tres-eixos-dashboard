import { inventoryApi, materialsApi, ordersApi, productionApi } from '../../api/endpoints.ts'
import type { OrderStatus } from '../../api/types.ts'
import { useResource } from '../../hooks/useResource.ts'
import { OPEN_ORDER_STATUSES, type StatusTotals } from './dashboard-metrics.ts'

const ALL_STATUSES: OrderStatus[] = [...OPEN_ORDER_STATUSES, 'shipped', 'cancelled']

async function loadStatusTotals(): Promise<StatusTotals> {
  const pages = await Promise.all(ALL_STATUSES.map((status) => ordersApi.list({ status, pageSize: 1 })))
  return Object.fromEntries(ALL_STATUSES.map((status, index) => [status, pages[index].total])) as StatusTotals
}

async function loadOpenOrders() {
  const pages = await Promise.all(OPEN_ORDER_STATUSES.map((status) => ordersApi.list({ status, pageSize: 20 })))
  return pages.flatMap((page) => page.items)
}

async function loadDashboard() {
  const [totals, openOrders, overdue, jobs, inventory, materials] = await Promise.all([
    loadStatusTotals(),
    loadOpenOrders(),
    // Contagem feita pela API (não limitada à primeira página de cada status).
    ordersApi.list({ overdue: true, pageSize: 1 }),
    productionApi.list({ pageSize: 100 }),
    inventoryApi.list({ pageSize: 100 }),
    materialsApi.list({ pageSize: 100 }),
  ])
  return { totals, openOrders, overdueCount: overdue.total, jobs: jobs.items, inventory: inventory.items, materials: materials.items }
}

export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>

/** Todos os dados da visão geral em uma carga só. */
export function useDashboard() {
  return useResource(loadDashboard, 'dashboard')
}
