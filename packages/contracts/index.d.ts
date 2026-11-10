// Contratos HTTP do Três Eixos: o que a API devolve e o que o painel espera, na forma em que
// trafega em JSON. Datas são texto ISO; dinheiro em centavos inteiros; gramas em texto decimal.
//
// Fonte única: a API prova em api/test/contracts.types.ts que cada tipo interno serializa
// exatamente para o contrato daqui; o painel importa estes tipos direto. docs/api.md é exemplo,
// não contrato. Só tipos: este pacote não tem código em tempo de execução.

// ---------- Erros e paginação ----------

/** Códigos estáveis de erro. O painel decide por eles, nunca pelo texto da mensagem. */
export type ErrorCode =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "sku_taken"
  | "idempotency_key_reused"
  | "insufficient_stock"
  | "insufficient_material"
  | "rate_limited"
  | "payload_too_large"
  | "invalid_json"
  | "csrf"
  | "concurrency"
  | "internal"

/** Corpo de toda resposta de erro (status 4xx/5xx). */
export type ApiErrorBody = { error: string; code: ErrorCode; details?: unknown }

export type Page<T> = { items: T[]; page: number; pageSize: number; total: number }

// ---------- Sessão ----------

export type User = { id: string; email: string; name: string }

export type Product = { id: string; sku: string; name: string; priceCents: number; active: boolean }

export type NewProduct = { sku: string; name: string; priceCents: number }

export type InventoryItem = {
  productId: string
  sku: string
  name: string
  active: boolean
  priceCents: number
  physical: number
  reserved: number
  available: number
  openProduction: number
}

/** Saldo de um produto depois de um ajuste de estoque. */
export type StockLevel = { productId: string; physical: number; reserved: number; available: number }

export type Material = {
  id: string
  name: string
  color: string
  physicalGrams: string
  reservedGrams: string
  availableGrams: string
  costPerKgCents: number
  active: boolean
}

export type RecipeLine = { materialId: string; name: string; color: string; gramsPerUnit: string }

export type OrderStatus = "pending_mapping" | "awaiting_stock" | "reserved" | "ready" | "shipped" | "cancelled"

export type OrderSummary = {
  id: string
  channelProvider: string
  externalOrderId: string
  status: OrderStatus
  externalStatus: string | null
  orderedAt: string
  shipBy: string | null
  itemCount: number
  totalCents: number
}

export type OrderItem = {
  id: string
  lineNumber: number
  productId: string | null
  sku: string | null
  externalSku: string | null
  quantity: number
  unitPriceCents: number
  reservation: { id: string; status: string; quantity: number } | null
}

export type Order = {
  id: string
  channel: { id: string; provider: string; name: string }
  externalOrderId: string
  status: OrderStatus
  externalStatus: string | null
  orderedAt: string
  shipBy: string | null
  createdAt: string
  cancelledAt: string | null
  cancelReason: string | null
  totalCents: number
  items: OrderItem[]
  shipment: { readyAt: string | null; labelPrintedAt: string | null; dispatchedAt: string | null } | null
  productionJobs: { id: string; orderItemId: string | null; status: string; quantity: number }[]
  history: { fromStatus: string | null; toStatus: string; reason: string; createdAt: string }[]
}

export type NewOrder = {
  externalOrderId?: string
  shipBy?: string
  items: { sku: string; quantity: number }[]
}

export type MaterialNeed = {
  materialId: string
  name: string
  color: string
  requiredGrams: string
  availableGrams: string
}

export type JobStatus = "queued" | "printing" | "on_hold" | "done" | "cancelled"

/** Por que o job existe: atender um pedido ou repor estoque. */
export type JobPurpose = "order" | "stock"

export type ProductionJob = {
  id: string
  status: JobStatus
  purpose: JobPurpose
  quantity: number
  priority: number
  priorityReason: string | null
  holdReason: string | null
  estimatedMinutes: number | null
  product: { id: string; sku: string; name: string }
  order: { id: string; externalOrderId: string; status: string; shipBy: string | null; orderedAt: string } | null
  materials: MaterialNeed[]
  blockedBy: MaterialNeed[]
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export type PendingSku = { channelId: string; externalSku: string; pendingOrders: number; firstSeenAt: string }

export type IntegrationError = { eventId: string; attempts: number; lastError: string | null; receivedAt: string; payload: unknown }

export type ImportOutcome = "created" | "updated" | "unchanged" | "duplicate" | "ignored" | "failed"

export type SyncResult = {
  status: "completed" | "interrupted"
  cursor: string | null
  created: number
  updated: number
  unchanged: number
  duplicate: number
  ignored: number
  failed: number
  results: { externalOrderId: string; outcome: ImportOutcome }[]
  error?: string
}

/** Agregado dono de um evento do outbox. */
export type AggregateType = "order" | "production_job"

/** Evento do outbox que esgotou as tentativas de publicação. */
export type DeadEvent = {
  id: string
  topic: string
  aggregateType: AggregateType
  aggregateId: string
  payload: unknown
  attempts: number
  lastError: string | null
  createdAt: string
  deadAt: string | null
}

// ---------- Visão geral ----------

export type DashboardSummary = {
  orders: { byStatus: Record<OrderStatus, number>; overdue: number }
  production: { queued: number; printing: number; onHold: number; blocked: number; pieces: number }
  upcomingShipments: OrderSummary[]
  lowStock: InventoryItem[]
  lowFilament: Material[]
}

// ---------- Precificação ----------

export type PricingSettings = {
  energyCentsPerKwh: number
  printerPowerWatts: number
  printerPriceCents: number
  printerLifetimeHours: number
  laborCentsPerHour: number
  failureRatePercent: number
  taxRatePercent: number
}

export type PricingChannel = { id: string; name: string; feePercent: number; fixedFeeCents: number; active: boolean }

export type CostSheet = {
  printMinutes: number
  purgeGrams: string
  laborMinutes: number
  packagingCents: number
  extraCents: number
  targetMarginPercent: number
}

export type CostBreakdown = {
  filamentCents: number
  purgeCents: number
  energyCents: number
  depreciationCents: number
  failureCents: number
  laborCents: number
  packagingCents: number
  extraCents: number
  unitCostCents: number
}

export type PriceResult = { priceCents: number; feeCents: number; taxCents: number; profitCents: number; marginPercent: number }

export type ProductPricing = {
  product: { id: string; sku: string; name: string; priceCents: number }
  sheet: CostSheet & { saved: boolean }
  materials: { materialId: string; name: string; color: string; grams: string; costPerKgCents: number; costCents: number }[]
  breakdown: CostBreakdown
  channels: { channel: PricingChannel; suggested: PriceResult | null; atCurrentPrice: PriceResult | null }[]
  warnings: string[]
}

export type ProductCost = {
  productId: string
  sku: string
  name: string
  priceCents: number
  unitCostCents: number
  hasCostSheet: boolean
  margins: { channelId: string; channelName: string; marginPercent: number | null }[]
}
