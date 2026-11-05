// Cliente HTTP do painel. Nenhum segredo fica no frontend: a sessão é um cookie HttpOnly
// e o token CSRF vive só na memória desta aba.

export class ApiError extends Error {
  readonly status: number
  readonly details: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
}

let csrfToken: string | null = null
let handleUnauthorized: () => void = () => {}

export function setCsrfToken(token: string | null): void {
  csrfToken = token
}

/** Chamado quando uma rota de negócio responde 401 (sessão expirada). */
export function onUnauthorized(handler: () => void): void {
  handleUnauthorized = handler
}

function buildHeaders(method: string, options: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken
  return headers
}

function parseJson(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function send(path: string, method: string, options: RequestOptions): Promise<Response> {
  try {
    return await fetch(`/api${path}`, {
      method,
      headers: buildHeaders(method, options),
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError(0, 'Não foi possível falar com a API. Verifique se o servidor está no ar.')
  }
}

/** Faz a requisição para /api{path} e devolve o JSON, ou lança ApiError com a mensagem da API. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const response = await send(path, method, options)
  const data = parseJson(await response.text())
  if (response.ok) return data as T

  if (response.status === 401 && !path.startsWith('/auth/')) handleUnauthorized()
  const body = (data ?? {}) as { error?: string; details?: unknown }
  throw new ApiError(response.status, body.error ?? `Erro ${response.status}`, body.details)
}

/** Monta a query string ignorando valores vazios. */
export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}
