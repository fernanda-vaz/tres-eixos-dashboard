import { useState } from 'react'
import { integrationsApi, productsApi } from '../../api/endpoints.ts'
import type { PendingSku, SyncResult } from '../../api/types.ts'
import { useAction } from '../../hooks/useAction.ts'
import { useResource } from '../../hooks/useResource.ts'

/** Simulador, pendências de SKU e erros de integração. */
export function useIntegrations() {
  const pending = useResource(integrationsApi.pendingSkus, 'pending-skus')
  const errors = useResource(integrationsApi.errors, 'integration-errors')
  const products = useResource(() => productsApi.list({ pageSize: 100, active: true }), 'active-products')
  const [lastSync, setLastSync] = useState<SyncResult | null>(null)
  const action = useAction()

  const refresh = () => {
    pending.reload()
    errors.reload()
  }

  async function sync() {
    const done = await action.run(async () => setLastSync(await integrationsApi.syncSimulator()), 'Sincronização executada.')
    if (done) refresh()
  }

  return { pending, errors, products, lastSync, sync, refresh, action }
}

/** Mapeia um SKU externo pendente para um produto do catálogo. */
export function useSkuMapping(sku: PendingSku, onMapped: () => void) {
  const [productId, setProductId] = useState('')
  const action = useAction()

  async function submit() {
    const done = await action.run(
      () => integrationsApi.mapSku({ channelId: sku.channelId, externalSku: sku.externalSku, productId }),
      `${sku.externalSku} mapeado; pedidos pendentes reprocessados.`,
    )
    if (done) onMapped()
  }

  return { productId, setProductId, submit, action }
}

export function describeSync(result: SyncResult): string {
  const prefix = result.status === 'completed' ? 'Concluída' : `Interrompida (${result.error}); a próxima retoma de onde parou`
  return `${prefix}: ${result.created} novos, ${result.updated} atualizados, ${result.duplicate} repetidos, ${result.failed} com falha.`
}
