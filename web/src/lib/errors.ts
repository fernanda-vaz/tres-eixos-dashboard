import { ApiError } from '../api/client.ts'

/** Mensagem para a usuária, com explicação extra para os casos mais comuns. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : 'Erro inesperado.'
  if (error.status === 403) return 'Sua sessão expirou ou o token de segurança mudou. Recarregue a página.'
  if (error.status === 409 && error.message === 'SKU já cadastrado') {
    return 'Esse SKU já existe. Cada produto precisa de um SKU diferente.'
  }
  return error.message
}
