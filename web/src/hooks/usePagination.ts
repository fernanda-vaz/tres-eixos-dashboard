import { useCallback, useState } from 'react'

/** Página atual + filtros; trocar qualquer filtro volta para a primeira página. */
export function usePagination<F extends Record<string, string>>(initialFilters: F) {
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<F>(initialFilters)

  const setFilter = useCallback(<K extends keyof F>(name: K, value: F[K]) => {
    setFilters((current) => ({ ...current, [name]: value }))
    setPage(1)
  }, [])

  return { page, setPage, filters, setFilter }
}
