import { execFileSync } from "node:child_process"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import pg from "pg"

export const PASSWORD = "senha-de-teste-123"
export const EMAIL = "dona@tres-eixos.test"

/** Nunca roda contra o banco de desenvolvimento ou da loja: o schema inteiro é recriado. */
function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error("Defina TEST_DATABASE_URL (veja .env.example) para os testes de integração")
  const name = new URL(url).pathname.slice(1)
  if (!name.endsWith("_test")) throw new Error("TEST_DATABASE_URL precisa apontar para um banco terminado em _test")
  return url
}

async function ensureDatabase(url: string): Promise<void> {
  const admin = new URL(url)
  const name = admin.pathname.slice(1)
  admin.pathname = "/postgres"
  const client = new pg.Client({ connectionString: admin.toString() })
  await client.connect()
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])
    if (!exists.rowCount) await client.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`)
  } finally {
    await client.end()
  }
}

export type TestEnv = { base: string; server: Server; pool: pg.Pool; close: () => Promise<void> }

export async function startTestEnv(): Promise<TestEnv> {
  const url = testDatabaseUrl()
  await ensureDatabase(url)
  const reset = new pg.Client({ connectionString: url })
  await reset.connect()
  await reset.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
  await reset.end()
  // Usa o executor de migrations do próprio projeto.
  execFileSync(process.execPath, ["src/scripts/migrate.mjs"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  })

  process.env.DATABASE_URL = url
  process.env.NODE_ENV = "test"
  process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-32-caracteres"
  const { app } = await import("../../src/app.js")
  const { pool } = await import("../../src/db.js")
  const { sessionStore } = await import("../../src/security/session.js")
  const { hashPassword } = await import("../../src/security/password.js")
  await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES (gen_random_uuid(), $1, 'Dona', $2)", [
    EMAIL,
    await hashPassword(PASSWORD),
  ])

  const server = app.listen(0, "127.0.0.1")
  await new Promise((resolve) => server.once("listening", resolve))
  const { port } = server.address() as AddressInfo
  return {
    base: `http://127.0.0.1:${port}`,
    server,
    pool,
    close: async () => {
      await new Promise((resolve) => server.close(resolve))
      sessionStore.close()
      await pool.end()
    },
  }
}

export type Response = { status: number; body: any; headers: Headers }

/** Cliente como o painel: guarda o cookie de sessão e envia X-CSRF-Token nas escritas. */
export class Client {
  cookie?: string
  csrf?: string

  constructor(private readonly base: string) {}

  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const finalHeaders: Record<string, string> = { ...headers }
    if (body !== undefined) finalHeaders["content-type"] = "application/json"
    if (this.cookie) finalHeaders.cookie = this.cookie
    if (this.csrf) finalHeaders["x-csrf-token"] = this.csrf
    const response = await fetch(this.base + path, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const setCookie = response.headers.getSetCookie()[0]
    if (setCookie) this.cookie = setCookie.split(";")[0]
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers }
  }

  get = (path: string) => this.request("GET", path)
  post = (path: string, body?: unknown, headers?: Record<string, string>) => this.request("POST", path, body, headers)
  put = (path: string, body?: unknown) => this.request("PUT", path, body)
  patch = (path: string, body?: unknown) => this.request("PATCH", path, body)

  async login(email = EMAIL, password = PASSWORD): Promise<Response> {
    const csrf = await this.get("/auth/csrf")
    this.csrf = csrf.body.csrfToken
    const response = await this.post("/auth/login", { email, password })
    if (response.status === 200) this.csrf = response.body.csrfToken
    return response
  }
}

export async function loggedClient(env: TestEnv): Promise<Client> {
  const client = new Client(env.base)
  const response = await client.login()
  if (response.status !== 200) throw new Error(`Login falhou: ${JSON.stringify(response.body)}`)
  return client
}

let sequence = 0
export function uniqueSku(prefix = "SKU"): string {
  sequence += 1
  return `${prefix}-${process.pid}-${sequence}`
}

/** Cria produto e, se pedido, dá entrada de peças prontas. */
export async function productWithStock(client: Client, stock: number, priceCents = 1500): Promise<{ id: string; sku: string }> {
  const sku = uniqueSku()
  const product = await client.post("/products", { sku, name: `Produto ${sku}`, priceCents })
  if (product.status !== 201) throw new Error(JSON.stringify(product.body))
  if (stock > 0) {
    const adjust = await client.post("/inventory/adjustments", { productId: product.body.id, delta: stock, reason: "Saldo inicial" })
    if (adjust.status !== 201) throw new Error(JSON.stringify(adjust.body))
  }
  return { id: product.body.id, sku }
}

export async function inventoryOf(client: Client, productId: string): Promise<{ physical: number; reserved: number; available: number }> {
  return (await client.get(`/inventory/${productId}`)).body
}

let keySequence = 0
export function idempotencyKey(): string {
  keySequence += 1
  return `test-key-${process.pid}-${keySequence}`
}

export async function createOrder(
  client: Client,
  items: { sku: string; quantity: number }[],
  extra: Record<string, unknown> = {},
): Promise<Response> {
  return client.post("/orders", { items, ...extra }, { "Idempotency-Key": idempotencyKey() })
}
