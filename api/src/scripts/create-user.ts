// Provisionamento da conta da dona da loja (não há cadastro público).
// Uso: npm run user:create -- --email voce@exemplo.com --name "Seu nome"
// A senha é lida da variável NEW_PASSWORD ou digitada sem eco no terminal.
import { randomUUID } from "node:crypto"
import { parseArgs } from "node:util"
import { pool } from "../db.js"
import { pgErrorCode } from "../pg-errors.js"
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../security/password.js"
import { insertUser } from "../security/user-repository.js"

/** Lê uma linha do terminal em modo raw (sem eco), só com a API pública do Node. */
function askHidden(question: string): Promise<string> {
  const stdin = process.stdin
  if (!stdin.isTTY) throw new Error("Terminal não interativo: informe a senha em NEW_PASSWORD")
  process.stdout.write(question)
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding("utf8")
  let answer = ""
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off("data", onData)
      process.stdout.write("\n")
      error ? reject(error) : resolve(answer)
    }
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") return finish(new Error("Cancelado"))
        if (char === "\r" || char === "\n") return finish()
        if (char === "\u007f" || char === "\b") answer = answer.slice(0, -1)
        else answer += char
      }
    }
    stdin.on("data", onData)
  })
}

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } })
const email = values.email?.trim().toLowerCase()
const name = values.name?.trim()

try {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe --email válido")
  if (!name) throw new Error('Informe --name "Seu nome"')
  const password = process.env.NEW_PASSWORD ?? (await askHidden("Senha: "))
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`A senha deve ter de ${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_LENGTH} caracteres`)
  }
  await insertUser(pool, { id: randomUUID(), email, name, passwordHash: await hashPassword(password) })
  console.log(`Usuária criada: ${email}`)
} catch (error) {
  process.exitCode = 1
  console.error(pgErrorCode(error) === "23505" ? "E-mail já cadastrado" : error instanceof Error ? error.message : error)
} finally {
  await pool.end()
}
