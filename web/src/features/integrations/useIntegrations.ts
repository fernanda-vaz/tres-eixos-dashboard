import { useState } from 'react'
import { integrationsApi, outboxApi } from '../../api/endpoints.ts'
import type { DeadEvent, PendingSku, SyncResult } from '../../api/types.ts'
import { useAction } from '../../hooks/useAction.ts'
import { useResource } from '../../hooks/useResource.ts'

/** Simulador, pendências de SKU, erros de integração e eventos de saída com falha. */
export function useIntegrations() {
  const pending = useResource(integrationsApi.pendingSkus, 'pending-skus')
  const errors = useResource(integrationsApi.errors, 'integration-errors')
  const dead = useResource(outboxApi.dead, 'outbox-dead')
  const [lastSync, setLastSync] = useState<SyncResult | null>(null)
  const action = useAction()

  const refresh = () => {
    pending.reload()
    errors.reload()
    dead.reload()
  }

  async function sync() {
    const done = await action.run(async () => setLastSync(await integrationsApi.syncSimulator()), 'Sincronização executada.')
    if (done) refresh()
  }

  async function retryDead(event: DeadEvent) {
    const done = await action.run(() => outboxApi.retry(event.id), `Evento ${event.topic} devolvido à fila de publicação.`)
    if (done) dead.reload()
  }

  return { pending, errors, dead, lastSync, sync, retryDead, refresh, action }
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
