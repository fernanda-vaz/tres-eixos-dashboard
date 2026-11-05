import { allowOnly, parseGrams, parseInteger, parseObject, parsePagination, parseText, parseUuid, queryText } from "../http/validation.js"
import type { PageRequest } from "../pagination.js"

export function parseMaterialId(value: unknown): string {
  return parseUuid(value, "ID de material")
}

const MAX_COST_PER_KG_CENTS = 100_000_000

export function parseNewMaterial(body: unknown): { name: string; color: string; costPerKgCents: number } {
  const data = parseObject(body)
  allowOnly(data, ["name", "color", "costPerKgCents"])
  return {
    name: parseText(data.name, "name", 80),
    color: parseText(data.color, "color", 60),
    costPerKgCents: parseInteger(data.costPerKgCents ?? 0, "costPerKgCents", 0, MAX_COST_PER_KG_CENTS),
  }
}

/** PATCH /materials/:id: hoje só o preço por kg é editável. */
export function parseMaterialPatch(body: unknown): { costPerKgCents: number } {
  const data = parseObject(body)
  allowOnly(data, ["costPerKgCents"])
  return { costPerKgCents: parseInteger(data.costPerKgCents, "costPerKgCents", 0, MAX_COST_PER_KG_CENTS) }
}

export function parseMaterialListQuery(query: unknown): { color: string | null; page: PageRequest } {
  const page = parsePagination(query)
  return { color: queryText(query, "color", 60) ?? null, page }
}

export function parseMaterialAdjustment(body: unknown): { gramsDelta: string; reason: string } {
  const data = parseObject(body)
  allowOnly(data, ["gramsDelta", "reason"])
  const gramsDelta = parseGrams(data.gramsDelta, "gramsDelta", { allowNegative: true })
  return { gramsDelta, reason: parseText(data.reason, "reason", 255) }
}

export function parseRecipeGrams(body: unknown): string {
  const data = parseObject(body)
  allowOnly(data, ["gramsPerUnit"])
  return parseGrams(data.gramsPerUnit, "gramsPerUnit")
}
