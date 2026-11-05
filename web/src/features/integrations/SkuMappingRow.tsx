import type { PendingSku, Product } from '../../api/types.ts'
import { Button } from '../../components/ui/Button.tsx'
import { SelectField } from '../../components/ui/Field.tsx'
import { Form } from '../../components/ui/Form.tsx'
import { useSkuMapping } from './useIntegrations.ts'

type SkuMappingRowProps = { sku: PendingSku; products: Product[]; onMapped: () => void }

export function SkuMappingRow({ sku, products, onMapped }: SkuMappingRowProps) {
  const mapping = useSkuMapping(sku, onMapped)
  const options = products.map((product) => ({ value: product.id, label: `${product.sku} — ${product.name}` }))
  return (
    <li className="mapping-row">
      <div className="cell-stack">
        <code>{sku.externalSku}</code>
        <small className="muted">{sku.pendingOrders} pedido(s) aguardando</small>
      </div>
      <Form layout="inline" onSubmit={mapping.submit} feedback={mapping.action.feedback} label={`Mapear ${sku.externalSku}`}>
        <SelectField label={`Produto para ${sku.externalSku}`} hideLabel required options={options}
          placeholder="Corresponde a…" value={mapping.productId} onValueChange={mapping.setProductId} />
        <Button type="submit" size="sm" variant="primary" loading={mapping.action.busy} loadingText="…">Mapear</Button>
      </Form>
    </li>
  )
}
