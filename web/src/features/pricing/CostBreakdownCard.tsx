import type { ProductPricing } from '../../api/types.ts'
import { BarList } from '../../components/ui/BarList.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { EmptyState } from '../../components/ui/EmptyState.tsx'
import { formatCents } from '../../lib/format.ts'
import { breakdownBars } from './pricing-view.ts'

type CostBreakdownCardProps = { pricing: ProductPricing; calculating: boolean }

export function CostBreakdownCard({ pricing, calculating }: CostBreakdownCardProps) {
  const bars = breakdownBars(pricing.breakdown)
  return (
    <Card title="Custo por peça" subtitle="Quanto custa produzir uma unidade vendável">
      <div className="cost-total" aria-live="polite" aria-busy={calculating}>
        <span className="muted">Custo total</span>
        <strong>{formatCents(pricing.breakdown.unitCostCents)}</strong>
      </div>
      {bars.length ? <BarList items={bars} /> : <EmptyState icon="spool" text="Sem custos informados ainda." />}
    </Card>
  )
}
