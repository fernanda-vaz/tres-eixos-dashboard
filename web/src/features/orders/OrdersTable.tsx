import type { OrderSummary } from '@tres-eixos/contracts'
import { StatusBadge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { DataTable, type Column } from '../../components/ui/DataTable.tsx'
import { formatCents, formatDateTime } from '../../lib/format.ts'
import { CHANNEL_LABEL, ORDER_STATUS } from '../../lib/labels.ts'

type OrdersTableProps = { orders: OrderSummary[]; selectedId: string | null; onOpen: (id: string) => void }

export function OrdersTable({ orders, selectedId, onOpen }: OrdersTableProps) {
  const columns: Column<OrderSummary>[] = [
    {
      key: 'order',
      header: 'Pedido',
      render: (row) => (
        <div className="cell-stack">
          <code className="id-code" title={row.externalOrderId}>{row.externalOrderId}</code>
          <small className="muted">{formatDateTime(row.orderedAt)}</small>
        </div>
      ),
    },
    { key: 'channel', header: 'Canal', render: (row) => CHANNEL_LABEL[row.channelProvider] ?? row.channelProvider },
    { key: 'status', header: 'Situação', render: (row) => <StatusBadge status={ORDER_STATUS[row.status]} /> },
    { key: 'shipBy', header: 'Prazo de envio', render: (row) => formatDateTime(row.shipBy) },
    { key: 'items', header: 'Peças', align: 'right', render: (row) => row.itemCount },
    { key: 'total', header: 'Total', align: 'right', render: (row) => formatCents(row.totalCents) },
    {
      key: 'open',
      header: 'Detalhes',
      hideHeader: true,
      render: (row) => (
        <Button size="sm" variant="ghost" icon="chevronRight" onClick={() => onOpen(row.id)}>Detalhes</Button>
      ),
    },
  ]
  return (
    <DataTable caption="Pedidos" columns={columns} rows={orders} rowKey={(row) => row.id}
      isSelected={(row) => row.id === selectedId} />
  )
}
