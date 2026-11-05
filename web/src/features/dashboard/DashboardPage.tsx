import { BarList } from '../../components/ui/BarList.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { DonutChart } from '../../components/ui/DonutChart.tsx'
import { EmptyState } from '../../components/ui/EmptyState.tsx'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { ResourceView } from '../../components/ui/ResourceView.tsx'
import { StatCard } from '../../components/ui/StatCard.tsx'
import { formatNumber } from '../../lib/format.ts'
import {
  filamentBars,
  lowStockBars,
  openOrdersCount,
  orderSegments,
  productionSummary,
  upcomingShipments,
} from './dashboard-metrics.ts'
import { UpcomingShipments } from './UpcomingShipments.tsx'
import { useDashboard, type DashboardData } from './useDashboard.ts'

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

function DashboardContent({ data }: { data: DashboardData }) {
  const production = productionSummary(data.jobs)
  const overdue = data.overdueCount
  const stockBars = lowStockBars(data.inventory)
  const filament = filamentBars(data.materials)

  return (
    <div className="dashboard-grid">
      <div className="stats-row span-3">
        <StatCard icon="cart" tone="accent" label="Pedidos em aberto" value={formatNumber(openOrdersCount(data.totals))}
          hint={overdue > 0 ? `${overdue} com prazo vencido` : 'Nenhum atrasado'} href="#/pedidos" />
        <StatCard icon="clock" tone="warning" label="Aguardando estoque" value={formatNumber(data.totals.awaiting_stock)}
          hint={`${data.totals.pending_mapping} com SKU pendente`} href="#/pedidos" />
        <StatCard icon="printer" tone="info" label="Na fila de produção" value={formatNumber(production.pieces)}
          hint={production.blocked > 0 ? `${production.blocked} bloqueados por cor` : `${production.printing} imprimindo`} href="#/producao" />
        <StatCard icon="truck" tone="success" label="Prontos para envio" value={formatNumber(data.totals.ready)}
          hint={`${formatNumber(data.totals.shipped)} já enviados`} href="#/expedicao" />
      </div>

      <Card title="Pedidos por situação" subtitle="Somente pedidos em aberto">
        <DonutChart segments={orderSegments(data.totals)} centerValue={formatNumber(openOrdersCount(data.totals))} centerLabel="em aberto" />
      </Card>

      <Card title="Próximos envios" subtitle="Prazo mais próximo primeiro" span={2}>
        <UpcomingShipments orders={upcomingShipments(data.openOrders)} />
      </Card>

      <Card title="Peças prontas" subtitle="Menor saldo livre primeiro" span={2}>
        {stockBars.length ? <BarList items={stockBars} /> : <EmptyState icon="box" text="Nenhum produto ativo." />}
      </Card>

      <Card title="Filamento" subtitle="Gramas livres por cor">
        {filament.length ? <BarList items={filament} /> : <EmptyState icon="spool" text="Nenhum material cadastrado." />}
      </Card>
    </div>
  )
}
