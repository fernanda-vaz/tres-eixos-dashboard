import type { ReactNode } from 'react'
import type { OrderSummary } from '@tres-eixos/contracts'
import { Card } from '../../components/ui/Card.tsx'
import { Pager } from '../../components/ui/Pager.tsx'
import { ResourceView } from '../../components/ui/ResourceView.tsx'
import { formatDateTime } from '../../lib/format.ts'
import type { QueueColumn } from './useShipping.ts'

type ShippingColumnProps = {
  title: string
  subtitle: string
  column: QueueColumn
  empty: string
  renderActions: (order: OrderSummary) => ReactNode
}

/** Coluna do quadro de expedição: uma lista paginada de pedidos com as ações da etapa. */
export function ShippingColumn({ title, subtitle, column, empty, renderActions }: ShippingColumnProps) {
  const total = column.orders.data?.total
  return (
    <Card title={total === undefined ? title : `${title} (${total})`} subtitle={subtitle}>
      <ResourceView resource={column.orders} isEmpty={(page) => page.items.length === 0} empty={empty} emptyIcon="truck">
        {(page) => (
          <>
            <ul className="ship-list">
              {page.items.map((order) => (
                <li key={order.id} className="ship-item">
                  <div className="cell-stack">
                    <code className="id-code" title={order.externalOrderId}>{order.externalOrderId}</code>
                    <small className="muted">{order.itemCount} peça(s) · envio até {formatDateTime(order.shipBy)}</small>
                  </div>
                  <div className="actions-row">{renderActions(order)}</div>
                </li>
              ))}
            </ul>
            <Pager page={page.page} pageSize={page.pageSize} total={page.total} onChange={column.setPage} />
          </>
        )}
      </ResourceView>
    </Card>
  )
}
