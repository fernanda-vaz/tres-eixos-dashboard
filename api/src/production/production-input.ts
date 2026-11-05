import {
  allowOnly,
  parseEnum,
  parseGrams,
  parseInteger,
  parseObject,
  parseOptionalDate,
  parsePagination,
  parseText,
  parseUuid,
  queryText,
} from "../http/validation.js"
import type { PageRequest } from "../pagination.js"
import type { JobFilter } from "./production-repository.js"
import { JOB_STATUSES, OPEN_JOB_STATUSES } from "./production-rules.js"

export type StockJobInput = { productId: string; quantity: number; estimatedMinutes: number | null }
export type HeldJobDecision = { action: "cancel" | "continue_for_stock"; reason: string }
export type PriorityChange = { priority: number; reason: string }

export function parseJobId(value: unknown): string {
  return parseUuid(value, "ID do job")
}

/** Filtros da fila: estado (padrão: jobs abertos), cor e prazo de envio. */
export function parseJobListQuery(query: unknown): { filter: JobFilter; page: PageRequest } {
  const page = parsePagination(query)
  const statusText = queryText(query, "status", 20)
  const statuses = statusText ? [parseEnum(statusText, "status", JOB_STATUSES)] : OPEN_JOB_STATUSES
  const color = queryText(query, "color", 60) ?? null
  const dueBeforeText = queryText(query, "dueBefore", 40)
  const dueBefore = dueBeforeText ? parseOptionalDate(dueBeforeText, "dueBefore") : null
  return { filter: { statuses, color, dueBefore }, page }
}

export function parseStockJob(body: unknown): StockJobInput {
  const data = parseObject(body)
  allowOnly(data, ["productId", "quantity", "estimatedMinutes"])
  return {
    productId: parseUuid(data.productId, "productId"),
    quantity: parseInteger(data.quantity, "quantity", 1, 10_000),
    estimatedMinutes:
      data.estimatedMinutes === undefined ? null : parseInteger(data.estimatedMinutes, "estimatedMinutes", 0, 100_000),
  }
}

/** Consumo real informado na conclusão, por material. Sem corpo: vale a estimativa da receita. */
export function parseActualGrams(body: unknown): Map<string, string> {
  const actual = new Map<string, string>()
  if (body === undefined) return actual
  const data = parseObject(body)
  allowOnly(data, ["actualGrams"])
  if (data.actualGrams === undefined) return actual
  for (const [materialId, grams] of Object.entries(parseObject(data.actualGrams))) {
    actual.set(parseUuid(materialId, "materialId em actualGrams"), parseGrams(grams, "actualGrams"))
  }
  return actual
}

export function parseJobCancelReason(body: unknown): string {
  const data = parseObject(body ?? {})
  allowOnly(data, ["reason"])
  return parseText(data.reason ?? "Cancelado pela loja", "reason", 255)
}

export function parseHeldJobDecision(body: unknown): HeldJobDecision {
  const data = parseObject(body)
  allowOnly(data, ["action", "reason"])
  return {
    action: parseEnum(data.action, "action", ["cancel", "continue_for_stock"] as const),
    reason: parseText(data.reason, "reason", 255),
  }
}

export function parsePriorityChange(body: unknown): PriorityChange {
  const data = parseObject(body)
  allowOnly(data, ["priority", "reason"])
  return { priority: parseInteger(data.priority, "priority", -100, 100), reason: parseText(data.reason, "reason", 255) }
}
