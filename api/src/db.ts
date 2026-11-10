import pg from "pg"
import { logger } from "./logger.js"
import type { PageRequest } from "./pagination.js"

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada")
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
})

pool.on("error", (error) => {
  logger.error({ err: error }, "Erro em conexão ociosa do PostgreSQL")
})

export type Tx = pg.PoolClient

/** O pool ou um client em transação: ambos executam consultas parametrizadas. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>
}

/**
 * Executa `work` em uma transação usando UM único client: BEGIN, COMMIT ou ROLLBACK
 * acontecem na mesma conexão, que é liberada no finally.
 */
export async function withTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  let broken: Error | undefined
  try {
    await client.query("BEGIN")
    // Nenhuma requisição fica presa indefinidamente esperando um bloqueio.
    await client.query("SET LOCAL lock_timeout = '5s'")
    const result = await work(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    try {
      await client.query("ROLLBACK")
    } catch (rollbackError) {
      // Conexão em estado desconhecido: descarta em vez de devolver ao pool.
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError))
    }
    throw error
  } finally {
    client.release(broken)
  }
}

/**
 * Lista uma página e conta o total do mesmo filtro. No pool as duas consultas correm em paralelo
 * (conexões diferentes, sem snapshot comum: sob escrita concorrente o total pode divergir da
 * página por uma linha); em um client de transação, uma após a outra.
 * `listSql` recebe os parâmetros do filtro seguidos de LIMIT e OFFSET; `countSql`, só os do filtro.
 */
export async function queryPage<R extends pg.QueryResultRow>(
  db: Queryable,
  listSql: string,
  countSql: string,
  params: unknown[],
  page: PageRequest,
): Promise<{ rows: R[]; total: number }> {
  const [rows, count] = await Promise.all([
    db.query<R>(listSql, [...params, page.pageSize, page.offset]),
    db.query<{ total: string }>(countSql, params),
  ])
  return { rows: rows.rows, total: Number(count.rows[0].total) }
}
