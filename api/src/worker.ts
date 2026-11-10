// Processo separado da API: publica os eventos gravados no outbox e cuida da retenção.
// Uso local: npm run worker   |   Compose: serviço "worker".
import { utimes, writeFile } from "node:fs/promises"
import { pool } from "./db.js"
import { logger } from "./logger.js"
import { LogPublisher, outboxStats, runWorker, WebhookPublisher, type BatchResult, type OutboxPublisher } from "./outbox/worker.js"
import { runRetention } from "./retention.js"

const publisher: OutboxPublisher = process.env.OUTBOX_WEBHOOK_URL
  ? new WebhookPublisher(process.env.OUTBOX_WEBHOOK_URL, process.env.OUTBOX_WEBHOOK_SECRET || undefined)
  : new LogPublisher()

// Arquivo tocado a cada volta do laço: o healthcheck do Compose confere a idade dele.
const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? "/tmp/tres-eixos-worker-heartbeat"
const HEARTBEAT_EVERY_MS = 5_000
const STATS_EVERY_MS = 60_000
const RETENTION_EVERY_MS = 60 * 60_000

let stopping = false
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    logger.info({ signal }, "Sinal recebido; o worker termina o lote atual e encerra")
  })
}

let lastHeartbeat = 0
let lastStats = Date.now()
let lastRetention = 0
const sinceLastStats: BatchResult = { published: 0, failed: 0, dead: 0 }

async function heartbeat(): Promise<void> {
  const now = Date.now()
  if (now - lastHeartbeat < HEARTBEAT_EVERY_MS) return
  lastHeartbeat = now
  try {
    await utimes(HEARTBEAT_FILE, new Date(), new Date())
  } catch {
    await writeFile(HEARTBEAT_FILE, "")
  }
}

/** A cada minuto: fila, idade do evento mais antigo e eventos mortos; alerta quando a fila envelhece. */
async function reportStats(): Promise<void> {
  const now = Date.now()
  if (now - lastStats < STATS_EVERY_MS) return
  lastStats = now
  const stats = await outboxStats(pool)
  const level = stats.dead > 0 || (stats.oldestPendingAgeSeconds ?? 0) > 3600 ? "warn" : "info"
  logger[level]({ ...stats, ...sinceLastStats }, "outbox stats")
  sinceLastStats.published = sinceLastStats.failed = sinceLastStats.dead = 0
}

async function retention(): Promise<void> {
  const now = Date.now()
  if (now - lastRetention < RETENTION_EVERY_MS) return
  lastRetention = now
  logger.info(await runRetention(pool), "retenção executada")
}

async function onTick(result: BatchResult): Promise<void> {
  sinceLastStats.published += result.published
  sinceLastStats.failed += result.failed
  sinceLastStats.dead += result.dead
  await heartbeat()
  await reportStats()
  await retention()
}

logger.info({ publisher: process.env.OUTBOX_WEBHOOK_URL ? "webhook" : "log", signed: Boolean(process.env.OUTBOX_WEBHOOK_SECRET) }, "Worker do outbox iniciado")
try {
  await runWorker(publisher, () => stopping, { onTick })
} finally {
  await pool.end()
  logger.info("Worker encerrado")
}
