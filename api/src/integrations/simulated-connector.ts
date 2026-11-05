import {
  ConnectorError,
  type ConnectorFailure,
  type ExternalOrder,
  type ExternalShipment,
  type MarketplaceConnector,
  type OrderPage,
} from "./connector.js"

/**
 * Fixtures fictícias com os três casos do plano: pedido normal, SKU não mapeado e item sem estoque.
 * Os SKUs externos só viram produtos depois de mapeados em /integrations/sku-mappings.
 */
const SIMULATOR_FIXTURES: ExternalOrder[] = [
  {
    externalOrderId: "SIM-1001",
    status: "paid",
    orderedAt: "2026-11-01T10:00:00-03:00",
    updatedAt: "2026-11-01T10:05:00-03:00",
    shipBy: "2026-11-05T18:00:00-03:00",
    items: [{ externalSku: "SIM-CUBO-AZUL", quantity: 1, unitPriceCents: 1500 }],
  },
  {
    externalOrderId: "SIM-1002",
    status: "paid",
    orderedAt: "2026-11-01T11:00:00-03:00",
    updatedAt: "2026-11-01T11:02:00-03:00",
    shipBy: "2026-11-06T18:00:00-03:00",
    items: [{ externalSku: "SIM-SKU-DESCONHECIDO", quantity: 1, unitPriceCents: 2500 }],
  },
  {
    externalOrderId: "SIM-1003",
    status: "paid",
    orderedAt: "2026-11-01T12:00:00-03:00",
    updatedAt: "2026-11-01T12:01:00-03:00",
    shipBy: null,
    items: [{ externalSku: "SIM-VASO-ROSA", quantity: 3, unitPriceCents: 4200 }],
  },
]

export type SimulatedConnectorOptions = {
  orders?: ExternalOrder[]
  pageSize?: number
  /** Falhas programadas por número da chamada (1, 2, 3…), para testar retentativa e retomada. */
  failures?: Record<number, ConnectorFailure>
  /** Chamadas que nunca respondem (para testar timeout). */
  hangOnCalls?: number[]
}

/** Adapter simulado: implementa o mesmo contrato que um conector real implementaria. */
export class SimulatedConnector implements MarketplaceConnector {
  readonly provider = "simulator" as const
  private calls = 0
  private readonly orders: ExternalOrder[]
  private readonly pageSize: number

  constructor(private readonly options: SimulatedConnectorOptions = {}) {
    this.orders = options.orders ?? SIMULATOR_FIXTURES
    this.pageSize = options.pageSize ?? 2
  }

  get callCount(): number {
    return this.calls
  }

  private async simulateNetwork(): Promise<void> {
    this.calls += 1
    if (this.options.hangOnCalls?.includes(this.calls)) await new Promise(() => {})
    const failure = this.options.failures?.[this.calls]
    if (failure === "rate_limited") throw new ConnectorError("rate_limited", "429 Too Many Requests", 1)
    if (failure) throw new ConnectorError(failure, `Falha simulada: ${failure}`)
  }

  async listOrders(cursor: string | null): Promise<OrderPage> {
    await this.simulateNetwork()
    const start = cursor === null ? 0 : Number(cursor)
    if (!Number.isInteger(start) || start < 0) throw new ConnectorError("not_found", "Cursor inválido")
    const page = this.orders.slice(start, start + this.pageSize)
    const next = start + this.pageSize
    return {
      orders: page.map((order) => ({ externalOrderId: order.externalOrderId, updatedAt: order.updatedAt })),
      nextCursor: next < this.orders.length ? String(next) : null,
    }
  }

  async fetchOrder(externalOrderId: string): Promise<ExternalOrder> {
    await this.simulateNetwork()
    const order = this.orders.find((item) => item.externalOrderId === externalOrderId)
    if (!order) throw new ConnectorError("not_found", `Pedido ${externalOrderId} não encontrado`)
    return structuredClone(order)
  }

  async fetchShipment(externalOrderId: string): Promise<ExternalShipment> {
    const order = await this.fetchOrder(externalOrderId)
    return { externalOrderId, status: order.status, updatedAt: order.updatedAt }
  }
}
