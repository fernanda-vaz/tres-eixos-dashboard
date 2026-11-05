import { useState } from 'react'
import { Button } from '../../components/ui/Button.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { Drawer } from '../../components/ui/Drawer.tsx'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { ResourceView } from '../../components/ui/ResourceView.tsx'
import { MaterialForm } from './MaterialForm.tsx'
import { MaterialsTable } from './MaterialsTable.tsx'
import { RecipeEditor } from './RecipeEditor.tsx'
import { useMaterials } from './useMaterials.ts'

export function MaterialsPage() {
  const { materials, products } = useMaterials()
  const [creating, setCreating] = useState(false)

  return (
    <>
      <PageHeader
        title="Materiais"
        description="Filamento em gramas e quanto cada produto consome."
        actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Novo material</Button>}
      />
      <div className="page-grid">
        <Card title="Filamento em estoque" span={2}>
          <ResourceView resource={materials} isEmpty={(page) => page.items.length === 0} empty="Nenhum material cadastrado." emptyIcon="spool">
            {(page) => <MaterialsTable materials={page.items} onChanged={materials.reload} />}
          </ResourceView>
        </Card>
        <Card title="Receita do produto" subtitle="Gramas de filamento por unidade">
          <RecipeEditor products={products.data?.items ?? []} materials={materials.data?.items ?? []} />
        </Card>
      </div>
      <Drawer title="Novo material" open={creating} onClose={() => setCreating(false)}>
        <MaterialForm onCreated={materials.reload} />
      </Drawer>
    </>
  )
}
