import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL ausente")
const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
try {
  await client.query("SELECT pg_advisory_lock(731022)")
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url))
await fs.mkdir(migrationsDir, { recursive: true })
const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort()
  for (const name of files) {
    const exists = await client.query(
      "SELECT 1 FROM schema_migrations WHERE name = $1",
      [name],
    )
    if (exists.rowCount) continue
    const sql = await fs.readFile(path.join(migrationsDir, name), "utf8")
    await client.query("BEGIN")
    try {
      await client.query(sql)
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [
        name,
      ])
      await client.query("COMMIT")
      console.log("Aplicada:", name)
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    }
  }
} finally {
  await client.end()
}
