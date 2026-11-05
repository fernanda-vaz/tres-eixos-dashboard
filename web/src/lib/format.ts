const STORE_TIME_ZONE = 'America/Sao_Paulo'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const integer = new Intl.NumberFormat('pt-BR')
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: STORE_TIME_ZONE })
const dayMonth = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: STORE_TIME_ZONE })

export function formatCents(cents: number): string {
  return money.format(cents / 100)
}

export function formatNumber(value: number): string {
  return integer.format(value)
}

/** A API guarda instantes em UTC; o painel mostra no fuso da loja. */
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : '—'
}

export function formatDayMonth(iso: string | null | undefined): string {
  return iso ? dayMonth.format(new Date(iso)) : '—'
}

/** "12.500" → "12,5 g" */
export function formatGrams(grams: string): string {
  return `${Number(grams).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} g`
}

/** Dias até o prazo (negativo = atrasado). null quando não há prazo. */
export function daysUntil(iso: string | null, now = new Date()): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000)
}

/** Iniciais das duas primeiras palavras, ignorando pontuação: "Fernanda (teste)" → "FT". */
export function initials(name: string): string {
  const words = name.match(/\p{L}+/gu) ?? []
  return words.slice(0, 2).map((word) => word[0].toUpperCase()).join('') || '?'
}
