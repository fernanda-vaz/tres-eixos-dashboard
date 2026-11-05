// Provisionamento da conta da dona da loja (não há cadastro público).
// Uso: npm run user:create -- --email voce@exemplo.com --name "Seu nome"
// A senha é lida da variável NEW_PASSWORD ou digitada sem eco no terminal.
import { randomUUID } from "node:crypto"
import readline from "node:readline"
import { parseArgs } from "node:util"
import { pool } from "../db.js"
import { pgErrorCode } from "../pg-errors.js"
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../security/password.js"

function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error("Terminal não interativo: informe a senha em NEW_PASSWORD")
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  const output = rl as unknown as { _writeToOutput: (text: string) => void; output: NodeJS.WritableStream }
  let muted = false
  output._writeToOutput = (text) => {
    if (!muted) output.output.write(text)
  }
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write("\n")
      resolve(answer)
    })
    muted = true
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
  await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)", [
    randomUUID(),
    email,
    name,
    await hashPassword(password),
  ])
  console.log(`Usuária criada: ${email}`)
} catch (error) {
  process.exitCode = 1
  console.error(pgErrorCode(error) === "23505" ? "E-mail já cadastrado" : error instanceof Error ? error.message : error)
} finally {
  await pool.end()
}
