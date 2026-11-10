import { useState } from 'react'
import { ordersApi } from '../../api/endpoints.ts'
import type { OrderStatus, OrderSummary } from '@tres-eixos/contracts'
import { useAction } from '../../hooks/useAction.ts'
import { useResource } from '../../hooks/useResource.ts'

const PAGE_SIZE = 20

/** Uma coluna do quadro: pedidos de um status, paginados (nunca um teto silencioso). */
function useQueueColumn(status: OrderStatus) {
  const [page, setPage] = useState(1)
  const orders = useResource(() => ordersApi.list({ status, page, pageSize: PAGE_SIZE }), `shipping|${status}|${page}`)
  return { orders, setPage }
}

/** Pedidos a separar (todas as peças reservadas) e a enviar (prontos), com as ações de expedição. */
export function useShipping() {
  const toPack = useQueueColumn('reserved')
  const toShip = useQueueColumn('ready')
  const action = useAction()

  async function perform(work: () => Promise<unknown>, success: string) {
    if (!(await action.run(work, success))) return
    toPack.orders.reload()
    toShip.orders.reload()
  }

  return {
    toPack, toShip, action,
    markReady: (order: OrderSummary) => perform(() => ordersApi.markReady(order.id), `${order.externalOrderId} pronto para envio.`),
    markLabel: (order: OrderSummary) => perform(() => ordersApi.markLabelPrinted(order.id), 'Etiqueta registrada.'),
    dispatch: (order: OrderSummary) => perform(() => ordersApi.dispatch(order.id), `${order.externalOrderId} enviado; estoque baixado.`),
  }
}

export type QueueColumn = ReturnType<typeof useQueueColumn>
