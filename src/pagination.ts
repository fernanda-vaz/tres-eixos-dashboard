// Paginação das listagens: tipos neutros, sem dependência de HTTP nem de banco.

/** Página pedida pelo cliente, já validada (ver parsePagination em http/validation.ts). */
export type PageRequest = { page: number; pageSize: number; offset: number }

export type Page<T> = { items: T[]; page: number; pageSize: number; total: number }

export function toPage<T>(request: PageRequest, result: { items: T[]; total: number }): Page<T> {
  return { items: result.items, page: request.page, pageSize: request.pageSize, total: result.total }
}
