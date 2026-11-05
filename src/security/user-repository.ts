import { pool } from "../db.js"

export type SessionUser = { id: string; email: string; name: string }

export type UserCredentials = SessionUser & { passwordHash: string; active: boolean }

export async function findActiveUserById(id: string): Promise<SessionUser | null> {
  const result = await pool.query<SessionUser>("SELECT id, email, name FROM users WHERE id = $1 AND active", [id])
  return result.rows[0] ?? null
}

/** Busca pelo e-mail já em minúsculas, inclusive contas inativas (quem chama decide). */
export async function findUserByEmail(email: string): Promise<UserCredentials | null> {
  const result = await pool.query<SessionUser & { password_hash: string; active: boolean }>(
    "SELECT id, email, name, password_hash, active FROM users WHERE lower(email) = $1",
    [email],
  )
  const row = result.rows[0]
  return row ? { id: row.id, email: row.email, name: row.name, passwordHash: row.password_hash, active: row.active } : null
}
