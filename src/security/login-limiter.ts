import { createHash } from "node:crypto"
import { pool } from "../db.js"

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex")
}

/**
 * Limite de tentativas de login guardado no PostgreSQL: sobrevive a reinícios e é
 * compartilhado entre instâncias da API. A chave é armazenada como hash.
 *
 * `consume` conta a tentativa ANTES de a senha ser conferida, numa única instrução atômica
 * (INSERT … ON CONFLICT DO UPDATE trava a linha). Assim, 200 requisições paralelas recebem
 * as contagens 1, 2, … 200 e só as primeiras `max` passam.
 */
export class LoginLimiter {
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Registra uma tentativa e informa se ela ainda está dentro do limite da janela. */
  async consume(key: string): Promise<boolean> {
    const result = await pool.query<{ attempts: number }>(
      `INSERT INTO login_attempts (key_hash, attempts, window_started_at) VALUES ($1, 1, now())
       ON CONFLICT (key_hash) DO UPDATE SET
         attempts = CASE WHEN login_attempts.window_started_at <= now() - make_interval(secs => $2::double precision)
                         THEN 1 ELSE login_attempts.attempts + 1 END,
         window_started_at = CASE WHEN login_attempts.window_started_at <= now() - make_interval(secs => $2::double precision)
                                  THEN now() ELSE login_attempts.window_started_at END
       RETURNING attempts`,
      [hashKey(key), this.windowMs / 1000],
    )
    // Limpeza oportunista de janelas antigas.
    if (Math.random() < 0.05) {
      await pool.query("DELETE FROM login_attempts WHERE window_started_at < now() - interval '1 day'")
    }
    return result.rows[0].attempts <= this.max
  }

  async reset(key: string): Promise<void> {
    await pool.query("DELETE FROM login_attempts WHERE key_hash = $1", [hashKey(key)])
  }
}
