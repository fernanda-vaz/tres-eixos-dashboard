// Prova de contrato, só em tempo de compilação: cada tipo que a API devolve, depois de virar JSON
// (Date → texto ISO), tem de ser exatamente o tipo publicado em @tres-eixos/contracts.
// Se alguém mudar um campo de um lado só, `npm run typecheck` falha aqui, apontando o tipo.
// Não há testes em tempo de execução neste arquivo; ele entra pelo tsconfig (test/**).

import type * as C from "@tres-eixos/contracts"
import type { Product } from "../src/catalog/product.js"
import type { DashboardSummary } from "../src/dashboard/dashboard-repository.js"
import type { ErrorCode } from "../src/http/errors.js"
import type { ImportOutcome, SyncResult } from "../src/integrations/import-service.js"
import type { IntegrationError, PendingSku } from "../src/integrations/integration-repository.js"
import type { InventoryItem } from "../src/inventory/inventory-repository.js"
import type { Material, RecipeLine } from "../src/inventory/material-repository.js"
import type { OrderStatus } from "../src/orders/order-rules.js"
import type { OrderSummary, OrderView } from "../src/orders/order-view-repository.js"
import type { AggregateType } from "../src/outbox/enqueue.js"
import type { DeadEvent } from "../src/outbox/routes.js"
import type { Page } from "../src/pagination.js"
import type { ChannelView, ProductCost, ProductPricing, SettingsView } from "../src/pricing/pricing-service.js"
import type { JobPurpose, ProductionJob } from "../src/production/production-repository.js"
import type { JobStatus, MaterialNeed } from "../src/production/production-rules.js"
import type { SessionUser } from "../src/security/user-repository.js"
import type { InventoryBalance } from "../src/inventory/inventory-service.js"

/** O que `res.json` faz com um valor: Date vira string; o resto fica igual. */
type Json<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T

/** Igualdade estrita entre dois tipos. Serve para uniões e campos simples; distingue interseção de objeto achatado. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type AllTrue<T> = T[keyof T] extends true ? true : false

type Nullish<T> = Extract<T, null | undefined>

/**
 * Mesma forma, campo a campo e em profundidade: mesmo conjunto de chaves em cada nível, arrays
 * comparados pelo elemento, uniões e primitivos por igualdade estrita. Assim `A & B` e o objeto
 * achatado equivalente contam como iguais, que é o que importa para o JSON.
 */
type Same<A, B> = Equals<Nullish<A>, Nullish<B>> extends true ? SameValue<Exclude<A, null | undefined>, Exclude<B, null | undefined>> : false

type SameValue<A, B> = [A] extends [readonly unknown[]]
  ? [B] extends [readonly unknown[]]
    ? Same<A[number], B[number]>
    : false
  : [A] extends [object]
    ? [B] extends [object]
      ? Equals<keyof A, keyof B> extends true
        ? AllTrue<{ [K in keyof B]-?: Same<A[K & keyof A], B[K]> }>
        : false
      : false
    : Equals<A, B>

type Assert<T extends true> = T

// Enumerações: a API não pode conhecer um status que o painel não conhece, nem o contrário.
export type _ErrorCode = Assert<Equals<ErrorCode, C.ErrorCode>>
export type _OrderStatus = Assert<Equals<OrderStatus, C.OrderStatus>>
export type _JobStatus = Assert<Equals<JobStatus, C.JobStatus>>
export type _JobPurpose = Assert<Equals<JobPurpose, C.JobPurpose>>
export type _ImportOutcome = Assert<Equals<ImportOutcome, C.ImportOutcome>>
export type _AggregateType = Assert<Equals<AggregateType, C.AggregateType>>

// Respostas: sessão, catálogo, estoque e materiais.
export type _Page = Assert<Same<Json<Page<{ a: Date }>>, C.Page<{ a: string }>>>
export type _User = Assert<Same<Json<SessionUser>, C.User>>
export type _Product = Assert<Same<Json<Product>, C.Product>>
export type _InventoryItem = Assert<Same<Json<InventoryItem>, C.InventoryItem>>
export type _StockLevel = Assert<Same<Json<InventoryBalance>, C.StockLevel>>
export type _Material = Assert<Same<Json<Material>, C.Material>>
export type _RecipeLine = Assert<Same<Json<RecipeLine>, C.RecipeLine>>

// Pedidos, produção e expedição.
export type _OrderSummary = Assert<Same<Json<OrderSummary>, C.OrderSummary>>
export type _Order = Assert<Same<Json<OrderView>, C.Order>>
export type _MaterialNeed = Assert<Same<Json<MaterialNeed>, C.MaterialNeed>>
export type _ProductionJob = Assert<Same<Json<ProductionJob>, C.ProductionJob>>

// Integrações, outbox e visão geral.
export type _PendingSku = Assert<Same<Json<PendingSku>, C.PendingSku>>
export type _IntegrationError = Assert<Same<Json<IntegrationError>, C.IntegrationError>>
export type _SyncResult = Assert<Same<Json<SyncResult>, C.SyncResult>>
export type _DeadEvent = Assert<Same<Json<DeadEvent>, C.DeadEvent>>
export type _DashboardSummary = Assert<Same<Json<DashboardSummary>, C.DashboardSummary>>

// Precificação.
export type _PricingSettings = Assert<Same<Json<SettingsView>, C.PricingSettings>>
export type _PricingChannel = Assert<Same<Json<ChannelView>, C.PricingChannel>>
export type _ProductPricing = Assert<Same<Json<ProductPricing>, C.ProductPricing>>
export type _ProductCost = Assert<Same<Json<ProductCost>, C.ProductCost>>
