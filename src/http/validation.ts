import type { PageRequest } from "../pagination.js"
import { ValidationError } from "./errors.js"

// Entradas chegam como unknown: tipos TypeScript não protegem a API de JSON malformado.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}

export function parseUuid(value: unknown, label: string): string {
  if (!isUuid(value)) throw new ValidationError(`${label} inválido`)
  return value.toLowerCase()
}

export function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError("Objeto esperado")
  }
  return value as Record<string, unknown>
}

/** Recusa campos inesperados: evita que o cliente acredite ter alterado algo que foi ignorado. */
export function allowOnly(data: Record<string, unknown>, fields: readonly string[]): void {
  const extra = Object.keys(data).filter((key) => !fields.includes(key))
  if (extra.length) throw new ValidationError(`Campos não permitidos: ${extra.join(", ")}`)
}

export function parseText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new ValidationError(`${label} obrigatório`)
  const text = value.trim()
  if (text.length > maxLength) throw new ValidationError(`${label} deve ter no máximo ${maxLength} caracteres`)
  return text
}

export function parseOptionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return null
  return parseText(value, label, maxLength)
}

export function parseInteger(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ValidationError(`${label} deve ser inteiro entre ${min} e ${max}`)
  }
  return value
}

/** Gramas com até 3 casas decimais, em texto ("12.5") ou número. Retorna texto para o numeric do banco. */
export function parseGrams(value: unknown, label: string, { allowNegative = false } = {}): string {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value
  if (typeof text !== "string" || !/^-?\d{1,9}(\.\d{1,3})?$/.test(text)) {
    throw new ValidationError(`${label} deve ter até 3 casas decimais`)
  }
  if (!allowNegative && text.startsWith("-")) throw new ValidationError(`${label} não pode ser negativo`)
  if (Number(text) === 0) throw new ValidationError(`${label} não pode ser zero`)
  return text
}

export function parseEnum<T extends string>(value: unknown, label: string, options: readonly T[]): T {
  if (typeof value !== "string" || !(options as readonly string[]).includes(value)) {
    throw new ValidationError(`${label} deve ser um de: ${options.join(", ")}`)
  }
  return value as T
}

export function parseOptionalDate(value: unknown, label: string): Date | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new ValidationError(`${label} deve ser uma data ISO 8601 com horário e fuso, ex.: 2026-11-10T18:00:00-03:00`)
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${label} inválida`)
  return date
}

/** Valores de query string chegam como texto (ou lista, se repetidos). */
export function queryText(query: unknown, name: string, maxLength = 100): string | undefined {
  const value = (query as Record<string, unknown> | undefined)?.[name]
  if (value === undefined || value === "") return undefined
  if (typeof value !== "string") throw new ValidationError(`Parâmetro ${name} deve aparecer uma única vez`)
  if (value.length > maxLength) throw new ValidationError(`Parâmetro ${name} longo demais`)
  return value
}

function queryInteger(query: unknown, name: string, fallback: number, min: number, max: number): number {
  const value = queryText(query, name, 10)
  if (value === undefined) return fallback
  if (!/^-?\d+$/.test(value)) throw new ValidationError(`Parâmetro ${name} deve ser inteiro`)
  return parseInteger(Number(value), `Parâmetro ${name}`, min, max)
}

/** "true" ou "false" na query string; qualquer outro valor é 400 (nunca vira false em silêncio). */
export function queryBoolean(query: unknown, name: string): boolean | undefined {
  const value = queryText(query, name, 5)
  if (value === undefined) return undefined
  if (value !== "true" && value !== "false") throw new ValidationError(`Parâmetro ${name} deve ser true ou false`)
  return value === "true"
}

export function parsePagination(query: unknown): PageRequest {
  const page = queryInteger(query, "page", 1, 1, 100_000)
  const pageSize = queryInteger(query, "pageSize", 20, 1, 100)
  return { page, pageSize, offset: (page - 1) * pageSize }
}
