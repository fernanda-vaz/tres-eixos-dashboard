import type { Page } from '../api/types.ts'

export const MAX_PAGE_SIZE = 100

/**
 * Percorre as páginas de uma listagem até o fim (ou até `maxPages`), para listas pequenas usadas
 * em seleções (ex.: filamentos). `truncated` avisa quando o teto foi atingido: nunca omita em silêncio.
 */
export async function collectAll<T>(
  load: (paging: { page: number; pageSize: number }) => Promise<Page<T>>,
  maxPages = 10,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = []
  for (let page = 1; page <= maxPages; page++) {
    const result = await load({ page, pageSize: MAX_PAGE_SIZE })
    items.push(...result.items)
    if (items.length >= result.total || result.items.length === 0) return { items, truncated: false }
  }
  return { items, truncated: true }
}
