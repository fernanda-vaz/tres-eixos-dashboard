import type { ReactNode } from 'react'
import type { OrderSummary } from '../../api/types.ts'
import { Card } from '../../components/ui/Card.tsx'
import { EmptyState } from '../../components/ui/EmptyState.tsx'
import { formatDateTime } from '../../lib/format.ts'

type ShippingColumnProps = {
  title: string
  subtitle: string
  orders: OrderSummary[]
  empty: string
  renderActions: (order: OrderSummary) => ReactNode
}

/** Coluna do quadro de expedição: uma lista de pedidos com as ações da etapa. */
export function ShippingColumn({ title, subtitle, orders, empty, renderActions }: ShippingColumnProps) {
  return (
    <Card title={`${title} (${orders.length})`} subtitle={subtitle}>
      {orders.length === 0 ? (
        <EmptyState icon="truck" text={empty} />
      ) : (
        <ul className="ship-list">
          {orders.map((order) => (
            <li key={order.id} className="ship-item">
              <div className="cell-stack">
                <code className="id-code" title={order.externalOrderId}>{order.externalOrderId}</code>
                <small className="muted">{order.itemCount} peça(s) · envio até {formatDateTime(order.shipBy)}</small>
              </div>
              <div className="actions-row">{renderActions(order)}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
