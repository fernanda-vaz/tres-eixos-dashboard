import { ValidationError } from "../http/errors.js"
import { allowOnly, parseObject, parsePagination, parseUuid, queryBoolean, queryText } from "../http/validation.js"
import type { PageRequest } from "../pagination.js"
import type { ProductFilter, ProductInput, ProductPatch } from "./product.js"

const MAX_PRICE_CENTS = 2_147_483_647

export function parseProductId(value: unknown): string {
  return parseUuid(value, "ID de produto")
}

export function parseSku(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("SKU obrigatório")
  const sku = value.trim().toUpperCase()
  if (!/^[A-Z0-9_-]{1,64}$/.test(sku)) throw new ValidationError("SKU inválido")
  return sku
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) {
    throw new ValidationError("Nome inválido")
  }
  return value.trim()
}

function parsePriceCents(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_PRICE_CENTS) {
    throw new ValidationError("Preço deve ser inteiro não negativo dentro do limite do banco")
  }
  return value
}

export function parseProduct(value: unknown): ProductInput {
  const data = parseObject(value)
  allowOnly(data, ["sku", "name", "priceCents"])
  return { sku: parseSku(data.sku), name: parseName(data.name), priceCents: parsePriceCents(data.priceCents) }
}

/** PATCH aceita nome, preço e ativo. id e SKU não mudam: o SKU identifica o produto nos pedidos. */
export function parseProductPatch(value: unknown): ProductPatch {
  const data = parseObject(value)
  allowOnly(data, ["name", "priceCents", "active"])
  const patch: ProductPatch = {}
  if (data.name !== undefined) patch.name = parseName(data.name)
  if (data.priceCents !== undefined) patch.priceCents = parsePriceCents(data.priceCents)
  if (data.active !== undefined) {
    if (typeof data.active !== "boolean") throw new ValidationError("active deve ser true ou false")
    patch.active = data.active
  }
  if (!Object.keys(patch).length) throw new ValidationError("PATCH precisa de name, priceCents ou active")
  return patch
}

export function parseProductListQuery(query: unknown): { filter: ProductFilter; page: PageRequest } {
  const page = parsePagination(query)
  const filter = {
    search: queryText(query, "search"),
    active: queryBoolean(query, "active"),
  }
  return { filter, page }
}
