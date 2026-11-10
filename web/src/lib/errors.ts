import { ApiError } from '../api/client.ts'

/** Mensagem para a usuária, decidida pelo código do erro (estável), com explicação extra nos casos comuns. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : 'Erro inesperado.'
  switch (error.code) {
    case 'csrf':
      return 'Sua sessão expirou ou o token de segurança mudou. Recarregue a página.'
    case 'sku_taken':
      return 'Esse SKU já existe. Cada produto precisa de um SKU diferente.'
    case 'concurrency':
      return 'Outra operação alterou os mesmos dados ao mesmo tempo. Tente de novo.'
    case 'rate_limited':
      return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
    case 'payload_too_large':
      return 'Os dados enviados são grandes demais para uma única requisição.'
    default:
      return error.message
  }
}
