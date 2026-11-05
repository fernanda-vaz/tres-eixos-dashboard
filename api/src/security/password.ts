import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto"

// scrypt da biblioteca padrão do Node: algoritmo de derivação de chave próprio para senhas.
const PARAMS = { N: 16_384, r: 8, p: 1 } as const
const KEY_LENGTH = 64

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 256

function derive(password: string, salt: Buffer, length: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, length, options, (error, key) => (error ? reject(error) : resolve(key)))
  })
}

/** Formato armazenado: scrypt$N$r$p$salt$hash (base64). Salt aleatório por senha. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await derive(password, salt, KEY_LENGTH, PARAMS)
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), hash.toString("base64")].join("$")
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return false
  const [, N, r, p, salt, hash] = parts
  const expected = Buffer.from(hash, "base64")
  if (!expected.length) return false
  const actual = await derive(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  })
  return timingSafeEqual(actual, expected)
}

let dummyHash: Promise<string> | undefined

/** Usado quando o e-mail não existe, para o login levar o mesmo tempo nos dois casos. */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"))
  return dummyHash
}
