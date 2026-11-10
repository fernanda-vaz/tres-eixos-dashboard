import { Router } from "express"
import { pool } from "../db.js"
import { NotFoundError } from "../http/errors.js"
import { parseUuid } from "../http/validation.js"
import type { AggregateType } from "./enqueue.js"

export const outboxRouter = Router()

type DeadRow = {
  id: string
  topic: string
  aggregate_type: AggregateType
  aggregate_id: string
  payload: unknown
  attempts: number
  last_error: string | null
  created_at: Date
  dead_at: Date | null
}

/** Evento na dead-letter, como vai para o painel. */
export type DeadEvent = ReturnType<typeof toDeadEvent>

const toDeadEvent = (row: DeadRow) => ({
  id: row.id,
  topic: row.topic,
  aggregateType: row.aggregate_type,
  aggregateId: row.aggregate_id,
  payload: row.payload,
  attempts: row.attempts,
  lastError: row.last_error,
  createdAt: row.created_at,
  deadAt: row.dead_at,
})

const DEAD_COLUMNS = "id, topic, aggregate_type, aggregate_id, payload, attempts, last_error, created_at, dead_at"

/** Eventos que esgotaram as tentativas. Enquanto estiverem aqui, os seguintes do mesmo agregado esperam. */
outboxRouter.get("/outbox/dead", async (_req, res) => {
  const result = await pool.query<DeadRow>(`SELECT ${DEAD_COLUMNS} FROM outbox WHERE dead_at IS NOT NULL ORDER BY dead_at DESC LIMIT 100`)
  res.json(result.rows.map(toDeadEvent))
})

/** Devolve o evento à fila com as tentativas zeradas (depois de corrigir o destino, por exemplo). */
outboxRouter.post("/outbox/:id/retry", async (req, res) => {
  const id = parseUuid(req.params.id, "ID do evento")
  const result = await pool.query<DeadRow>(
    `UPDATE outbox SET dead_at = NULL, attempts = 0, last_error = NULL, next_attempt_at = now()
     WHERE id = $1 AND dead_at IS NOT NULL
     RETURNING ${DEAD_COLUMNS}`,
    [id],
  )
  if (!result.rows[0]) throw new NotFoundError("Evento não está na dead-letter")
  res.json({ ...toDeadEvent(result.rows[0]), deadAt: null })
})
