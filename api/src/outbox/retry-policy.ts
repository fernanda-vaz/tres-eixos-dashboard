// Política de retentativa do outbox: pura, sem banco (testada sem conexão).

/** Depois de tantas falhas o evento vai para a dead-letter e deixa de ser reagendado. */
export const MAX_ATTEMPTS = 20
const MAX_BACKOFF_SECONDS = 15 * 60

/** Espera antes da próxima tentativa: 2, 4, 8… segundos, até 15 minutos. */
export function retryDelaySeconds(attempts: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, 2 ** Math.max(1, attempts))
}
