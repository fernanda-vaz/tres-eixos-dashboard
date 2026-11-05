import type { JobStatus, OrderStatus } from '../api/types.ts'

/** Tons visuais do design system (mapeados em styles/components.css). */
export type Tone = 'success' | 'warning' | 'info' | 'accent' | 'danger' | 'neutral'

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  pending_mapping: { label: 'SKU pendente', tone: 'danger' },
  awaiting_stock: { label: 'Aguardando estoque', tone: 'warning' },
  reserved: { label: 'Reservado', tone: 'info' },
  ready: { label: 'Pronto p/ envio', tone: 'accent' },
  shipped: { label: 'Enviado', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
}

export const JOB_STATUS: Record<JobStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Na fila', tone: 'info' },
  printing: { label: 'Imprimindo', tone: 'accent' },
  on_hold: { label: 'Em espera', tone: 'warning' },
  done: { label: 'Concluído', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
}

export const CHANNEL_LABEL: Record<string, string> = {
  manual: 'Manual',
  simulator: 'Simulador',
  mercado_livre: 'Mercado Livre',
  shopee: 'Shopee',
}

export function optionsFrom<T extends string>(map: Record<T, { label: string }>): { value: T; label: string }[] {
  return (Object.keys(map) as T[]).map((value) => ({ value, label: map[value].label }))
}
