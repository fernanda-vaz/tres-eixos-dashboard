import type { OrderSummary } from '../../api/types.ts'
import { StatusBadge } from '../../components/ui/Badge.tsx'
import { EmptyState } from '../../components/ui/EmptyState.tsx'
import { ORDER_STATUS } from '../../lib/labels.ts'
import { deadlineText } from './dashboard-metrics.ts'

export function UpcomingShipments({ orders }: { orders: OrderSummary[] }) {
  if (!orders.length) return <EmptyState icon="truck" text="Nenhum pedido em aberto." />
  return (
    <ul className="timeline">
      {orders.map((order) => {
        const deadline = deadlineText(order.shipBy)
        return (
          <li key={order.id} className="timeline-item">
            <span className={`timeline-dot ${deadline.overdue ? 'tone-danger' : 'tone-accent'}`} aria-hidden />
            <div className="timeline-main">
              <code className="id-code" title={order.externalOrderId}>{order.externalOrderId}</code>
              <span className="muted">{order.itemCount} peça(s)</span>
            </div>
            <span className={deadline.overdue ? 'deadline overdue' : 'deadline'}>{deadline.text}</span>
            <StatusBadge status={ORDER_STATUS[order.status]} />
          </li>
        )
      })}
    </ul>
  )
}
