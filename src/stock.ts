export function available(physical: number, defective: number): number {
  if (
    !Number.isSafeInteger(physical) ||
    !Number.isSafeInteger(defective) ||
    physical < 0 ||
    defective < 0 ||
    defective > physical
  ) {
    throw new Error("Saldo inválido")
  }
  return physical - defective
}

export function canFulfill(
  physical: number,
  defective: number,
  quantity: number,
): boolean {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error("Quantidade deve ser inteira e positiva.")
  }
  return available(physical, defective) >= quantity
}
