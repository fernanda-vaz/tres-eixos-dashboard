import { useState } from 'react'
import type { OrderStatus } from '@tres-eixos/contracts'
import { Button } from '../../components/ui/Button.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { Drawer } from '../../components/ui/Drawer.tsx'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Pager } from '../../components/ui/Pager.tsx'
import { ResourceView } from '../../components/ui/ResourceView.tsx'
import { SegmentedControl } from '../../components/ui/SegmentedControl.tsx'
import { ORDER_STATUS, optionsFrom } from '../../lib/labels.ts'
import { OrderDetail } from './OrderDetail.tsx'
import { OrderForm } from './OrderForm.tsx'
import { OrdersTable } from './OrdersTable.tsx'
import { useOrders } from './useOrders.ts'

const STATUS_FILTERS = [{ value: '', label: 'Todos' }, ...optionsFrom(ORDER_STATUS)]

export function OrdersPage() {
  const { orders, setPage, status, setStatus, selectedId, open, close } = useOrders()
  const [creating, setCreating] = useState(false)

  function openCreated(orderId: string) {
    setCreating(false)
    orders.reload()
    open(orderId)
  }

  return (
    <>
      <PageHeader
        title="Pedidos"
        description="Prazo de envio mais próximo primeiro; sem prazo, pela data do pedido."
        actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Novo pedido</Button>}
      />
      <Card
        actions={<SegmentedControl label="Filtrar por situação" options={STATUS_FILTERS} value={status}
          onChange={(value) => setStatus(value as OrderStatus | '')} />}
      >
        <ResourceView resource={orders} isEmpty={(page) => page.items.length === 0} empty="Nenhum pedido nesta situação." emptyIcon="cart">
          {(page) => (
            <>
              <OrdersTable orders={page.items} selectedId={selectedId} onOpen={open} />
              <Pager page={page.page} pageSize={page.pageSize} total={page.total} onChange={setPage} />
            </>
          )}
        </ResourceView>
      </Card>
      <Drawer title="Novo pedido manual" open={creating} onClose={() => setCreating(false)}>
        <OrderForm onCreated={openCreated} />
      </Drawer>
      <Drawer title="Detalhes do pedido" open={selectedId !== null} onClose={close}>
        {selectedId && <OrderDetail orderId={selectedId} onChanged={orders.reload} />}
      </Drawer>
    </>
  )
}
