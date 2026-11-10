import { app, markShuttingDown } from "./app.js"
import { pool } from "./db.js"
import { logger } from "./logger.js"
import { sessionStore } from "./security/session.js"

const port = Number(process.env.PORT ?? "3000")

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT deve ser uma porta válida")
}

const server = app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Projeto Três Eixos Dashboard || Servidor ouvindo")
})
// Uma conexão lenta ou travada não segura um slot do pool (nem um lock) indefinidamente:
// cabeçalhos em até 10 s, requisição inteira em até 30 s.
server.headersTimeout = 10_000
server.requestTimeout = 30_000

let shuttingDown = false

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  markShuttingDown()
  logger.info({ signal }, "Sinal recebido; iniciando encerramento gracioso")

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    sessionStore.close()
    await pool.end()
    logger.info("Servidor encerrado com sucesso")
    process.exitCode = 0
  } catch (error) {
    logger.error({ err: error }, "Falha durante o encerramento")
    process.exitCode = 1
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}
