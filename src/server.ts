import { app, markShuttingDown } from "./app.js"
import { pool } from "./db.js"
import { sessionStore } from "./security/session.js"

const port = Number(process.env.PORT ?? "3000")

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT deve ser uma porta válida")
}

const server = app.listen(port, "0.0.0.0", () => {
  console.log("Projeto Três Eixos Dashboard || Servidor ouvindo na porta", port)
})

let shuttingDown = false

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  markShuttingDown()
  console.log(`Sinal ${signal} recebido; iniciando encerramento gracioso`)

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    sessionStore.close()
    await pool.end()
    console.log("Servidor encerrado com sucesso")
    process.exitCode = 0
  } catch (error) {
    console.error("Falha durante o encerramento", error)
    process.exitCode = 1
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}
