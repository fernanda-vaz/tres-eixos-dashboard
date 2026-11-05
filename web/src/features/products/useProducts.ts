import { useState } from 'react'
import { inventoryApi, productsApi } from '../../api/endpoints.ts'
import type { InventoryItem, Product } from '../../api/types.ts'
import { useAction } from '../../hooks/useAction.ts'
import { useResource } from '../../hooks/useResource.ts'

export type ProductRow = Product & { stock: InventoryItem | undefined }

const PAGE_SIZE = 20

async function loadProducts(page: number, search: string) {
  const [products, inventory] = await Promise.all([
    productsApi.list({ page, pageSize: PAGE_SIZE, search }),
    inventoryApi.list({ pageSize: 100, search }),
  ])
  const stock = new Map(inventory.items.map((item) => [item.productId, item]))
  const rows: ProductRow[] = products.items.map((product) => ({ ...product, stock: stock.get(product.id) }))
  return { ...products, items: rows }
}

/** Lista paginada de produtos com saldo de estoque, busca e ativar/inativar. */
export function useProducts() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const products = useResource(() => loadProducts(page, search), `${page}|${search}`)
  const action = useAction()

  function applySearch(text: string) {
    setPage(1)
    setSearch(text.trim())
  }

  async function toggleActive(product: Product) {
    const done = await action.run(
      () => productsApi.update(product.id, { active: !product.active }),
      product.active ? `${product.sku} inativado.` : `${product.sku} reativado.`,
    )
    if (done) products.reload()
  }

  return { products, search, applySearch, setPage, toggleActive, action }
}
