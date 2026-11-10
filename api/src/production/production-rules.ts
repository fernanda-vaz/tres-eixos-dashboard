import { gramsToMilli } from "../grams.js"

export const JOB_STATUSES = ["queued", "printing", "on_hold", "done", "cancelled"] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export const OPEN_JOB_STATUSES: readonly JobStatus[] = ["queued", "printing", "on_hold"]

export type QueueEntry = {
  id: string
  priority: number
  shipBy: Date | null
  orderedAt: Date | null
  createdAt: Date
}

/**
 * Ordem padrão da fila: prioridade ajustada manualmente; depois prazo de envio mais próximo
 * (sem prazo vai depois dos que têm prazo); depois data do pedido; por fim criação e id.
 * Espelha o ORDER BY da consulta, para poder ser testada sem banco.
 */
export function compareQueue(a: QueueEntry, b: QueueEntry): number {
  if (a.priority !== b.priority) return b.priority - a.priority
  const shipA = a.shipBy?.getTime() ?? Number.POSITIVE_INFINITY
  const shipB = b.shipBy?.getTime() ?? Number.POSITIVE_INFINITY
  if (shipA !== shipB) return shipA - shipB
  const orderedA = a.orderedAt?.getTime() ?? Number.POSITIVE_INFINITY
  const orderedB = b.orderedAt?.getTime() ?? Number.POSITIVE_INFINITY
  if (orderedA !== orderedB) return orderedA - orderedB
  if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime()
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export type MaterialNeed = {
  materialId: string
  name: string
  color: string
  requiredGrams: string
  availableGrams: string
}

/** Materiais (cores) cujo saldo livre não cobre o job: aparecem como bloqueio na fila. */
export function blockingMaterials(needs: MaterialNeed[]): MaterialNeed[] {
  return needs.filter((need) => gramsToMilli(need.availableGrams) < gramsToMilli(need.requiredGrams))
}

// Reexportado para quem compara gramas no contexto da produção; a implementação é compartilhada (grams.ts).
export { gramsToMilli }
