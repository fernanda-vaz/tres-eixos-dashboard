import { randomUUID } from "node:crypto"
import { pool, withTransaction, type Queryable, type Tx } from "../db.js"
import { ConflictError, NotFoundError, ValidationError } from "../http/errors.js"
import { isUuid } from "../http/validation.js"
import { applyInventoryDelta, lockInventory, recordMovement } from "../inventory/inventory-repository.js"
import {
  consumeMaterialGrams,
  insertConsumptionMovement,
  lockRecipeRequirements,
  releaseMaterialGrams,
  reserveMaterialGrams,
} from "../inventory/material-repository.js"
import { notifyStockIncreased } from "../inventory/stock-events.js"
import { enqueueOutbox } from "../outbox/enqueue.js"
import { toPage, type Page, type PageRequest } from "../pagination.js"
import { pgErrorCode } from "../pg-errors.js"
import type { HeldJobDecision, PriorityChange, StockJobInput } from "./production-input.js"
import {
  deleteJobMaterials,
  findJob,
  insertJobHistory,
  insertJobMaterial,
  insertStockJob,
  listJobs,
  lockJob,
  lockJobMaterials,
  updateJobPriority,
  updateJobStatus,
  type JobFilter,
  type LockedJob,
  type ProductionJob,
  type StatusEffect,
} from "./production-repository.js"
import type { JobStatus } from "./production-rules.js"

const JOB_NOT_FOUND = "Job de produção não encontrado"

/** Fila de produção com filtros por estado, cor e prazo. */
export async function getJobs(filter: JobFilter, page: PageRequest): Promise<Page<ProductionJob>> {
  return toPage(page, await listJobs(pool, filter, page))
}

// ID inválido responde 404: para quem consulta, é um job que não existe.
export function getJob(id: string): Promise<ProductionJob> {
  if (!isUuid(id)) throw new NotFoundError(JOB_NOT_FOUND)
  return loadJob(pool, id)
}

async function loadJob(db: Queryable, id: string): Promise<ProductionJob> {
  const job = await findJob(db, id)
  if (!job) throw new NotFoundError(JOB_NOT_FOUND)
  return job
}

async function lockExistingJob(tx: Tx, id: string): Promise<LockedJob> {
  const job = await lockJob(tx, id)
  if (!job) throw new NotFoundError(JOB_NOT_FOUND)
  return job
}

async function transition(tx: Tx, job: LockedJob, to: JobStatus, reason: string, effect?: StatusEffect): Promise<void> {
  await updateJobStatus(tx, job.id, to, effect)
  await insertJobHistory(tx, { jobId: job.id, from: job.status, to, reason })
}

/** Produção para estoque (sem pedido), por exemplo para repor itens de giro. */
export function createStockJob(input: StockJobInput): Promise<ProductionJob> {
  return withTransaction(async (tx) => {
    const id = randomUUID()
    try {
      await insertStockJob(tx, { id, ...input })
    } catch (error) {
      if (pgErrorCode(error) === "23503") throw new NotFoundError("Produto não encontrado")
      throw error
    }
    await insertJobHistory(tx, { jobId: id, from: null, to: "queued", reason: "Produção para estoque" })
    return loadJob(tx, id)
  })
}

/**
 * Inicia a impressão: reserva o filamento estimado pela receita. Se faltar alguma cor, recusa
 * com a lista de materiais insuficientes. Ordem de locks: job → materiais (por id).
 */
export function startJob(jobId: string): Promise<ProductionJob> {
  return withTransaction(async (tx) => {
    const job = await lockExistingJob(tx, jobId)
    if (job.status === "printing") return loadJob(tx, jobId)
    if (job.status !== "queued") throw new ConflictError("Só jobs na fila podem iniciar", { status: job.status })
    await reserveJobMaterials(tx, job)
    await transition(tx, job, "printing", "Impressão iniciada", "start")
    return loadJob(tx, jobId)
  })
}

async function reserveJobMaterials(tx: Tx, job: LockedJob): Promise<void> {
  const requirements = await lockRecipeRequirements(tx, job.productId, job.quantity)
  const missing = requirements.filter((requirement) => !requirement.enough)
  if (missing.length) {
    throw new ConflictError("Filamento insuficiente para iniciar a impressão", {
      materials: missing.map(({ materialId, name, color, requiredGrams, availableGrams }) => ({
        materialId,
        name,
        color,
        requiredGrams,
        availableGrams,
      })),
    })
  }
  for (const requirement of requirements) {
    await reserveMaterialGrams(tx, requirement.materialId, requirement.requiredGrams)
    await insertJobMaterial(tx, job.id, requirement.materialId, requirement.requiredGrams)
  }
}

/** Devolve o filamento reservado por um job que não vai mais consumi-lo. */
async function releaseJobMaterials(tx: Tx, jobId: string): Promise<void> {
  for (const reserved of await lockJobMaterials(tx, jobId)) {
    await releaseMaterialGrams(tx, reserved.materialId, reserved.reservedGrams)
  }
  await deleteJobMaterials(tx, jobId)
}

/**
 * Conclui a produção: aumenta physical (peças prontas), registra o consumo de filamento
 * (estimado pela receita e real informado, separados) e repassa as peças a pedidos em espera.
 * Produzir NÃO marca nenhum pedido como enviado. Concluir de novo não altera nada.
 */
export function completeJob(jobId: string, actualGrams: Map<string, string>): Promise<ProductionJob> {
  return withTransaction(async (tx) => {
    const job = await lockExistingJob(tx, jobId)
    if (job.status === "done") return loadJob(tx, jobId)
    if (job.status !== "printing") {
      throw new ConflictError("Só jobs em impressão podem ser concluídos", { status: job.status })
    }

    // Ordem de locks: job → estoque → materiais → pedidos (SKIP LOCKED na alocação).
    await addProducedPieces(tx, job)
    await consumeJobMaterials(tx, jobId, actualGrams)
    await transition(tx, job, "done", "Produção concluída", "complete")
    await enqueueOutbox(tx, "production.completed", jobId, { productId: job.productId, quantity: job.quantity })
    // Peças prontas entraram: o fulfillment (registrado em app.ts) reserva para os pedidos em espera.
    await notifyStockIncreased(tx, job.productId)
    return loadJob(tx, jobId)
  })
}

async function addProducedPieces(tx: Tx, job: LockedJob): Promise<void> {
  await lockInventory(tx, [job.productId])
  const recorded = await recordMovement(tx, {
    productId: job.productId,
    kind: "production",
    physicalDelta: job.quantity,
    reservedDelta: 0,
    reason: "Produção concluída",
    operationKey: `produce:${job.id}`,
  })
  if (recorded) await applyInventoryDelta(tx, job.productId, job.quantity, 0)
}

/** Baixa o filamento: o consumo real informado substitui a estimativa reservada, material a material. */
async function consumeJobMaterials(tx: Tx, jobId: string, actualGrams: Map<string, string>): Promise<void> {
  const reserved = await lockJobMaterials(tx, jobId)
  const unknown = [...actualGrams.keys()].filter((materialId) => !reserved.some((row) => row.materialId === materialId))
  if (unknown.length) throw new ValidationError("actualGrams contém material fora da receita do job", { unknown })

  for (const { materialId, reservedGrams } of reserved) {
    const consumedGrams = actualGrams.get(materialId) ?? reservedGrams
    if (!(await consumeMaterialGrams(tx, materialId, reservedGrams, consumedGrams))) {
      throw new ConflictError("Consumo real maior que o filamento registrado; ajuste o estoque do material", {
        materialId,
      })
    }
    await insertConsumptionMovement(tx, { materialId, consumedGrams, estimatedGrams: reservedGrams, jobId })
  }
}

export function cancelJob(jobId: string, reason: string): Promise<ProductionJob> {
  return withTransaction(async (tx) => {
    const job = await lockExistingJob(tx, jobId)
    if (job.status === "cancelled") return loadJob(tx, jobId)
    if (job.status === "done") throw new ConflictError("Job concluído não pode ser cancelado")
    await releaseJobMaterials(tx, jobId)
    await transition(tx, job, "cancelled", reason)
    return loadJob(tx, jobId)
  })
}

/**
 * Decisão explícita sobre um job em espera porque o pedido foi cancelado:
 * cancelar o job ou concluí-lo para estoque (as peças não ficam reservadas a ninguém).
 */
export function decideHeldJob(jobId: string, decision: HeldJobDecision): Promise<ProductionJob> {
  return withTransaction(async (tx) => {
    const job = await lockExistingJob(tx, jobId)
    if (job.status !== "on_hold") throw new ConflictError("Só jobs em espera precisam de decisão", { status: job.status })
    if (decision.action === "cancel") {
      await releaseJobMaterials(tx, jobId)
      await transition(tx, job, "cancelled", decision.reason)
    } else {
      const resumeTo: JobStatus = job.startedAt ? "printing" : "queued"
      await transition(tx, job, resumeTo, `Continuar para estoque: ${decision.reason}`, "resumeForStock")
    }
    return loadJob(tx, jobId)
  })
}

/** Ajuste manual de prioridade, sempre com motivo registrado. */
export function setPriority(jobId: string, change: PriorityChange): Promise<ProductionJob> {
  return withTransaction(async (tx) => {
    const job = await lockExistingJob(tx, jobId)
    if (job.status === "done" || job.status === "cancelled") {
      throw new ConflictError("Job encerrado não tem prioridade ajustável")
    }
    await updateJobPriority(tx, jobId, change.priority, change.reason)
    await insertJobHistory(tx, {
      jobId,
      from: job.status,
      to: job.status,
      reason: `Prioridade ${change.priority}: ${change.reason}`,
    })
    return loadJob(tx, jobId)
  })
}
