import { onStockIncreased } from "../inventory/stock-events.js"
import { setAllocationPort } from "../orders/allocation-port.js"
import { allocateOrder, allocateWaitingForProduct, releaseReservations } from "./allocation.js"

let registered = false

/**
 * Liga o fulfillment aos outros módulos. Chamado uma vez na composição (app.ts):
 * - pedidos chama a alocação pela porta que ele próprio declara;
 * - estoque e produção avisam "saldo subiu" e o fulfillment reserva para quem espera.
 */
export function registerFulfillment(): void {
  if (registered) return
  registered = true
  setAllocationPort({ allocateOrder, releaseReservations, allocateWaitingForProduct })
  onStockIncreased(allocateWaitingForProduct)
}
