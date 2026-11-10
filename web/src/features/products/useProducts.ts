import { useState } from 'react'
import { inventoryApi, productsApi } from '../../api/endpoints.ts'
import type { InventoryItem } from '../../api/types.ts'
import { useAction } from '../../hooks/useAction.ts'
import { useResource } from '../../hooks/useResource.ts'

/** Linha do catálogo: a listagem de estoque já traz produto, preço e saldos juntos. */
export type ProductRow = InventoryItem

const PAGE_SIZE = 20

/** Lista paginada de produtos com saldo de estoque, busca e ativar/inativar: uma requisição por página. */
export function useProducts() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const products = useResource(() => inventoryApi.list({ page, pageSize: PAGE_SIZE, search }), `${page}|${search}`)
  const action = useAction()

  function applySearch(text: string) {
    setPage(1)
    setSearch(text.trim())
  }

  async function toggleActive(product: ProductRow) {
    const done = await action.run(
      () => productsApi.update(product.productId, { active: !product.active }),
      product.active ? `${product.sku} inativado.` : `${product.sku} reativado.`,
    )
    if (done) products.reload()
  }

  return { products, search, applySearch, setPage, toggleActive, action }
}
