import { randomUUID } from "node:crypto"
import { queryPage, type Queryable, type Tx } from "../db.js"
import type { PageRequest } from "../pagination.js"
import { likePattern } from "../sql.js"
import { blockingMaterials, type JobStatus, type MaterialNeed } from "./production-rules.js"

export type JobPurpose = "order" | "stock"

export type ProductionJob = {
  id: string
  status: JobStatus
  purpose: JobPurpose
  quantity: number
  priority: number
  priorityReason: string | null
  holdReason: string | null
  estimatedMinutes: number | null
  product: { id: string; sku: string; name: string }
  order: { id: string; externalOrderId: string; status: string; shipBy: Date | null; orderedAt: Date } | null
  materials: MaterialNeed[]
  /** Cores/materiais sem saldo suficiente para iniciar este job. */
  blockedBy: MaterialNeed[]
  createdAt: Date
  startedAt: Date | null
  completedAt: Date | null
}

type JobRow = {
  id: string
  status: JobStatus
  purpose: JobPurpose
  quantity: number
  priority: number
  priority_reason: string | null
  hold_reason: string | null
  estimated_minutes: number | null
  product_id: string
  sku: string
  product_name: string
  order_id: string | null
  external_order_id: string | null
  order_status: string | null
  ship_by: Date | null
  ordered_at: Date | null
  materials: MaterialNeed[] | null
  created_at: Date
  started_at: Date | null
  completed_at: Date | null
}

const SELECT_JOBS = `
  SELECT j.id, j.status, j.purpose, j.quantity, j.priority, j.priority_reason, j.hold_reason, j.estimated_minutes,
         p.id AS product_id, p.sku, p.name AS product_name,
         o.id AS order_id, o.external_order_id, o.status AS order_status, o.ship_by, o.ordered_at,
         (SELECT json_agg(json_build_object(
                   'materialId', m.id, 'name', m.name, 'color', m.color,
                   'requiredGrams', ((pm.grams_per_unit * j.quantity)::numeric(12,3))::text,
                   'availableGrams', ((m.physical_grams - m.reserved_grams)::numeric(12,3))::text)
                 ORDER BY m.name, m.color)
            FROM product_materials pm JOIN materials m ON m.id = pm.material_id
           WHERE pm.product_id = j.product_id) AS materials,
         j.created_at, j.started_at, j.completed_at
  FROM production_jobs j
  JOIN products p ON p.id = j.product_id
  LEFT JOIN order_items oi ON oi.id = j.order_item_id
  LEFT JOIN orders o ON o.id = oi.order_id`

function toJob(row: JobRow): ProductionJob {
  const materials = row.materials ?? []
  return {
    id: row.id,
    status: row.status,
    purpose: row.purpose,
    quantity: row.quantity,
    priority: row.priority,
    priorityReason: row.priority_reason,
    holdReason: row.hold_reason,
    estimatedMinutes: row.estimated_minutes,
    product: { id: row.product_id, sku: row.sku, name: row.product_name },
    order: row.order_id
      ? {
          id: row.order_id,
          externalOrderId: row.external_order_id!,
          status: row.order_status!,
          shipBy: row.ship_by,
          orderedAt: row.ordered_at!,
        }
      : null,
    materials,
    // Só faz sentido bloquear o que ainda não começou: jobs em impressão já reservaram o filamento.
    blockedBy: row.status === "queued" ? blockingMaterials(materials) : [],
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

export type JobFilter = { statuses: readonly JobStatus[]; color: string | null; dueBefore: Date | null }

export async function listJobs(filter: JobFilter, page: PageRequest): Promise<{ items: ProductionJob[]; total: number }> {
  const where = `
    WHERE j.status = ANY($1::text[])
      AND ($2::text IS NULL OR EXISTS (
            SELECT 1 FROM product_materials pm JOIN materials m ON m.id = pm.material_id
             WHERE pm.product_id = j.product_id AND m.color ILIKE $2))
      AND ($3::timestamptz IS NULL OR o.ship_by < $3)`
  const { rows, total } = await queryPage<JobRow>(
    `${SELECT_JOBS} ${where}
     ORDER BY j.priority DESC, o.ship_by ASC NULLS LAST, o.ordered_at ASC NULLS LAST, j.created_at, j.id
     LIMIT $4 OFFSET $5`,
    `SELECT count(*) AS total FROM production_jobs j
     LEFT JOIN order_items oi ON oi.id = j.order_item_id LEFT JOIN orders o ON o.id = oi.order_id ${where}`,
    [filter.statuses, filter.color ? likePattern(filter.color) : null, filter.dueBefore],
    page,
  )
  return { items: rows.map(toJob), total }
}

export async function findJob(db: Queryable, id: string): Promise<ProductionJob | null> {
  const result = await db.query<JobRow>(`${SELECT_JOBS} WHERE j.id = $1`, [id])
  return result.rows[0] ? toJob(result.rows[0]) : null
}

export type LockedJob = {
  id: string
  productId: string
  status: JobStatus
  purpose: JobPurpose
  quantity: number
  startedAt: Date | null
}

export async function lockJob(tx: Tx, id: string): Promise<LockedJob | null> {
  const result = await tx.query<{
    id: string
    product_id: string
    status: JobStatus
    purpose: JobPurpose
    quantity: number
    started_at: Date | null
  }>("SELECT id, product_id, status, purpose, quantity, started_at FROM production_jobs WHERE id = $1 FOR UPDATE", [id])
  const row = result.rows[0]
  return row
    ? {
        id: row.id,
        productId: row.product_id,
        status: row.status,
        purpose: row.purpose,
        quantity: row.quantity,
        startedAt: row.started_at,
      }
    : null
}

export async function insertStockJob(
  tx: Tx,
  job: { id: string; productId: string; quantity: number; estimatedMinutes: number | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO production_jobs (id, product_id, purpose, quantity, status, estimated_minutes)
     VALUES ($1, $2, 'stock', $3, 'queued', $4)`,
    [job.id, job.productId, job.quantity, job.estimatedMinutes],
  )
}

/** No máximo um job aberto por item de pedido: um segundo pedido de produção para o item é ignorado. */
export async function insertOrderJob(
  tx: Tx,
  job: { productId: string; orderItemId: string; quantity: number },
): Promise<void> {
  await tx.query(
    `INSERT INTO production_jobs (id, product_id, order_item_id, purpose, quantity, status)
     VALUES ($1, $2, $3, 'order', $4, 'queued')
     ON CONFLICT (order_item_id) WHERE status IN ('queued', 'printing', 'on_hold') DO NOTHING`,
    [randomUUID(), job.productId, job.orderItemId, job.quantity],
  )
}

// Efeitos de uma mudança de status, além do próprio status. Fragmentos fixos no código.
const STATUS_EFFECTS = {
  none: "",
  start: ", started_at = now()",
  complete: ", completed_at = now()",
  resumeForStock: ", purpose = 'stock', hold_reason = NULL",
} as const

export type StatusEffect = keyof typeof STATUS_EFFECTS

export async function updateJobStatus(tx: Tx, id: string, to: JobStatus, effect: StatusEffect = "none"): Promise<void> {
  await tx.query(`UPDATE production_jobs SET status = $2, updated_at = now() ${STATUS_EFFECTS[effect]} WHERE id = $1`, [
    id,
    to,
  ])
}

export async function holdJob(tx: Tx, id: string, holdReason: string): Promise<void> {
  await tx.query(
    `UPDATE production_jobs
     SET status = 'on_hold', hold_reason = $2,
         updated_at = now()
     WHERE id = $1`,
    [id, holdReason],
  )
}

export async function updateJobPriority(tx: Tx, id: string, priority: number, reason: string): Promise<void> {
  await tx.query("UPDATE production_jobs SET priority = $2, priority_reason = $3, updated_at = now() WHERE id = $1", [
    id,
    priority,
    reason,
  ])
}

export async function insertJobHistory(
  tx: Tx,
  entry: { jobId: string; from: JobStatus | null; to: JobStatus; reason: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO production_job_history (id, job_id, from_status, to_status, reason) VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), entry.jobId, entry.from, entry.to, entry.reason],
  )
}

/** Cancela os jobs ainda não iniciados de um item de pedido. Retorna os ids cancelados. */
export async function cancelQueuedJobsForItem(tx: Tx, orderItemId: string): Promise<string[]> {
  const result = await tx.query<{ id: string }>(
    `UPDATE production_jobs SET status = 'cancelled', updated_at = now()
     WHERE order_item_id = $1 AND status = 'queued'
     RETURNING id`,
    [orderItemId],
  )
  return result.rows.map((row) => row.id)
}

/** Bloqueia, em ordem de id, os jobs na fila ou em impressão ligados a um pedido. */
export async function lockOpenJobsForOrder(tx: Tx, orderId: string): Promise<{ id: string; status: JobStatus }[]> {
  const result = await tx.query<{ id: string; status: JobStatus }>(
    `SELECT j.id, j.status FROM production_jobs j JOIN order_items oi ON oi.id = j.order_item_id
     WHERE oi.order_id = $1 AND j.status IN ('queued', 'printing')
     ORDER BY j.id
     FOR UPDATE OF j`,
    [orderId],
  )
  return result.rows
}

export async function insertJobMaterial(tx: Tx, jobId: string, materialId: string, reservedGrams: string): Promise<void> {
  await tx.query("INSERT INTO production_job_materials (job_id, material_id, reserved_grams) VALUES ($1, $2, $3)", [
    jobId,
    materialId,
    reservedGrams,
  ])
}

/** Filamento reservado pelo job, com os materiais bloqueados em ordem de id. */
export async function lockJobMaterials(tx: Tx, jobId: string): Promise<{ materialId: string; reservedGrams: string }[]> {
  const result = await tx.query<{ material_id: string; reserved_grams: string }>(
    `SELECT jm.material_id, jm.reserved_grams FROM production_job_materials jm
     JOIN materials m ON m.id = jm.material_id
     WHERE jm.job_id = $1 ORDER BY jm.material_id FOR UPDATE OF m`,
    [jobId],
  )
  return result.rows.map((row) => ({ materialId: row.material_id, reservedGrams: row.reserved_grams }))
}

export async function deleteJobMaterials(tx: Tx, jobId: string): Promise<void> {
  await tx.query("DELETE FROM production_job_materials WHERE job_id = $1", [jobId])
}
