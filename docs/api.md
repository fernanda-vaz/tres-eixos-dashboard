# Contratos da API

Base local: `http://localhost:8080`. No painel, as chamadas passam pelo proxy `/api` (`/api/products` → `/products`).

O contrato formal é `packages/contracts/index.d.ts` (tipos do que trafega, importados pelo painel e provados pela API no `typecheck`). Este documento explica e dá exemplos; se divergir do pacote, o pacote vale.

IDs são UUID. Preços são inteiros em centavos (BRL). Gramas são texto decimal com até 3 casas (`"12.5"`). Datas seguem ISO 8601 com fuso. Listagens aceitam `page` (a partir de 1) e `pageSize` (1–100) e respondem `{ items, page, pageSize, total }`.

## Erros

Formato único: `{ "error": "mensagem", "code": "codigo_estavel", "details"?: ... }`. A mensagem é para a usuária e pode mudar de redação; o `code` é estável e é por ele que o painel decide o que mostrar.

| Status | `code` | Quando | Exemplo |
|---|---|---|---|
| 400 | `validation` | entrada inválida | `{"error":"Preço deve ser inteiro não negativo dentro do limite do banco","code":"validation"}` |
| 400 | `invalid_json` | corpo não é JSON | `{"error":"JSON inválido","code":"invalid_json"}` |
| 401 | `unauthorized` | sem sessão | `{"error":"Autenticação necessária","code":"unauthorized"}` |
| 403 | `csrf` | escrita sem token CSRF | `{"error":"Token CSRF ausente ou inválido","code":"csrf"}` |
| 404 | `not_found` | recurso ou rota inexistente | `{"error":"Pedido não encontrado","code":"not_found"}` |
| 409 | `conflict` | conflito de estado ou estoque | `{"error":"Filamento insuficiente para iniciar a impressão","code":"conflict","details":{"materials":[{"color":"Rosa","requiredGrams":"60.000","availableGrams":"50.000"}]}}` |
| 409 | `sku_taken` | SKU já cadastrado | `{"error":"SKU já cadastrado","code":"sku_taken","details":{"sku":"CUBO-AZUL"}}` |
| 409 | `concurrency` | outra transação alterou os mesmos dados (deadlock, lock_timeout) | `{"error":"Outra operação alterou os mesmos dados. Tente novamente.","code":"concurrency"}` |
| 413 | `payload_too_large` | corpo acima de 32 kB (256 kB em `POST /imports/orders`) | `{"error":"Corpo da requisição grande demais","code":"payload_too_large"}` |
| 429 | `rate_limited` | muitas tentativas de login | `{"error":"Muitas tentativas de login. Tente novamente mais tarde.","code":"rate_limited"}` |
| 500 | `internal` | erro inesperado (log interno) | `{"error":"Erro interno","code":"internal"}` |

Toda resposta leva `X-Request-Id` (o id do nginx, quando a chamada passa pelo painel, ou um UUID gerado pela API). Ele aparece na linha de log da requisição: cite-o ao relatar um problema.

## Autenticação

Toda escrita envia `X-CSRF-Token`. Cookie de sessão: `tres_eixos_sid`.

| Rota | Uso |
|---|---|
| `GET /auth/csrf` | `{ csrfToken }` para o formulário de login |
| `POST /auth/login` | `{ email, password }` → `{ user, csrfToken }` (use o novo token daqui em diante) |
| `GET /auth/me` | usuária da sessão + token CSRF atual |
| `POST /auth/logout` | encerra a sessão (204) |

Públicas: `GET /health` (processo) e `GET /ready` (banco). Todas as demais exigem sessão.

## Operação

| Rota | Resposta |
|---|---|
| `GET /dashboard/summary` | tudo que a visão geral mostra, em uma requisição: `orders.byStatus` (contagem por status), `orders.overdue`, `production` (`queued`, `printing`, `onHold`, `blocked`, `pieces`), `upcomingShipments` (até 6 pedidos em aberto por prazo), `lowStock` (até 6 produtos ativos com menos peças livres), `lowFilament` (até 6 materiais com menos gramas livres) |
| `GET /metrics` | contadores desta instância da API (requisições, 409, 500, latência por rota) e situação do outbox (`pending`, `oldestPendingAgeSeconds`, `dead`) |
| `GET /outbox/dead` | eventos do outbox que esgotaram as 20 tentativas de publicação; enquanto estão aqui, os eventos seguintes do mesmo pedido esperam |
| `POST /outbox/:id/retry` | devolve o evento à fila com as tentativas zeradas; 404 se não estiver na dead-letter |

## Catálogo

| Rota | Corpo / query | Resposta |
|---|---|---|
| `POST /products` | `{ sku, name, priceCents }` | 201 + `Location`; 409 se o SKU existir |
| `GET /products` | `?search=&active=true\|false&page=&pageSize=` | página de produtos (`active` diferente de `true`/`false` → 400) |
| `GET /products/by-sku/:sku` | — | produto pelo SKU exato (normalizado para maiúsculas); 404 se não existir |
| `GET /products/:id` | — | produto |
| `PATCH /products/:id` | `{ name?, priceCents?, active? }` (id e SKU imutáveis) | produto |

## Estoque e materiais

| Rota | Corpo / query | Observação |
|---|---|---|
| `GET /inventory` | `?search=&active=true\|false` | sku, name, priceCents, physical, reserved, available, openProduction (o painel usa esta lista como catálogo) |
| `GET /inventory/:productId` | — | saldo de um produto |
| `GET /inventory/movements` | `?productId=&orderId=` | histórico de auditoria |
| `POST /inventory/adjustments` | `{ productId, delta, reason }` | `Idempotency-Key` opcional; 409 se o físico ficar abaixo do reservado |
| `POST /materials` | `{ name, color }` | filamento |
| `GET /materials` | `?color=` (contém, sem diferenciar maiúsculas) | gramas físicos, reservados e livres |
| `POST /materials/:id/adjustments` | `{ gramsDelta: "1000", reason }` | entrada de rolo ou ajuste |
| `GET /products/:id/materials` | — | receita do produto |
| `PUT /products/:id/materials/:materialId` | `{ gramsPerUnit: "30" }` | define a linha da receita |
| `DELETE /products/:id/materials/:materialId` | — | remove a linha |

## Pedidos

`POST /orders` exige o cabeçalho `Idempotency-Key` (8–200 caracteres):

```json
{
  "externalOrderId": "BALCAO-0042",
  "shipBy": "2026-11-10T18:00:00-03:00",
  "items": [{ "sku": "CUBO-AZUL", "quantity": 2 }]
}
```

A resposta 201 traz o pedido com itens, reserva por item, jobs de produção, expedição e histórico. Se faltar estoque, o pedido fica `awaiting_stock` e a falta entra na fila de produção.

| Rota | Efeito |
|---|---|
| `GET /orders` | `?status=&overdue=true` — ordenado por prazo de envio, depois data do pedido |
| `GET /orders/:id` | detalhes |
| `POST /orders/:id/cancel` | `{ reason? }` — libera reservas uma vez; produção vai para `on_hold`; 409 se já enviado |
| `POST /orders/:id/allocation` | nova tentativa de reserva |
| `POST /orders/:id/ready` | separado e embalado (exige `reserved`) |
| `POST /orders/:id/label` | registra etiqueta impressa; não muda status interno nem externo |
| `POST /orders/:id/dispatch` | expede: baixa physical e reserved uma vez (exige `ready`) |

## Produção

| Rota | Efeito |
|---|---|
| `GET /production/jobs` | fila: `?status=&color=&dueBefore=` (`color` = contém); cada job traz `materials` e `blockedBy` (cores sem saldo) |
| `POST /production/jobs` | `{ productId, quantity, estimatedMinutes? }` — produção para estoque |
| `POST /production/jobs/:id/start` | reserva o filamento; 409 com as cores faltantes |
| `POST /production/jobs/:id/complete` | `{ actualGrams?: { [materialId]: "62.5" } }` — physical +, consumo estimado e real registrados, reserva para pedidos em espera |
| `POST /production/jobs/:id/cancel` | `{ reason? }` — devolve o filamento reservado |
| `POST /production/jobs/:id/decision` | `{ action: "cancel" \| "continue_for_stock", reason }` — para jobs `on_hold` |
| `PUT /production/jobs/:id/priority` | `{ priority: -100..100, reason }` |

## Precificação

Dinheiro em centavos; percentuais como número com até 2 casas (`16.5`).

| Rota | Corpo / query | Efeito |
|---|---|---|
| `GET /pricing/settings` | — | configuração da operação |
| `PUT /pricing/settings` | `{ energyCentsPerKwh, printerPowerWatts, printerPriceCents, printerLifetimeHours, laborCentsPerHour, failureRatePercent, taxRatePercent }` | substitui a configuração |
| `GET /pricing/channels` | — | canais com `feePercent` e `fixedFeeCents` (começam zerados: confira as tarifas no site de cada marketplace) |
| `POST /pricing/channels` | `{ name, feePercent?, fixedFeeCents?, active? }` | novo canal; nome repetido → 409 |
| `PATCH /pricing/channels/:id` | qualquer campo acima | altera tarifas ou ativa/desativa |
| `PATCH /materials/:id` | `{ costPerKgCents }` | preço pago por quilo do filamento |
| `GET /products/:id/pricing` | — | ficha salva, composição do custo, preço sugerido e resultado ao preço atual por canal, alertas |
| `POST /products/:id/pricing/preview` | ficha | mesmo cálculo sem salvar |
| `PUT /products/:id/cost-sheet` | `{ printMinutes, purgeGrams, laborMinutes, packagingCents, extraCents, targetMarginPercent }` | salva a ficha (`purgeGrams` opcional, padrão 0) |
| `GET /pricing/products` | `?page=&pageSize=` | custo × preço atual e margem por canal de cada produto ativo |

Cálculo (em `api/src/pricing/pricing-rules.ts`, só com inteiros):

```text
filamento   = Σ (gramas de cada cor da receita × preço/kg daquele filamento)
purga       = gramas descartados na troca de cor × preço médio dos filamentos, ponderado pelos gramas de cada cor
energia     = potência (W) × tempo (h) ÷ 1000 × R$/kWh
desgaste    = valor da impressora ÷ vida útil (h) × tempo (h)
falhas      = % de falhas × (filamento + purga + energia + desgaste)
mão de obra = minutos × valor da hora ÷ 60
custo       = filamento + energia + desgaste + falhas + mão de obra + embalagem + outros
preço       = (custo + tarifa fixa) ÷ (1 − tarifa% − imposto% − margem%), arredondado para cima
```

Sem preço possível (`suggested: null`) quando tarifa + imposto + margem ≥ 100%. É resultado bruto da venda: não inclui frete nem despesas fixas mensais.

## Integrações (somente simulador)

| Rota | Efeito |
|---|---|
| `POST /imports/orders` | `{ orders: [...] }` (até 50 pedidos de até 50 itens; corpo até 256 kB), origem sempre `"simulador"` |
| `POST /integrations/simulator/sync` | roda o conector simulado (pedido normal, SKU não mapeado e item sem estoque) |
| `GET /integrations/channels` | canais (`manual`, `simulator`) |
| `GET /integrations/pending-skus` | SKUs externos sem correspondência |
| `PUT /integrations/sku-mappings` | `{ channelId?, externalSku, productId }` — resolve a pendência e reprocessa os pedidos |
| `GET /integrations/errors` | falhas de importação com tentativas e último erro |

Webhook do outbox (`OUTBOX_WEBHOOK_URL`): `POST` com o evento `{ id, topic, aggregateType, aggregateId, payload, createdAt, attempts }` e o cabeçalho `Idempotency-Key: <id>`. Com `OUTBOX_WEBHOOK_SECRET`, cada envio leva `X-Signature-Timestamp` (segundos Unix) e `X-Signature-256: sha256=<hex>`, o HMAC-SHA256 de `"<timestamp>.<corpo>"` com o segredo; o receptor recalcula, compara em tempo constante e rejeita timestamps antigos.

Pedido externo:

```json
{
  "externalOrderId": "SIM-1001",
  "status": "paid",
  "orderedAt": "2026-11-01T10:00:00-03:00",
  "updatedAt": "2026-11-01T10:05:00-03:00",
  "shipBy": "2026-11-05T18:00:00-03:00",
  "items": [{ "externalSku": "SIM-CUBO-AZUL", "quantity": 1, "unitPriceCents": 1500 }]
}
```

Status externos: `new`, `paid`, `ready_to_ship`, `shipped`, `delivered`, `cancelled`. Um status mais antigo ou que regride é ignorado (`unchanged`). `cancelled` cancela o pedido internamente se ele ainda não foi enviado.
