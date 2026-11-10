import { useState } from 'react'
import { productionApi, type HeldJobDecision } from '../../api/endpoints.ts'
import type { JobStatus, ProductionJob } from '@tres-eixos/contracts'
import { useAction } from '../../hooks/useAction.ts'
import { useHashRoute } from '../../hooks/useHashRoute.ts'
import { useResource } from '../../hooks/useResource.ts'
import { pageFromQuery } from '../../lib/hash.ts'
import { JOB_STATUS } from '../../lib/labels.ts'

const PAGE_SIZE = 20

function statusFromQuery(value: string | undefined): JobStatus | '' {
  return value && value in JOB_STATUS ? (value as JobStatus) : ''
}

/** Fila de produção com filtros (situação e cor) no hash da URL e as ações sobre cada job. */
export function useProductionQueue() {
  const { route, navigate } = useHashRoute()
  const status = statusFromQuery(route.query.status)
  const color = route.query.color ?? ''
  const page = pageFromQuery(route.query)
  const jobs = useResource(
    () => productionApi.list({ page, pageSize: PAGE_SIZE, status: status || undefined, color }),
    `${page}|${status}|${color}`,
  )
  const action = useAction()

  const go = (next: { status?: JobStatus | ''; color?: string; page?: number }) =>
    navigate({ path: 'producao', query: { status: next.status ?? status, color: next.color ?? color, page: next.page ?? page } })

  async function perform(work: () => Promise<unknown>, success: string) {
    if (await action.run(work, success)) jobs.reload()
  }

  return {
    jobs, action, status, color,
    setPage: (value: number) => go({ page: value }),
    setStatus: (value: JobStatus | '') => go({ status: value, page: 1 }),
    setColor: (value: string) => go({ color: value.trim(), page: 1 }),
    start: (job: ProductionJob) => perform(() => productionApi.start(job.id), 'Impressão iniciada.'),
    complete: (job: ProductionJob) =>
      perform(() => productionApi.complete(job.id), 'Produção concluída; as peças entraram no estoque.'),
    decide: (job: ProductionJob, decision: HeldJobDecision) =>
      perform(
        () => productionApi.decide(job.id, decision, 'Decidido no painel'),
        decision === 'cancel' ? 'Job cancelado.' : 'Job seguirá para estoque.',
      ),
    setPriority: (job: ProductionJob, priority: number, reason: string) =>
      perform(() => productionApi.setPriority(job.id, priority, reason), 'Prioridade ajustada.'),
  }
}

export type ProductionQueue = ReturnType<typeof useProductionQueue>

/** Estado local do formulário de prioridade de um job. */
export function usePriorityForm(job: ProductionJob, onSubmit: (priority: number, reason: string) => void) {
  const [priority, setPriority] = useState(String(job.priority))
  const [reason, setReason] = useState('')
  const submit = () => onSubmit(Number(priority), reason)
  return { priority, setPriority, reason, setReason, submit }
}
