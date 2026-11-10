import type { Tx } from "../db.js"

/**
 * Aviso in-process: o saldo livre de um produto acabou de aumentar (ajuste, produção concluída).
 * O módulo de estoque não sabe o que acontece depois; quem se interessa (fulfillment, que reserva
 * para pedidos em espera) registra um handler na composição da aplicação. O handler roda na MESMA
 * transação, com o lock do estoque já tomado por quem avisou.
 */
export type StockIncreasedHandler = (tx: Tx, productId: string) => Promise<void>

const handlers: StockIncreasedHandler[] = []

/** Registra um handler e devolve a função que o remove. */
export function onStockIncreased(handler: StockIncreasedHandler): () => void {
  handlers.push(handler)
  return () => {
    const index = handlers.indexOf(handler)
    if (index >= 0) handlers.splice(index, 1)
  }
}

export async function notifyStockIncreased(tx: Tx, productId: string): Promise<void> {
  for (const handler of handlers) await handler(tx, productId)
}
