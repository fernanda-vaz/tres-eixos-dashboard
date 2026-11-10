import { useState } from 'react'
import { ordersApi } from '../../api/endpoints.ts'
import type { OrderStatus } from '@tres-eixos/contracts'
import { useAction } from '../../hooks/useAction.ts'
import { useHashRoute } from '../../hooks/useHashRoute.ts'
import { useResource } from '../../hooks/useResource.ts'
import { pageFromQuery } from '../../lib/hash.ts'
import { newIdempotencyKey } from '../../lib/idempotency.ts'
import { ORDER_STATUS } from '../../lib/labels.ts'
import { localInputToIso, normalizeSku } from '../../lib/parse.ts'

const PAGE_SIZE = 20

function statusFromQuery(value: string | undefined): OrderStatus | '' {
  return value && value in ORDER_STATUS ? (value as OrderStatus) : ''
}

/**
 * Lista paginada de pedidos. Filtro, página e pedido aberto vivem no hash da URL
 * (#/pedidos/<id>?status=ready&page=2): recarregar ou compartilhar o link preserva o contexto.
 */
export function useOrders() {
  const { route, navigate } = useHashRoute()
  const status = statusFromQuery(route.query.status)
  const page = pageFromQuery(route.query)
  const selectedId = route.id
  const orders = useResource(
    () => ordersApi.list({ page, pageSize: PAGE_SIZE, status: status || undefined }),
    `${page}|${status}`,
  )

  const go = (next: { status?: OrderStatus | ''; page?: number; id?: string | null }) =>
    navigate({ path: 'pedidos', id: next.id === undefined ? selectedId : next.id, query: { status: next.status ?? status, page: next.page ?? page } })

  return {
    orders,
    page,
    setPage: (value: number) => go({ page: value }),
    status,
    setStatus: (value: OrderStatus | '') => go({ status: value, page: 1 }),
    selectedId,
    open: (id: string) => go({ id }),
    close: () => go({ id: null }),
  }
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
