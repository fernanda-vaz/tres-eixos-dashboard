import { createHash } from "node:crypto"
import type { Request } from "express"
import type { Tx } from "../db.js"
import { ConflictError, ValidationError } from "./errors.js"

export type StoredResponse = { status: number; body: unknown }

/** Serializa com chaves ordenadas: o mesmo conteúdo sempre gera o mesmo hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.keys(value as object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
    return `{${entries.join(",")}}`
  }
  return JSON.stringify(value ?? null)
}

export function requestHash(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex")
}

export function readIdempotencyKey(req: Request, { required }: { required: boolean }): string | undefined {
  const key = req.get("Idempotency-Key")
  if (!key) {
    if (required) throw new ValidationError("Cabeçalho Idempotency-Key obrigatório")
    return undefined
  }
  if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(key)) {
    throw new ValidationError("Idempotency-Key deve ter de 8 a 200 caracteres (letras, números, _ . : -)")
  }
  return key
}

/**
 * Executa `work` uma única vez por (scope, key), dentro da transação recebida.
 * - Mesma chave e mesmo conteúdo: devolve a resposta gravada, sem repetir a operação.
 * - Mesma chave e conteúdo diferente: 409.
 * Duas requisições simultâneas com a mesma chave: a segunda espera o INSERT da primeira
 * (restrição de chave primária) e, após o COMMIT, recebe a resposta gravada.
 * Se `work` falhar, a transação inteira é desfeita, inclusive a chave: pode-se tentar de novo.
 */
export async function runIdempotent(
  tx: Tx,
  scope: string,
  key: string,
  body: unknown,
  work: () => Promise<StoredResponse>,
): Promise<StoredResponse & { replayed: boolean }> {
  const hash = requestHash(body)
  const inserted = await tx.query(
    `INSERT INTO idempotency_keys (scope, key, request_hash) VALUES ($1, $2, $3)
     ON CONFLICT (scope, key) DO NOTHING`,
    [scope, key, hash],
  )
  if (inserted.rowCount === 0) {
    const stored = await tx.query<{ request_hash: string; response_status: number; response_body: unknown }>(
      "SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE scope = $1 AND key = $2",
      [scope, key],
    )
    const row = stored.rows[0]
    if (row.request_hash !== hash) {
      throw new ConflictError("Idempotency-Key já usada com outro conteúdo")
    }
    return { status: row.response_status, body: row.response_body, replayed: true }
  }
  const response = await work()
  await tx.query(
    "UPDATE idempotency_keys SET response_status = $3, response_body = $4 WHERE scope = $1 AND key = $2",
    [scope, key, response.status, JSON.stringify(response.body)],
  )
  return { ...response, replayed: false }
}
