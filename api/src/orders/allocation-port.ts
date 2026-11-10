import type { Tx } from "../db.js"
import type { OrderStatus } from "./order-rules.js"

/**
 * O que o módulo de pedidos precisa do fulfillment, declarado aqui (inversão de dependência):
 * pedidos conhece a interface; o módulo de fulfillment a implementa e se registra em app.ts.
 * Assim pedidos → (porta) e fulfillment → pedidos, estoque, produção, sem ciclo entre módulos.
 */
export interface AllocationPort {
  /** Reserva os itens sem reserva de um pedido já bloqueado e recalcula o status. */
  allocateOrder(tx: Tx, orderId: string, reason: string): Promise<OrderStatus>
  /** Libera as reservas ativas de um pedido já bloqueado. Retorna os produtos liberados. */
  releaseReservations(tx: Tx, orderId: string, reason: string): Promise<string[]>
  /** Depois que o saldo livre de um produto aumentou, atende os pedidos em espera. */
  allocateWaitingForProduct(tx: Tx, productId: string): Promise<void>
}

let port: AllocationPort | undefined

export function setAllocationPort(implementation: AllocationPort): void {
  port = implementation
}

export function allocation(): AllocationPort {
  if (!port) throw new Error("Módulo de fulfillment não registrado: chame registerFulfillment() na composição (app.ts)")
  return port
}
