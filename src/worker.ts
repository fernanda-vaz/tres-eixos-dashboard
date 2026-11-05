// Processo separado da API: publica os eventos gravados no outbox.
// Uso local: npm run worker   |   Compose: serviço "worker".
import { pool } from "./db.js"
import { LogPublisher, runWorker, WebhookPublisher, type OutboxPublisher } from "./outbox-worker.js"

const publisher: OutboxPublisher = process.env.OUTBOX_WEBHOOK_URL
  ? new WebhookPublisher(process.env.OUTBOX_WEBHOOK_URL)
  : new LogPublisher()

let stopping = false
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    console.log(`Sinal ${signal} recebido; o worker termina o lote atual e encerra`)
  })
}

console.log(`Worker do outbox iniciado (${process.env.OUTBOX_WEBHOOK_URL ? "webhook" : "log"})`)
try {
  await runWorker(publisher, () => stopping)
} finally {
  await pool.end()
  console.log("Worker encerrado")
}
