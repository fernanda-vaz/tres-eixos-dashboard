/** Chave nova por tentativa de criação: reenviar o mesmo formulário não duplica a operação. */
export function newIdempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}
