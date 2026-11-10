// Gramas trafegam como texto decimal ("12.5") e são comparados/somados em miligramas inteiros (BigInt):
// nenhuma regra de estoque ou de custo passa por ponto flutuante. Sem dependências: vale para qualquer módulo.

/** "12.5" → 12500n (miligramas). Aceita até 3 casas decimais e sinal negativo. */
export function gramsToMilli(grams: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(grams)
  if (!match) throw new Error(`Gramas inválidos: ${grams}`)
  const value = BigInt(match[2]) * 1000n + BigInt((match[3] ?? "").padEnd(3, "0"))
  return match[1] ? -value : value
}
