import type { IntegrationError } from '../../api/types.ts'
import { Button } from '../../components/ui/Button.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { DataTable, type Column } from '../../components/ui/DataTable.tsx'
import { Notice } from '../../components/ui/Notice.tsx'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { ResourceView } from '../../components/ui/ResourceView.tsx'
import { formatDateTime } from '../../lib/format.ts'
import { SkuMappingRow } from './SkuMappingRow.tsx'
import { describeSync, useIntegrations } from './useIntegrations.ts'

const errorColumns: Column<IntegrationError>[] = [
  { key: 'event', header: 'Evento', render: (row) => <code>{row.eventId}</code> },
  { key: 'attempts', header: 'Tentativas', align: 'right', render: (row) => row.attempts },
  { key: 'error', header: 'Último erro', render: (row) => row.lastError },
  { key: 'when', header: 'Quando', render: (row) => formatDateTime(row.receivedAt) },
]

export function IntegrationsPage() {
  const integrations = useIntegrations()
  const products = integrations.products.data?.items ?? []

  return (
    <>
      <PageHeader
        title="Integrações"
        description="Origem: simulador. Nenhum marketplace real está conectado."
        actions={
          <Button variant="primary" icon="refresh" loading={integrations.action.busy} loadingText="Sincronizando…" onClick={integrations.sync}>
            Sincronizar simulador
          </Button>
        }
      />
      <Notice feedback={integrations.action.feedback} />
      {integrations.lastSync && <p className="sync-result glass" role="status">{describeSync(integrations.lastSync)}</p>}
      <div className="page-grid two">
        <Card title="SKUs sem correspondência" subtitle="Mapeie para reprocessar os pedidos pendentes">
          <ResourceView resource={integrations.pending} isEmpty={(list) => list.length === 0} empty="Nenhuma pendência de SKU." emptyIcon="check">
            {(list) => (
              <ul className="mapping-list">
                {list.map((sku) => (
                  <SkuMappingRow key={`${sku.channelId}-${sku.externalSku}`} sku={sku} products={products} onMapped={integrations.refresh} />
                ))}
              </ul>
            )}
          </ResourceView>
        </Card>
        <Card title="Erros de integração" actions={<Button size="sm" variant="ghost" icon="refresh" onClick={integrations.errors.reload}>Atualizar</Button>}>
          <ResourceView resource={integrations.errors} isEmpty={(list) => list.length === 0} empty="Nenhum erro de integração." emptyIcon="check">
            {(list) => <DataTable caption="Erros de integração" columns={errorColumns} rows={list} rowKey={(row) => row.eventId} />}
          </ResourceView>
        </Card>
      </div>
    </>
  )
}
