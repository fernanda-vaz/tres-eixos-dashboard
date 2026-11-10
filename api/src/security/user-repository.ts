import type { Queryable } from "../db.js"

export type SessionUser = { id: string; email: string; name: string }

export type UserCredentials = SessionUser & { passwordHash: string; active: boolean }

export async function findActiveUserById(db: Queryable, id: string): Promise<SessionUser | null> {
  const result = await db.query<SessionUser>("SELECT id, email, name FROM users WHERE id = $1 AND active", [id])
  return result.rows[0] ?? null
}

/** Busca pelo e-mail já em minúsculas, inclusive contas inativas (quem chama decide). */
export async function findUserByEmail(db: Queryable, email: string): Promise<UserCredentials | null> {
  const result = await db.query<SessionUser & { password_hash: string; active: boolean }>(
    "SELECT id, email, name, password_hash, active FROM users WHERE lower(email) = $1",
    [email],
  )
  const row = result.rows[0]
  return row ? { id: row.id, email: row.email, name: row.name, passwordHash: row.password_hash, active: row.active } : null
}

export async function updatePasswordHash(db: Queryable, id: string, passwordHash: string): Promise<void> {
  await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [id, passwordHash])
}

export async function insertUser(db: Queryable, user: { id: string; email: string; name: string; passwordHash: string }): Promise<void> {
  await db.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)", [
    user.id,
    user.email,
    user.name,
    user.passwordHash,
  ])
}
