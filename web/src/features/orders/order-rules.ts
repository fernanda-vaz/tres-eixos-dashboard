import type { Order } from '@tres-eixos/contracts'

/** Pedido ainda pode ser cancelado (não foi enviado nem cancelado). */
export const isOpen = (order: Pick<Order, 'status'>) => order.status !== 'shipped' && order.status !== 'cancelled'

/** Pedido em espera de estoque ou de mapeamento pode tentar reservar de novo. */
export const canRetryAllocation = (order: Pick<Order, 'status'>) =>
  order.status === 'awaiting_stock' || order.status === 'pending_mapping'
