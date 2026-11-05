export const ORDER_STATUSES = [
  "pending_mapping",
  "awaiting_stock",
  "reserved",
  "ready",
  "shipped",
  "cancelled",
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** Estados em que a alocação de estoque ainda decide o status do pedido. */
export const ALLOCATING_STATUSES: readonly OrderStatus[] = ["pending_mapping", "awaiting_stock", "reserved"]

/**
 * Status interno derivado dos itens: algum SKU sem correspondência → pending_mapping;
 * todos reservados → reserved; caso contrário, aguardando estoque/produção.
 */
export function deriveAllocationStatus(items: { mapped: boolean; reserved: boolean }[]): OrderStatus {
  if (items.some((item) => !item.mapped)) return "pending_mapping"
  return items.length > 0 && items.every((item) => item.reserved) ? "reserved" : "awaiting_stock"
}

// Status externos do simulador, na ordem do ciclo de vida. cancelled é terminal.
export const EXTERNAL_STATUSES = ["new", "paid", "ready_to_ship", "shipped", "delivered", "cancelled"] as const
export type ExternalStatus = (typeof EXTERNAL_STATUSES)[number]

const RANK: Record<ExternalStatus, number> = {
  new: 1,
  paid: 2,
  ready_to_ship: 3,
  shipped: 4,
  delivered: 5,
  cancelled: 9,
}

export function externalStatusRank(status: ExternalStatus): number {
  return RANK[status]
}

/**
 * Decide se um status externo recebido deve ser aplicado. Eventos podem chegar fora de ordem:
 * um status mais antigo (data menor) ou que regride no ciclo (shipped → new) é ignorado.
 */
export function shouldApplyExternalStatus(
  current: { status: ExternalStatus; updatedAt: Date } | null,
  incoming: { status: ExternalStatus; updatedAt: Date },
): boolean {
  if (!current) return true
  if (incoming.updatedAt.getTime() < current.updatedAt.getTime()) return false
  if (incoming.status === current.status) return false
  return RANK[incoming.status] > RANK[current.status]
}
