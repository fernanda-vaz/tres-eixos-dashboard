import type { Order } from '@tres-eixos/contracts'
import { Badge, StatusBadge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { DataTable, type Column } from '../../components/ui/DataTable.tsx'
import { TextField } from '../../components/ui/Field.tsx'
import { Form } from '../../components/ui/Form.tsx'
import { Notice } from '../../components/ui/Notice.tsx'
import { ResourceView } from '../../components/ui/ResourceView.tsx'
import { formatCents, formatDateTime } from '../../lib/format.ts'
import { ORDER_STATUS } from '../../lib/labels.ts'
import { canRetryAllocation, isOpen } from './order-rules.ts'
import { useOrderDetail } from './useOrders.ts'

type Item = Order['items'][number]

const itemColumns: Column<Item>[] = [
  {
    key: 'sku',
    header: 'SKU',
    render: (item) => item.sku ?? <>{item.externalSku} <Badge tone="danger">sem mapeamento</Badge></>,
  },
  { key: 'qty', header: 'Qtd.', align: 'right', render: (item) => item.quantity },
  { key: 'price', header: 'Preço unit.', align: 'right', render: (item) => formatCents(item.unitPriceCents) },
  {
    key: 'reservation',
    header: 'Reserva',
    render: (item) => (item.reservation ? <Badge tone="info">{item.reservation.status}</Badge> : <Badge tone="warning">aguardando</Badge>),
  },
]

export function OrderDetail({ orderId, onChanged }: { orderId: string; onChanged: () => void }) {
  const detail = useOrderDetail(orderId, onChanged)

  return (
    <ResourceView resource={detail.order} skeletonRows={5}>
      {(order) => (
        <div className="stack">
          <div className="detail-head">
            <code className="detail-id">{order.externalOrderId}</code>
            <StatusBadge status={ORDER_STATUS[order.status]} />
          </div>
          <dl className="facts">
            <div><dt>Canal</dt><dd>{order.channel.name}</dd></div>
            <div><dt>Pedido em</dt><dd>{formatDateTime(order.orderedAt)}</dd></div>
            <div><dt>Prazo de envio</dt><dd>{formatDateTime(order.shipBy)}</dd></div>
            <div><dt>Total</dt><dd>{formatCents(order.totalCents)}</dd></div>
            {order.externalStatus && <div><dt>Status na plataforma</dt><dd>{order.externalStatus}</dd></div>}
          </dl>
          <DataTable caption="Itens do pedido" columns={itemColumns} rows={order.items} rowKey={(item) => item.id} />
          {order.productionJobs.length > 0 && (
            <p className="muted">Produção: {order.productionJobs.map((job) => `${job.quantity} un. (${job.status})`).join(', ')}</p>
          )}
          <section>
            <h3 className="section-title">Histórico</h3>
            <ol className="history">
              {order.history.map((entry, index) => (
                <li key={index}><time>{formatDateTime(entry.createdAt)}</time> {entry.reason}</li>
              ))}
            </ol>
          </section>
          <Notice feedback={detail.action.feedback} />
          {canRetryAllocation(order) && (
            <Button icon="refresh" loading={detail.action.busy} onClick={detail.retryAllocation}>Tentar reservar de novo</Button>
          )}
          {isOpen(order) && (
            <Form layout="inline" onSubmit={detail.cancel} label="Cancelar pedido">
              <TextField label="Motivo do cancelamento" maxLength={255} value={detail.cancelReason}
                onValueChange={detail.setCancelReason} />
              <Button type="submit" variant="danger" disabled={detail.action.busy}>Cancelar pedido</Button>
            </Form>
          )}
        </div>
      )}
    </ResourceView>
  )
}
