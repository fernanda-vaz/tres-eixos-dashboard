import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto"

// scrypt da biblioteca padrão do Node: algoritmo de derivação de chave próprio para senhas.
// Parâmetros na faixa recomendada pelo OWASP (N=2^15, r=8, p=3 ≈ 32 MB por hash): memória moderada
// para suportar logins em paralelo, custo de CPU alto para quem tentar quebrar o hash.
const PARAMS = { N: 32_768, r: 8, p: 3 } as const
const KEY_LENGTH = 64
// Teto de memória por derivação. Parâmetros gravados acima disso são recusados (hash inválido),
// para que um valor estranho no banco não derrube o processo.
const MAX_MEMORY_BYTES = 64 * 1024 * 1024

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 256

function derive(password: string, salt: Buffer, length: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, length, { ...options, maxmem: MAX_MEMORY_BYTES }, (error, key) =>
      error ? reject(error) : resolve(key),
    )
  })
}

/** Formato armazenado: scrypt$N$r$p$salt$hash (base64). Salt aleatório por senha. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await derive(password, salt, KEY_LENGTH, PARAMS)
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), hash.toString("base64")].join("$")
}

function parseStored(stored: string): { N: number; r: number; p: number; salt: Buffer; hash: Buffer } | null {
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return null
  const [, N, r, p, salt, hash] = parts
  const params = { N: Number(N), r: Number(r), p: Number(p) }
  if (![params.N, params.r, params.p].every((value) => Number.isSafeInteger(value) && value > 0)) return null
  // Memória do scrypt ≈ 128 · N · r bytes.
  if (128 * params.N * params.r > MAX_MEMORY_BYTES) return null
  const expected = Buffer.from(hash, "base64")
  if (!expected.length) return null
  return { ...params, salt: Buffer.from(salt, "base64"), hash: expected }
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored)
  if (!parsed) return false
  try {
    const actual = await derive(password, parsed.salt, parsed.hash.length, { N: parsed.N, r: parsed.r, p: parsed.p })
    return timingSafeEqual(actual, parsed.hash)
  } catch {
    return false
  }
}

/** Hash gravado com parâmetros antigos: deve ser refeito no próximo login bem-sucedido. */
export function needsRehash(stored: string): boolean {
  const parsed = parseStored(stored)
  return !parsed || parsed.N !== PARAMS.N || parsed.r !== PARAMS.r || parsed.p !== PARAMS.p
}

let dummyHash: Promise<string> | undefined

/** Usado quando o e-mail não existe, para o login levar o mesmo tempo nos dois casos. */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"))
  return dummyHash
}
