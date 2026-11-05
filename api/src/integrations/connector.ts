import type { ExternalStatus } from "../orders/order-rules.js"

export type ExternalOrderItem = { externalSku: string; quantity: number; unitPriceCents: number }

/** Pedido como chega do provedor, já reduzido ao mínimo: sem nome, endereço ou documento do comprador. */
export type ExternalOrder = {
  externalOrderId: string
  status: ExternalStatus
  updatedAt: string
  orderedAt: string
  shipBy: string | null
  items: ExternalOrderItem[]
}

export type ExternalShipment = { externalOrderId: string; status: ExternalStatus; updatedAt: string }

export type OrderPage = {
  orders: { externalOrderId: string; updatedAt: string }[]
  nextCursor: string | null
}

/** Contrato comum dos conectores. Cada provedor real terá seu adapter; o primeiro é o simulador. */
export interface MarketplaceConnector {
  readonly provider: "simulator"
  listOrders(cursor: string | null): Promise<OrderPage>
  fetchOrder(externalOrderId: string): Promise<ExternalOrder>
  fetchShipment(externalOrderId: string): Promise<ExternalShipment>
}

export type ConnectorFailure = "timeout" | "rate_limited" | "server_error" | "not_found"

export class ConnectorError extends Error {
  constructor(
    readonly kind: ConnectorFailure,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = "ConnectorError"
  }

  get retryable(): boolean {
    return this.kind !== "not_found"
  }
}

/** Limita o tempo de uma chamada ao provedor: uma resposta que nunca chega vira erro de timeout. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ConnectorError("timeout", `Sem resposta em ${ms} ms`)), ms)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

export type RetryOptions = { attempts: number; baseDelayMs: number; timeoutMs: number }

/**
 * Chama o provedor com timeout e novas tentativas com espera exponencial para falhas
 * temporárias (timeout, 429, 500). Respeita retryAfterMs quando o provedor informa.
 */
export async function callWithRetry<T>(call: () => Promise<T>, options: RetryOptions): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTimeout(call(), options.timeoutMs)
    } catch (error) {
      const retryable = error instanceof ConnectorError && error.retryable
      if (!retryable || attempt >= options.attempts) throw error
      const wait = error.retryAfterMs ?? options.baseDelayMs * 2 ** (attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}
