import { useState } from 'react'
import { ordersApi } from '../../api/endpoints.ts'
import type { OrderStatus } from '../../api/types.ts'
import { useAction } from '../../hooks/useAction.ts'
import { useResource } from '../../hooks/useResource.ts'
import { newIdempotencyKey } from '../../lib/idempotency.ts'
import { localInputToIso, normalizeSku } from '../../lib/parse.ts'

/** Lista paginada de pedidos com filtro de situação ('' = todas). */
export function useOrders() {
  const [page, setPage] = useState(1)
  const [status, setStatusState] = useState<OrderStatus | ''>('')
  const orders = useResource(
    () => ordersApi.list({ page, pageSize: 20, status: status || undefined }),
    `${page}|${status}`,
  )

  function setStatus(value: OrderStatus | '') {
    setPage(1)
    setStatusState(value)
  }

  return { orders, page, setPage, status, setStatus }
}

export type ItemRow = { sku: string; quantity: string }

const emptyItem = (): ItemRow => ({ sku: '', quantity: '1' })

/**
 * Formulário de pedido manual com vários itens. A Idempotency-Key vale até o pedido ser criado:
 * reenviar após um erro de rede não cria um segundo pedido.
 */
export function useOrderForm(onCreated: (orderId: string) => void) {
  const [externalOrderId, setExternalOrderId] = useState('')
  const [shipBy, setShipBy] = useState('')
  const [items, setItems] = useState<ItemRow[]>([emptyItem()])
  const [key, setKey] = useState(() => newIdempotencyKey('pedido'))
  const action = useAction()

  const updateItem = (index: number, patch: Partial<ItemRow>) =>
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const addItem = () => setItems((rows) => [...rows, emptyItem()])
  const removeItem = (index: number) => setItems((rows) => rows.filter((_, i) => i !== index))

  function reset() {
    setExternalOrderId('')
    setShipBy('')
    setItems([emptyItem()])
    setKey(newIdempotencyKey('pedido'))
  }

  async function submit() {
    const order = {
      externalOrderId: externalOrderId.trim() || undefined,
      shipBy: localInputToIso(shipBy),
      items: items.map((row) => ({ sku: normalizeSku(row.sku), quantity: Number(row.quantity) })),
    }
    await action.run(async () => {
      const created = await ordersApi.create(order, key)
      reset()
      onCreated(created.id)
    }, 'Pedido registrado.')
  }

  return {
    externalOrderId, setExternalOrderId, shipBy, setShipBy,
    items, updateItem, addItem, removeItem, submit, action,
  }
}

/** Detalhe de um pedido e as ações que não são de expedição (cancelar, tentar reservar de novo). */
export function useOrderDetail(orderId: string, onChanged: () => void) {
  const order = useResource(() => ordersApi.get(orderId), orderId)
  const [cancelReason, setCancelReason] = useState('')
  const action = useAction()

  async function perform(work: () => Promise<unknown>, success: string) {
    const done = await action.run(work, success)
    if (!done) return
    order.reload()
    onChanged()
  }

  const cancel = () => perform(() => ordersApi.cancel(orderId, cancelReason.trim() || undefined), 'Pedido cancelado.')
  const retryAllocation = () => perform(() => ordersApi.retryAllocation(orderId), 'Nova tentativa de reserva feita.')

  return { order, cancelReason, setCancelReason, cancel, retryAllocation, action }
}
