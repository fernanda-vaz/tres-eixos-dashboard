import type { DeadEvent, IntegrationError } from '../../api/types.ts'
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
  const deadColumns: Column<DeadEvent>[] = [
    { key: 'topic', header: 'Evento', render: (row) => <div className="cell-stack"><code>{row.topic}</code><small className="muted">{row.aggregateType} {row.aggregateId.slice(0, 8)}…</small></div> },
    { key: 'attempts', header: 'Tentativas', align: 'right', render: (row) => row.attempts },
    { key: 'error', header: 'Último erro', render: (row) => row.lastError },
    { key: 'when', header: 'Desde', render: (row) => formatDateTime(row.deadAt) },
    {
      key: 'retry', header: 'Ações', hideHeader: true,
      render: (row) => <Button size="sm" icon="refresh" disabled={integrations.action.busy} onClick={() => integrations.retryDead(row)}>Tentar de novo</Button>,
    },
  ]

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
                  <SkuMappingRow key={`${sku.channelId}-${sku.externalSku}`} sku={sku} onMapped={integrations.refresh} />
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
        <Card title="Eventos de saída com falha" subtitle="Esgotaram as tentativas de publicação; os seguintes do mesmo pedido esperam"
          span={2} actions={<Button size="sm" variant="ghost" icon="refresh" onClick={integrations.dead.reload}>Atualizar</Button>}>
          <ResourceView resource={integrations.dead} isEmpty={(list) => list.length === 0} empty="Nenhum evento parado." emptyIcon="check">
            {(list) => <DataTable caption="Eventos de saída com falha" columns={deadColumns} rows={list} rowKey={(row) => row.id} />}
          </ResourceView>
        </Card>
      </div>
    </>
  )
}
