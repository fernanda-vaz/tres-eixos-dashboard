export type ProductInput = {
  sku: string
  name: string
  priceCents: number
}

export function parseProductNamePatch(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Objeto esperado")
  }

  const data = value as Record<string, unknown>
  const keys = Object.keys(data)
  if (keys.length !== 1 || keys[0] !== "name") {
    throw new Error("PATCH permite alterar apenas o nome")
  }

  if (
    typeof data.name !== "string" ||
    !data.name.trim() ||
    data.name.trim().length > 120
  ) {
    throw new Error("Nome inválido")
  }

  return data.name.trim()
}

export function parseProductPricePatch(value: unknown): number {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Objeto esperado")
  }

  const data = value as Record<string, unknown>
  const keys = Object.keys(data)
  if (keys.length !== 1 || keys[0] !== "priceCents") {
    throw new Error("PATCH permite alterar apenas o preço")
  }

  if (
    typeof data.priceCents !== "number" ||
    !Number.isSafeInteger(data.priceCents) ||
    data.priceCents < 0 ||
    data.priceCents > 2_147_483_647
  ) {
    throw new Error(
      "Preço deve ser inteiro não negativo dentro do limite do banco",
    )
  }

  return data.priceCents
}

export function parseProduct(value: unknown): ProductInput {
  if (typeof value !== "object" || value === null)
    throw new Error("Objeto esperado")
  const data = value as Record<string, unknown>
  if (typeof data.sku !== "string") throw new Error("SKU obrigatório")
  const sku = data.sku.trim().toUpperCase()
  if (!/^[A-Z0-9_-]{1,64}$/.test(sku)) throw new Error("SKU inválido")
  if (
    typeof data.name !== "string" ||
    !data.name.trim() ||
    data.name.trim().length > 120
  ) {
    throw new Error("Nome inválido")
  }
  if (
    typeof data.priceCents !== "number" ||
    !Number.isSafeInteger(data.priceCents) ||
    data.priceCents < 0 ||
    data.priceCents > 2_147_483_647
  ) {
    throw new Error(
      "Preço deve ser inteiro não negativo dentro do limite do banco",
    )
  }
  return { sku, name: data.name.trim(), priceCents: data.priceCents }
}
