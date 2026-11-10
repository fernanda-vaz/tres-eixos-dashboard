import { dashboardApi } from '../../api/endpoints.ts'
import { useResource } from '../../hooks/useResource.ts'

/** Todos os dados da visão geral em uma única requisição (GET /dashboard/summary). */
export function useDashboard() {
  return useResource(dashboardApi.summary, 'dashboard')
}
