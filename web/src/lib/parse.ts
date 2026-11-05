// Conversões de texto digitado para os formatos da API, sem ponto flutuante.

/** "15,90" ou "15.90" → 1590 centavos. null se inválido. */
export function parseReaisToCents(text: string): number | null {
  const normalized = text.trim().replace(/\s/g, '').replace(',', '.')
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(normalized)
  if (!match) return null
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}

/** "12,5" → "12.5" (até 3 casas). Com allowNegative, aceita "-12,5"; com allowZero, aceita "0". null se inválido. */
export function parseGrams(text: string, { allowNegative = false, allowZero = false } = {}): string | null {
  const value = text.trim().replace(',', '.')
  const negative = allowNegative && value.startsWith('-')
  const digits = negative ? value.slice(1) : value
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(digits)) return null
  if (Number(digits) === 0) return allowZero ? '0' : null
  return `${negative ? '-' : ''}${digits}`
}

/** Inteiro diferente de zero ("5", "-2"). null se inválido. */
export function parseNonZeroInteger(text: string): number | null {
  if (!/^-?\d{1,6}$/.test(text.trim())) return null
  const value = Number(text)
  return value === 0 ? null : value
}

/** Valor de <input type="datetime-local"> (horário do navegador) → ISO com fuso. */
export function localInputToIso(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function normalizeSku(text: string): string {
  return text.trim().toUpperCase()
}

/** "16,5" → 16.5 (até 2 casas, entre 0 e max). null se inválido. */
export function parsePercent(text: string, max = 100): number | null {
  const normalized = text.trim().replace(',', '.')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalized)) return null
  const value = Number(normalized)
  return value <= max ? value : null
}

/** Inteiro não negativo ("150"). null se inválido. */
export function parseWholeNumber(text: string, max = 1_000_000): number | null {
  if (!/^\d{1,9}$/.test(text.trim())) return null
  const value = Number(text)
  return value <= max ? value : null
}

/** 1590 → "15,90": valor em centavos para preencher um campo de reais. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

/** 16.5 → "16,5" para preencher um campo de percentual. */
export function percentToInput(value: number): string {
  return String(value).replace('.', ',')
}

/** "20.000" (gramas da API) → "20"; "12.500" → "12,5": para preencher um campo de gramas. */
export function gramsToInput(grams: string): string {
  return String(Number(grams)).replace('.', ',')
}
