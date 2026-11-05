import { useState } from 'react'
import { productionApi, type HeldJobDecision } from '../../api/endpoints.ts'
import type { JobStatus, ProductionJob } from '../../api/types.ts'
import { useAction } from '../../hooks/useAction.ts'
import { useResource } from '../../hooks/useResource.ts'

/** Fila de produção com filtros (situação e cor) e as ações sobre cada job. */
export function useProductionQueue() {
  const [page, setPage] = useState(1)
  const [status, setStatusState] = useState<JobStatus | ''>('')
  const [color, setColorState] = useState('')
  const jobs = useResource(
    () => productionApi.list({ page, pageSize: 20, status: status || undefined, color }),
    `${page}|${status}|${color}`,
  )
  const action = useAction()

  const setStatus = (value: JobStatus | '') => { setPage(1); setStatusState(value) }
  const setColor = (value: string) => { setPage(1); setColorState(value.trim()) }

  async function perform(work: () => Promise<unknown>, success: string) {
    if (await action.run(work, success)) jobs.reload()
  }

  return {
    jobs, setPage, status, setStatus, color, setColor, action,
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
