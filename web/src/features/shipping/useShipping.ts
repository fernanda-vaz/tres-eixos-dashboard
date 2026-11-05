import { ordersApi } from '../../api/endpoints.ts'
import type { OrderSummary } from '../../api/types.ts'
import { useAction } from '../../hooks/useAction.ts'
import { useResource } from '../../hooks/useResource.ts'

async function loadShippingQueue() {
  const [reserved, ready] = await Promise.all([
    ordersApi.list({ status: 'reserved', pageSize: 100 }),
    ordersApi.list({ status: 'ready', pageSize: 100 }),
  ])
  return { toPack: reserved.items, toShip: ready.items }
}

/** Pedidos a separar (todas as peças reservadas) e a enviar (prontos), com as ações de expedição. */
export function useShipping() {
  const queue = useResource(loadShippingQueue, 'shipping')
  const action = useAction()

  async function perform(work: () => Promise<unknown>, success: string) {
    if (await action.run(work, success)) queue.reload()
  }

  return {
    queue, action,
    markReady: (order: OrderSummary) => perform(() => ordersApi.markReady(order.id), `${order.externalOrderId} pronto para envio.`),
    markLabel: (order: OrderSummary) => perform(() => ordersApi.markLabelPrinted(order.id), 'Etiqueta registrada.'),
    dispatch: (order: OrderSummary) => perform(() => ordersApi.dispatch(order.id), `${order.externalOrderId} enviado; estoque baixado.`),
  }
}
