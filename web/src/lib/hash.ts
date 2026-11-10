// Rota no hash da URL: "#/pedidos/<id>?status=ready&page=2". Funções puras (testadas sem navegador).

export type HashRoute = { path: string; id: string | null; query: Record<string, string> }

export function parseHash(hash: string): HashRoute {
  const text = hash.replace(/^#\/?/, '')
  const [pathPart, queryPart = ''] = text.split('?', 2)
  const [path = '', id = ''] = pathPart.split('/')
  const query: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(queryPart)) if (value) query[key] = value
  return { path, id: id || null, query }
}

type HashInput = { path: string; id?: string | null; query?: Record<string, string | number | null | undefined> }

/** Monta o hash omitindo valores vazios; "page=1" também é omitido por ser o padrão. */
export function buildHash({ path, id, query = {} }: HashInput): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '' || (key === 'page' && Number(value) === 1)) continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return `#/${path}${id ? `/${id}` : ''}${text ? `?${text}` : ''}`
}

/** Número de página da query (>= 1). */
export function pageFromQuery(query: Record<string, string>): number {
  const page = Number(query.page)
  return Number.isInteger(page) && page >= 1 ? page : 1
}
