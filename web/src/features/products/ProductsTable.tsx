import type { Product } from '../../api/types.ts'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { DataTable, type Column } from '../../components/ui/DataTable.tsx'
import { formatCents } from '../../lib/format.ts'
import type { ProductRow } from './useProducts.ts'

type ProductsTableProps = { rows: ProductRow[]; busy: boolean; onToggleActive: (product: Product) => void }

const stockCell = (value: number | undefined) => value ?? '—'

export function ProductsTable({ rows, busy, onToggleActive }: ProductsTableProps) {
  const columns: Column<ProductRow>[] = [
    { key: 'sku', header: 'SKU', render: (row) => <code>{row.sku}</code> },
    { key: 'name', header: 'Nome', render: (row) => row.name },
    { key: 'price', header: 'Preço', align: 'right', render: (row) => formatCents(row.priceCents) },
    { key: 'physical', header: 'Físico', align: 'right', render: (row) => stockCell(row.stock?.physical) },
    { key: 'reserved', header: 'Reservado', align: 'right', render: (row) => stockCell(row.stock?.reserved) },
    { key: 'available', header: 'Livre', align: 'right', render: (row) => <strong>{stockCell(row.stock?.available)}</strong> },
    { key: 'production', header: 'Em produção', align: 'right', render: (row) => stockCell(row.stock?.openProduction) },
    {
      key: 'status',
      header: 'Situação',
      render: (row) => <Badge tone={row.active ? 'success' : 'neutral'}>{row.active ? 'Ativo' : 'Inativo'}</Badge>,
    },
    {
      key: 'actions',
      header: 'Ações',
      hideHeader: true,
      render: (row) => (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onToggleActive(row)}>
          {row.active ? 'Inativar' : 'Reativar'}
        </Button>
      ),
    },
  ]
  return <DataTable caption="Produtos e estoque" columns={columns} rows={rows} rowKey={(row) => row.id} />
}
