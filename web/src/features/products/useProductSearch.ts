import { useState } from 'react'
import { productsApi } from '../../api/endpoints.ts'
import type { Product } from '@tres-eixos/contracts'
import { useDebouncedValue } from '../../hooks/useDebouncedValue.ts'
import { useResource } from '../../hooks/useResource.ts'

const RESULTS = 20
const SEARCH_DELAY_MS = 250

/**
 * Busca incremental de produtos ativos para seleções: no máximo RESULTS por vez e, quando há mais,
 * o aviso para refinar a busca. Substitui "carregar 100 e torcer para caber".
 */
export function useProductSearch() {
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim(), SEARCH_DELAY_MS)
  const results = useResource(
    () => productsApi.list({ search: debounced || undefined, active: true, pageSize: RESULTS }),
    `product-search|${debounced}`,
  )
  const items: Product[] = results.data?.items ?? []
  const total = results.data?.total ?? 0
  const hint = total > items.length ? `Mostrando ${items.length} de ${total}. Refine a busca para ver outros.` : undefined
  return { search, setSearch, items, hint, loading: results.loading, error: results.error }
}
