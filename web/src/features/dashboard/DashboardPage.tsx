import { BarList } from '../../components/ui/BarList.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { DonutChart } from '../../components/ui/DonutChart.tsx'
import { EmptyState } from '../../components/ui/EmptyState.tsx'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { ResourceView } from '../../components/ui/ResourceView.tsx'
import { StatCard } from '../../components/ui/StatCard.tsx'
import type { DashboardSummary } from '@tres-eixos/contracts'
import { formatNumber } from '../../lib/format.ts'
import { filamentBars, lowStockBars, openOrdersCount, orderSegments } from './dashboard-metrics.ts'
import { UpcomingShipments } from './UpcomingShipments.tsx'
import { useDashboard } from './useDashboard.ts'

export function DashboardPage() {
  const dashboard = useDashboard()
  return (
    <>
      <PageHeader
        title="Visão geral"
        description="O que precisa de atenção hoje na operação."
        actions={<Button icon="refresh" onClick={dashboard.reload} loading={dashboard.loading} loadingText="Atualizando…">Atualizar</Button>}
      />
      <ResourceView resource={dashboard} skeletonRows={6}>
        {(data) => <DashboardContent data={data} />}
      </ResourceView>
    </>
  )
}

function DashboardContent({ data }: { data: DashboardSummary }) {
  const totals = data.orders.byStatus
  const production = data.production
  const overdue = data.orders.overdue
  const stockBars = lowStockBars(data.lowStock)
  const filament = filamentBars(data.lowFilament)

  return (
    <div className="dashboard-grid">
      <div className="stats-row span-3">
        <StatCard icon="cart" tone="accent" label="Pedidos em aberto" value={formatNumber(openOrdersCount(totals))}
          hint={overdue > 0 ? `${overdue} com prazo vencido` : 'Nenhum atrasado'} href="#/pedidos" />
        <StatCard icon="clock" tone="warning" label="Aguardando estoque" value={formatNumber(totals.awaiting_stock)}
          hint={`${totals.pending_mapping} com SKU pendente`} href="#/pedidos?status=awaiting_stock" />
        <StatCard icon="printer" tone="info" label="Na fila de produção" value={formatNumber(production.pieces)}
          hint={production.blocked > 0 ? `${production.blocked} bloqueados por cor` : `${production.printing} imprimindo`} href="#/producao" />
        <StatCard icon="truck" tone="success" label="Prontos para envio" value={formatNumber(totals.ready)}
          hint={`${formatNumber(totals.shipped)} já enviados`} href="#/expedicao" />
      </div>

      <Card title="Pedidos por situação" subtitle="Somente pedidos em aberto">
        <DonutChart segments={orderSegments(totals)} centerValue={formatNumber(openOrdersCount(totals))} centerLabel="em aberto" />
      </Card>

      <Card title="Próximos envios" subtitle="Prazo mais próximo primeiro" span={2}>
        <UpcomingShipments orders={data.upcomingShipments} />
      </Card>

      <Card title="Peças prontas" subtitle="Menor saldo livre primeiro" span={2}>
        {stockBars.length ? <BarList items={stockBars} /> : <EmptyState icon="box" text="Nenhum produto ativo." />}
      </Card>

      <Card title="Filamento" subtitle="Gramas livres por cor" span={1}>
        {filament.length ? <BarList items={filament} /> : <EmptyState icon="spool" text="Nenhum material cadastrado." />}
      </Card>
    </div>
  )
}
