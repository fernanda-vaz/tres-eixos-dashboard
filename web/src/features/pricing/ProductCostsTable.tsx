import type { ProductCost } from '../../api/types.ts'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { DataTable, type Column } from '../../components/ui/DataTable.tsx'
import { formatCents } from '../../lib/format.ts'
import { formatPercent, marginTone } from './pricing-view.ts'

type ProductCostsTableProps = { rows: ProductCost[]; targetMarginPercent: number; onOpen: (productId: string) => void }

export function ProductCostsTable({ rows, targetMarginPercent, onOpen }: ProductCostsTableProps) {
  const channelNames = rows[0]?.margins.map((margin) => margin.channelName) ?? []
  const columns: Column<ProductCost>[] = [
    { key: 'sku', header: 'Produto', render: (row) => <div className="cell-stack"><code>{row.sku}</code><small className="muted">{row.name}</small></div> },
    {
      key: 'cost',
      header: 'Custo',
      align: 'right',
      render: (row) => (row.hasCostSheet ? formatCents(row.unitCostCents) : <Badge tone="warning">sem ficha</Badge>),
    },
    { key: 'price', header: 'Preço atual', align: 'right', render: (row) => formatCents(row.priceCents) },
    ...channelNames.map((name, index): Column<ProductCost> => ({
      key: `margin-${index}`,
      header: `Margem ${name}`,
      render: (row) => {
        // Sem ficha o custo só tem o filamento: a margem pareceria maior do que é.
        const margin = row.hasCostSheet ? (row.margins[index]?.marginPercent ?? null) : null
        return <Badge tone={marginTone(margin, targetMarginPercent)}>{formatPercent(margin)}</Badge>
      },
    })),
    {
      key: 'open',
      header: 'Calcular',
      hideHeader: true,
      render: (row) => <Button size="sm" variant="ghost" icon="chevronRight" onClick={() => onOpen(row.productId)}>Calcular</Button>,
    },
  ]
  return <DataTable caption="Custo e margem por produto" columns={columns} rows={rows} rowKey={(row) => row.productId} />
}
