import type { PendingSku } from '@tres-eixos/contracts'
import { Button } from '../../components/ui/Button.tsx'
import { Form } from '../../components/ui/Form.tsx'
import { ProductPicker } from '../products/ProductPicker.tsx'
import { useSkuMapping } from './useIntegrations.ts'

type SkuMappingRowProps = { sku: PendingSku; onMapped: () => void }

export function SkuMappingRow({ sku, onMapped }: SkuMappingRowProps) {
  const mapping = useSkuMapping(sku, onMapped)
  return (
    <li className="mapping-row">
      <div className="cell-stack">
        <code>{sku.externalSku}</code>
        <small className="muted">{sku.pendingOrders} pedido(s) aguardando</small>
      </div>
      <Form layout="inline" onSubmit={mapping.submit} feedback={mapping.action.feedback} label={`Mapear ${sku.externalSku}`}>
        <ProductPicker label={`Produto para ${sku.externalSku}`} hideLabel required value={mapping.productId} onChange={mapping.setProductId} />
        <Button type="submit" size="sm" variant="primary" loading={mapping.action.busy} loadingText="…">Mapear</Button>
      </Form>
    </li>
  )
}
