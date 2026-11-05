import { query, request, setCsrfToken } from './client.ts'
import type {
  IntegrationError,
  InventoryItem,
  JobStatus,
  Material,
  NewOrder,
  NewProduct,
  Order,
  OrderStatus,
  OrderSummary,
  Page,
  PricingChannel,
  PricingSettings,
  ProductCost,
  ProductPricing,
  CostSheet,
  PendingSku,
  Product,
  ProductionJob,
  RecipeLine,
  StockLevel,
  SyncResult,
  User,
} from './types.ts'

// Uma função por rota da API. Componentes e hooks nunca montam URLs nem chamam fetch diretamente.

type Paging = { page?: number; pageSize?: number }

export const authApi = {
  /** Sessão atual; renova o token CSRF guardado em memória. */
  async me(): Promise<User> {
    const result = await request<{ user: User; csrfToken: string }>('/auth/me')
    setCsrfToken(result.csrfToken)
    return result.user
  },
  /** O próprio login é protegido contra CSRF: primeiro um token, depois as credenciais. */
  async login(email: string, password: string): Promise<User> {
    const { csrfToken } = await request<{ csrfToken: string }>('/auth/csrf')
    setCsrfToken(csrfToken)
    const result = await request<{ user: User; csrfToken: string }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    setCsrfToken(result.csrfToken)
    return result.user
  },
  async logout(): Promise<void> {
    try {
      await request('/auth/logout', { method: 'POST' })
    } finally {
      setCsrfToken(null)
    }
  },
}

export const productsApi = {
  list: (params: Paging & { search?: string; active?: boolean } = {}) =>
    request<Page<Product>>(`/products${query(params)}`),
  create: (product: NewProduct) => request<Product>('/products', { method: 'POST', body: product }),
  update: (id: string, patch: Partial<Pick<Product, 'name' | 'priceCents' | 'active'>>) =>
    request<Product>(`/products/${id}`, { method: 'PATCH', body: patch }),
}

export const inventoryApi = {
  list: (params: Paging & { search?: string } = {}) => request<Page<InventoryItem>>(`/inventory${query(params)}`),
  adjust: (input: { productId: string; delta: number; reason: string }, idempotencyKey: string) =>
    request<StockLevel>('/inventory/adjustments', {
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
}

export const materialsApi = {
  list: (params: Paging & { color?: string } = {}) => request<Page<Material>>(`/materials${query(params)}`),
  create: (input: { name: string; color: string; costPerKgCents?: number }) =>
    request<Material>('/materials', { method: 'POST', body: input }),
  setCostPerKg: (id: string, costPerKgCents: number) =>
    request<Material>(`/materials/${id}`, { method: 'PATCH', body: { costPerKgCents } }),
  adjust: (id: string, input: { gramsDelta: string; reason: string }) =>
    request<Material>(`/materials/${id}/adjustments`, { method: 'POST', body: input }),
  recipe: (productId: string) => request<RecipeLine[]>(`/products/${productId}/materials`),
  setRecipeLine: (productId: string, materialId: string, gramsPerUnit: string) =>
    request<RecipeLine[]>(`/products/${productId}/materials/${materialId}`, { method: 'PUT', body: { gramsPerUnit } }),
  removeRecipeLine: (productId: string, materialId: string) =>
    request<RecipeLine[]>(`/products/${productId}/materials/${materialId}`, { method: 'DELETE' }),
}

export const ordersApi = {
  list: (params: Paging & { status?: OrderStatus; overdue?: boolean } = {}) => request<Page<OrderSummary>>(`/orders${query(params)}`),
  get: (id: string) => request<Order>(`/orders/${id}`),
  create: (order: NewOrder, idempotencyKey: string) =>
    request<Order>('/orders', { method: 'POST', body: order, headers: { 'Idempotency-Key': idempotencyKey } }),
  cancel: (id: string, reason?: string) =>
    request<Order>(`/orders/${id}/cancel`, { method: 'POST', body: reason ? { reason } : {} }),
  retryAllocation: (id: string) => request<Order>(`/orders/${id}/allocation`, { method: 'POST' }),
  markReady: (id: string) => request<Order>(`/orders/${id}/ready`, { method: 'POST' }),
  markLabelPrinted: (id: string) => request<Order>(`/orders/${id}/label`, { method: 'POST' }),
  dispatch: (id: string) => request<Order>(`/orders/${id}/dispatch`, { method: 'POST' }),
}

export type HeldJobDecision = 'cancel' | 'continue_for_stock'

export const productionApi = {
  list: (params: Paging & { status?: JobStatus; color?: string } = {}) =>
    request<Page<ProductionJob>>(`/production/jobs${query(params)}`),
  start: (id: string) => request<ProductionJob>(`/production/jobs/${id}/start`, { method: 'POST' }),
  complete: (id: string) => request<ProductionJob>(`/production/jobs/${id}/complete`, { method: 'POST' }),
  decide: (id: string, action: HeldJobDecision, reason: string) =>
    request<ProductionJob>(`/production/jobs/${id}/decision`, { method: 'POST', body: { action, reason } }),
  setPriority: (id: string, priority: number, reason: string) =>
    request<ProductionJob>(`/production/jobs/${id}/priority`, { method: 'PUT', body: { priority, reason } }),
}

export const integrationsApi = {
  syncSimulator: () => request<SyncResult>('/integrations/simulator/sync', { method: 'POST' }),
  pendingSkus: () => request<PendingSku[]>('/integrations/pending-skus'),
  errors: () => request<IntegrationError[]>('/integrations/errors'),
  mapSku: (input: { channelId: string; externalSku: string; productId: string }) =>
    request<{ ordersUpdated: number }>('/integrations/sku-mappings', { method: 'PUT', body: input }),
}

export const pricingApi = {
  settings: () => request<PricingSettings>('/pricing/settings'),
  saveSettings: (settings: PricingSettings) => request<PricingSettings>('/pricing/settings', { method: 'PUT', body: settings }),
  channels: () => request<PricingChannel[]>('/pricing/channels'),
  createChannel: (channel: Omit<PricingChannel, 'id'>) =>
    request<PricingChannel>('/pricing/channels', { method: 'POST', body: channel }),
  updateChannel: (id: string, patch: Partial<Omit<PricingChannel, 'id'>>) =>
    request<PricingChannel>(`/pricing/channels/${id}`, { method: 'PATCH', body: patch }),
  productCosts: (params: Paging = {}) => request<Page<ProductCost>>(`/pricing/products${query(params)}`),
  productPricing: (productId: string) => request<ProductPricing>(`/products/${productId}/pricing`),
  /** Calcula com a ficha informada sem salvar (recalcular enquanto se digita). */
  preview: (productId: string, sheet: CostSheet) =>
    request<ProductPricing>(`/products/${productId}/pricing/preview`, { method: 'POST', body: sheet }),
  saveCostSheet: (productId: string, sheet: CostSheet) =>
    request<ProductPricing>(`/products/${productId}/cost-sheet`, { method: 'PUT', body: sheet }),
}
