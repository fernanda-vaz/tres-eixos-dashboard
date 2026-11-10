import { useState } from 'react'
import { Button } from '../../components/ui/Button.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { Drawer } from '../../components/ui/Drawer.tsx'
import { TextField } from '../../components/ui/Field.tsx'
import { Form } from '../../components/ui/Form.tsx'
import { Notice } from '../../components/ui/Notice.tsx'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Pager } from '../../components/ui/Pager.tsx'
import { ResourceView } from '../../components/ui/ResourceView.tsx'
import { ProductForm } from './ProductForm.tsx'
import { ProductsTable } from './ProductsTable.tsx'
import { StockAdjustmentForm } from './StockAdjustmentForm.tsx'
import { useProducts } from './useProducts.ts'

type Panel = 'none' | 'new' | 'adjust'

export function ProductsPage() {
  const { products, applySearch, setPage, toggleActive, action } = useProducts()
  const [panel, setPanel] = useState<Panel>('none')
  const [searchText, setSearchText] = useState('')
  const closePanel = () => setPanel('none')

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Catálogo e peças prontas em estoque."
        actions={
          <>
            <Button icon="layers" onClick={() => setPanel('adjust')}>Ajustar estoque</Button>
            <Button variant="primary" icon="plus" onClick={() => setPanel('new')}>Novo produto</Button>
          </>
        }
      />
      <Card
        title="Catálogo"
        subtitle="Físico = na prateleira · Reservado = comprometido com pedidos · Livre = pode ser vendido"
        actions={
          <Form layout="inline" onSubmit={() => applySearch(searchText)} label="Buscar produtos">
            <TextField label="Buscar por SKU ou nome" hideLabel placeholder="Buscar SKU ou nome" value={searchText}
              onValueChange={setSearchText} />
            <Button type="submit" icon="search">Buscar</Button>
          </Form>
        }
      >
        <Notice feedback={action.feedback} />
        <ResourceView resource={products} isEmpty={(page) => page.items.length === 0} empty="Nenhum produto encontrado." emptyIcon="box">
          {(page) => (
            <>
              <ProductsTable rows={page.items} busy={action.busy} onToggleActive={toggleActive} />
              <Pager page={page.page} pageSize={page.pageSize} total={page.total} onChange={setPage} />
            </>
          )}
        </ResourceView>
      </Card>
      <Drawer title="Novo produto" open={panel === 'new'} onClose={closePanel}>
        <ProductForm onCreated={products.reload} />
      </Drawer>
      <Drawer title="Ajustar estoque de peças prontas" open={panel === 'adjust'} onClose={closePanel}>
        <StockAdjustmentForm onAdjusted={products.reload} />
      </Drawer>
    </>
  )
}
