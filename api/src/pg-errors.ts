// Helpers para erros do driver pg. Sem conexão: podem ser usados em código e testes sem banco.

export function pgErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}

export function pgConstraint(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "constraint" in error && typeof error.constraint === "string"
    ? error.constraint
    : undefined
}
