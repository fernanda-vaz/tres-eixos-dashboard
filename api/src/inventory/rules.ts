// Regras puras: avaliam números recebidos. Concorrência é resolvida no banco (UPDATE condicional e locks).

export function availableToReserve(physical: number, reserved: number): number {
  if (
    !Number.isSafeInteger(physical) || !Number.isSafeInteger(reserved) ||
    physical < 0 || reserved < 0 || reserved > physical
  ) {
    throw new Error("Saldo inválido")
  }
  return physical - reserved
}

export function canReserve(physical: number, reserved: number, quantity: number): boolean {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error("Quantidade deve ser inteira e positiva")
  }
  return availableToReserve(physical, reserved) >= quantity
}

/**
 * Quantas peças ainda faltam produzir para atender a demanda em espera de um produto,
 * considerando o que está livre na prateleira e o que já está na fila de produção.
 */
export function productionShortage(input: {
  waitingDemand: number
  available: number
  openProduction: number
}): number {
  return Math.max(0, input.waitingDemand - input.available - input.openProduction)
}

/** Um ajuste não pode deixar menos peças físicas do que as já reservadas. */
export function canAdjust(physical: number, reserved: number, delta: number): boolean {
  if (!Number.isSafeInteger(delta) || delta === 0) throw new Error("Delta deve ser inteiro e diferente de zero")
  return physical + delta >= reserved && physical + delta >= 0
}
