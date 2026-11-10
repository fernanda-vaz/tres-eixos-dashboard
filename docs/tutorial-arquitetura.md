# Tutorial de arquitetura do Três Eixos

Este documento descreve o estado atual da aplicação Três Eixos: uma aplicação de gestão para um negócio de impressão 3D, com catálogo, estoque de peças, estoque de filamento, pedidos, produção, expedição, precificação e uma integração simulada de marketplace.

O objetivo é explicar não apenas **o que cada arquivo faz**, mas também por que a aplicação foi organizada dessa forma e como as partes se relacionam.

## 1. Visão geral

O projeto é um monorepo com dois projetos Node/TypeScript independentes:

```text
três-eixos-dashboard/
├── api/       backend HTTP, regras de negócio e acesso ao PostgreSQL
├── web/       painel React servido pelo Vite em desenvolvimento e nginx em produção
├── compose.yaml
├── docs/
└── .env.example
```

Em execução, existem quatro processos principais:

```text
Navegador → web/nginx ou Vite → api/Express → PostgreSQL
                                      ↘ outbox → worker → log/webhook
```

- `postgres` é a fonte de verdade persistente.
- `api` atende HTTP, autentica a usuária e executa os casos de uso.
- `worker` publica eventos registrados na outbox.
- `web` entrega o painel e encaminha `/api/*` para a API.

Não há microserviços: o backend é um **monólito modular**. Isso mantém as transações de estoque, pedidos e produção simples, sem perder a separação de responsabilidades dentro do código.

## 2. Tecnologias e execução

- Node.js 24 e TypeScript.
- Express 5 no backend.
- PostgreSQL 16.
- React 19 + Vite no frontend.
- Docker Compose para banco, API, worker e nginx.
- Test runner nativo do Node, sem framework de testes adicional. A API carrega TypeScript com `tsx`; o painel depende do type stripping nativo do Node 24 (`node --test` direto nos `.ts`), então os testes do web só rodam na versão do `.nvmrc`.
- `oxlint` para lint do painel; `tsc` para typecheck nos dois projetos.

### Desenvolvimento local

```bash
cp .env.example .env
cd api && npm ci && npm run db:up && npm run migrate
cd ../web && npm ci
```

Depois, em terminais separados:

```bash
cd api && npm run dev
cd api && npm run worker
cd web && npm run dev
```

O frontend chama `/api/...`. O proxy do Vite remove o prefixo `/api` e encaminha para a porta da API. Em produção, o nginx faz o mesmo papel.

### Docker Compose

O `compose.yaml` sobe:

- `postgres`: banco publicado apenas em `127.0.0.1:5434`.
- `api`: API na porta interna 3000.
- `worker`: mesma imagem da API, mas executando somente o consumidor da outbox.
- `web`: build estático servido por nginx na porta 80 do container.

As portas do host são parametrizadas por `API_HOST_PORT` e `WEB_HOST_PORT`. A API usa `postgres:5432` dentro da rede Docker; `localhost` nesse contexto seria o próprio container da API.

Arquivos de operação na raiz:

| Arquivo | Função |
|---|---|
| `compose.yaml` | Define rede, volumes, healthcheck, dependências e comandos dos quatro serviços. |
| `.env.example` | Documenta as variáveis necessárias sem conter segredos reais; a cópia local é `.env`. |
| `README.md` | Guia operacional: instalação, migrations, criação da conta, execução, testes, backup e troubleshooting. |
| `docs/arquitetura.md` | Referência técnica mais compacta sobre concorrência, estados, segurança e outbox. |
| `docs/api.md` | Contrato detalhado de rotas, corpos, respostas e erros. |
| `docs/tutorial-arquitetura.md` | Este tutorial, com visão pedagógica da organização e do papel de cada arquivo. |

## 3. Modelo arquitetural do backend

Cada módulo de negócio segue, em geral, esta direção de dependência:

```text
routes.ts
   ↓
*-input.ts → tipos do domínio
   ↓
*-service.ts
   ↓
*-repository.ts → PostgreSQL
```

Regras que não precisam de HTTP nem banco ficam em `*-rules.ts`. Essa separação existe por três motivos:

1. rotas ficam pequenas e focadas no protocolo HTTP;
2. serviços concentram transações e orquestração;
3. regras puras podem ser testadas rapidamente e sem banco.

### Dependências entre módulos

Entre módulos a direção também é imposta, e verificada no CI pelo `dependency-cruiser` (`api/.dependency-cruiser.cjs`, `npm run deps:check`):

```text
catalog, pricing, security  →  só infraestrutura (db, http, outbox/enqueue…)
inventory                   →  catalog
production                  →  inventory, catalog
orders                      →  catalog, inventory, production  (+ a porta orders/allocation-port.ts)
fulfillment                 →  orders, inventory, production
integrations                →  orders, fulfillment, catalog, inventory
dashboard                   →  orders, inventory (leitura)
app.ts                      →  tudo (composição)
```

`fulfillment/allocation.ts` é o serviço de domínio que atravessa pedidos, estoque e produção: reserva itens, calcula a falta, cria jobs, realoca pedidos quando entra saldo e libera reservas. Ele mora em módulo próprio para que nenhum dos três precise importar os outros. Como pedidos precisa chamá-lo (criar, cancelar, realocar) sem importá-lo, `orders/allocation-port.ts` declara a interface e o fulfillment a implementa; estoque e produção só avisam "o saldo deste produto subiu" (`inventory/stock-events.ts`) e o fulfillment escuta. `app.ts` liga as duas pontas em `registerFulfillment()`, uma vez, antes de montar as rotas. Tudo acontece na mesma transação e com a mesma ordem de locks (pedido → jobs → estoque → materiais). A regra prática continua: **toda mudança que cruza pedido, estoque e produção passa por `fulfillment/allocation.ts`**.

### Fluxo de uma requisição

1. Express recebe a requisição em `app.ts`.
2. Middleware limita o corpo, cria/recupera a sessão e valida CSRF.
3. `requireAuth` bloqueia tudo que não for público.
4. A rota converte `unknown` em uma entrada tipada usando um arquivo `*-input.ts`.
5. O serviço abre uma transação quando a operação altera mais de uma tabela.
6. Repositórios executam SQL parametrizado.
7. O serviço grava histórico, movimentos e eventos de outbox na mesma transação.
8. A resposta é serializada; erros passam pelo `errorHandler`.

### Transações e concorrência

`db.ts` fornece `withTransaction`, garantindo que todo o trabalho da função use o mesmo client PostgreSQL. O backend também usa `lock_timeout = 5s` e traduz deadlocks, conflitos de serialização e timeout de lock em HTTP 409.

A reserva de peças é atômica:

```sql
UPDATE inventory
SET reserved = reserved + $1
WHERE product_id = $2
  AND physical - reserved >= $1;
```

Se nenhuma linha for atualizada, não havia saldo disponível. A aplicação também mantém uma ordem estável de locks — pedido, jobs, estoque e materiais — para reduzir deadlocks.

O histórico de estoque usa `operation_key` única. Assim, repetir uma operação como `reserve:<item>`, `ship:<reservation>` ou `produce:<job>` não duplica o efeito financeiro ou físico.

## 4. Banco de dados e migrations

As migrations são append-only: uma migration já aplicada nunca deve ser editada. Uma mudança nova deve ser criada em `010_...sql`, `011_...sql` etc.

| Migration | Responsabilidade |
|---|---|
| `001_initial.sql` | Cria a tabela `products` (id, SKU único, nome, preço em centavos). |
| `002_catalog_inventory.sql` | Ativo/inativo, materiais, receitas, estoque de peças e movimentos de estoque/material. |
| `003_orders.sql` | Canais, SKUs externos, pedidos, itens, reservas, histórico e idempotência. |
| `004_production_shipping.sql` | Jobs de produção, materiais reservados por job, histórico de produção e expedição. |
| `005_integrations_security.sql` | Eventos de integração, cursores, outbox, usuários e sessões PostgreSQL. |
| `006_outbox_worker_login_attempts.sql` | Leasing e retentativas da outbox; limite persistente de login. |
| `007_pricing.sql` | Configuração de custos, canais de venda e fichas de custo. |
| `008_purge_grams.sql` | Gramas de purga por peça na precificação. |
| `009_outbox_lease_login_attempts.sql` | `lease_id`, sequência da outbox e contagem atômica de tentativas de login. |

O banco reforça invariantes importantes com `CHECK`, `UNIQUE`, índices parciais e chaves estrangeiras. A aplicação valida a entrada para mensagens amigáveis, mas o banco continua sendo a última barreira contra dados inválidos.

Duas famílias de tabelas crescem para sempre e precisam de atenção distinta:

- **Auditoria** (`stock_movements`, `material_movements`, `order_status_history`, `production_job_history`): devem crescer; o que falta é uma estratégia de arquivamento quando ficarem grandes.
- **Operacionais** (`idempotency_keys`, `outbox` já publicado, `integration_events` processados, `login_attempts`): hoje não há limpeza automática. Cada `POST /inventory/adjustments` sem `Idempotency-Key` grava uma chave aleatória que nunca será reutilizada. A limpeza periódica está na lista de evolução.

## 5. Arquivos de infraestrutura do backend

| Arquivo | Função e importância |
|---|---|
| `api/src/app.ts` | Compõe o Express: `registerFulfillment()`, log por requisição, cabeçalhos, limite de corpo (32 kB; 256 kB em `/imports/orders`), rotas, `/health`, `/ready`, `/metrics`, encerramento e handler de erros. É o ponto de montagem da API, mas não contém regras de negócio. Os cabeçalhos `X-Frame-Options`, `X-Content-Type-Options` e `Referrer-Policy` daqui valem para as respostas JSON; o HTML do painel recebe os seus (e a CSP) do nginx. |
| `api/src/server.ts` | Inicializa o listener HTTP, lê `PORT`, define `headersTimeout` (10 s) e `requestTimeout` (30 s) e trata shutdown gracioso fechando servidor, sessões e pool. Mantê-lo separado permite importar `app` nos testes sem abrir uma porta. |
| `api/src/db.ts` | Cria o pool PostgreSQL, define `Queryable`, transações e paginação com total. Todo repositório recebe o `db: Queryable` como primeiro parâmetro, então a mesma função serve dentro e fora de transação. |
| `api/src/logger.ts` | `pino`: uma linha JSON por evento em API, worker e scripts (`LOG_LEVEL`; silencioso nos testes). |
| `api/src/grams.ts` | Converte gramas em texto para miligramas `BigInt`: comparações e somas sem ponto flutuante, compartilhadas por produção e precificação. |
| `api/src/retention.ts` | Apaga chaves de idempotência (7 dias), outbox publicado (30), eventos de integração processados (90) e janelas de login (1). Rodado pelo worker a cada hora; tabelas de auditoria ficam de fora. |
| `api/src/pagination.ts` | Define `Page`/`PageRequest` e transforma `{items,total}` em uma resposta uniforme. |
| `api/src/sql.ts` | Helpers SQL sem conexão, como o padrão seguro de busca textual. |
| `api/src/pg-errors.ts` | Extrai código e constraint de erros do PostgreSQL para convertê-los em conflitos de domínio. |
| `api/src/http/errors.ts` | Define erros HTTP (`ValidationError`, `UnauthorizedError`, `NotFoundError`, `ConflictError`) e o formato único `{ error, code, details? }`. O `code` é estável (`sku_taken`, `csrf`, `concurrency`…) e é por ele que o painel decide a mensagem. Oculta stack traces em respostas 500 e conta 409/500 nas métricas. |
| `api/src/http/request-log.ts` | Uma linha de log por requisição (id, método, rota, status, duração, usuária). O id vem do nginx (`X-Request-Id`) ou é gerado, e volta na resposta. |
| `api/src/http/metrics.ts` | Contadores e latências em memória desta instância, expostos em `GET /metrics`. |
| `api/src/http/validation.ts` | Primitivas para validar objetos, campos permitidos, UUIDs, inteiros, gramas, datas, enums, filtros e paginação. O backend não confia em `req.body`. |
| `api/src/http/idempotency.ts` | Normaliza JSON, calcula hash do corpo, lê `Idempotency-Key` e persiste/reproduz respostas. Evita efeitos duplicados em reenvios. |
| `api/src/outbox/enqueue.ts` | Insere eventos transacionais na tabela `outbox` (com `aggregate_type`), ligando mudanças de negócio à publicação assíncrona. |
| `api/src/outbox/worker.ts` | Aluga eventos com `SKIP LOCKED`, preserva ordem por agregado, publica fora de transação, agenda retentativas com backoff e, na 20ª falha, manda o evento para a dead-letter (`dead_at`). `outboxStats` alimenta `/metrics` e o log do worker. |
| `api/src/outbox/publishers.ts` | `LogPublisher` e `WebhookPublisher` (com assinatura HMAC-SHA256 quando há `OUTBOX_WEBHOOK_SECRET`). |
| `api/src/outbox/retry-policy.ts` | Backoff e teto de tentativas, puros e testados sem banco. |
| `api/src/outbox/routes.ts` | `GET /outbox/dead` e `POST /outbox/:id/retry`: a loja vê e destrava eventos parados. |
| `api/src/dashboard/` | `GET /dashboard/summary`: contagens, atrasados, produção e menores saldos em uma requisição (antes o painel fazia 14). |
| `api/src/worker.ts` | Escolhe publisher de log ou webhook, inicia o laço e, a cada volta, toca o heartbeat (healthcheck do Compose), registra as métricas do outbox por minuto e roda a retenção por hora. |
| `api/src/scripts/migrate.mjs` | Lê migrations em ordem, cria/consulta `schema_migrations` e aplica somente as pendentes. |
| `api/src/scripts/create-user.ts` | Cria a conta inicial pelo terminal, pede senha sem eco e grava apenas o hash. Não existe cadastro público. |
| `api/Dockerfile` | Faz build TypeScript e gera a imagem executável da API/worker. |
| `api/.dockerignore` | Evita enviar dependências, artefatos e arquivos locais desnecessários para o contexto do build. |
| `api/tsconfig.json` | Configura compilação TypeScript do backend. |
| `api/package.json` | Define dependências e scripts de desenvolvimento, build, migração, testes e worker. |
| `api/package-lock.json` | Fixa as versões instaladas para builds reproduzíveis. |

## 6. Módulo de catálogo

O catálogo representa o que pode ser vendido: SKU, nome, preço em centavos e flag ativo.

| Arquivo | Função |
|---|---|
| `catalog/product.ts` | Tipos `ProductInput`, `Product`, `ProductPatch` e `ProductFilter`. É o contrato interno do catálogo. |
| `catalog/product-input.ts` | Valida ID, SKU, nome, preço, patch e filtros. Centraliza limites como preço inteiro não negativo. |
| `catalog/product-repository.ts` | SQL de inserir, buscar, listar e atualizar produtos; converte snake_case do banco para camelCase. |
| `catalog/product-service.ts` | Casos de uso de criação, listagem, consulta e edição; traduz SKU duplicado e produto inexistente para erros de domínio. |
| `catalog/routes.ts` | Expõe `POST/GET/PATCH /products` e conecta HTTP à validação e aos serviços. |

O preço é inteiro em centavos para evitar erros de ponto flutuante. SKU e identidade são imutáveis depois da criação porque pedidos, receitas e integrações dependem deles.

## 7. Módulo de estoque e materiais

Há dois estoques diferentes:

- peças prontas: `physical`, `reserved` e `available`;
- filamento: gramas físicas, reservadas e disponíveis.

Misturar essas unidades seria perigoso; por isso peças e materiais têm repositórios e serviços próprios.

| Arquivo | Função |
|---|---|
| `inventory/inventory-input.ts` | Valida ajustes de estoque e filtros de listagem/movimentos. |
| `inventory/inventory-repository.ts` | Atualiza saldo, reserva atomicamente, bloqueia linhas, registra movimentos e calcula demanda/oferta. |
| `inventory/inventory-service.ts` | Orquestra ajustes idempotentes, consulta saldos e dispara realocação de pedidos quando surge estoque. |
| `inventory/material-input.ts` | Valida materiais, custo/kg, ajustes em gramas e linhas de receita. |
| `inventory/material-repository.ts` | Persiste materiais, custos, movimentos, receitas e operações de reserva/consumo de gramas. Usa strings decimais para preservar precisão. |
| `inventory/material-service.ts` | Cria/edita materiais, aplica ajustes protegidos por lock e mantém a receita produto-material. |
| `inventory/rules.ts` | Regras puras de estoque, especialmente cálculo de falta de produção e consistência de saldo. |
| `inventory/routes.ts` | Rotas de inventário, materiais, ajustes, movimentos e receitas. |

A reserva de filamento acontece quando um job começa. Se o job for cancelado, a quantidade reservada é devolvida; se concluir, a quantidade real consumida é registrada e o estoque de peças aumenta.

## 8. Módulo de pedidos

Um pedido passa por estados internos:

```text
pending_mapping → awaiting_stock → reserved → ready → shipped
                         └────────────────────────→ cancelled
```

Qualquer estado anterior a `shipped` pode ser cancelado, respeitando as regras de negócio.

| Arquivo | Função |
|---|---|
| `orders/channels.ts` | IDs e metadados dos canais fixos, como manual e simulador. |
| `orders/order-input.ts` | Valida corpo de criação, cancelamento, paginação e parâmetros de pedidos. |
| `orders/order-rules.ts` | Estados válidos, transições, status externo e derivação do estado a partir das reservas. |
| `orders/order-repository.ts` | CRUD, locks, itens, status e histórico. É a porta SQL do agregado pedido. |
| `orders/order-view-repository.ts` | Monta a visão detalhada do pedido com itens, reservas, jobs, expedição e histórico. |
| `orders/reservation-repository.ts` | Cria e altera reservas individuais, cuja unicidade impede reservar o mesmo item duas vezes. |
| `orders/shipment-repository.ts` | Persiste etiqueta e etapas internas de expedição. |
| `orders/allocation-port.ts` | A interface do fulfillment que pedidos precisa (alocar, liberar, realocar), implementada e registrada pelo módulo `fulfillment/`. |
| `fulfillment/allocation.ts` | Reserva itens disponíveis, calcula faltas, cria jobs, realoca pedidos quando estoque aumenta e libera reservas. É o núcleo da concorrência entre pedido e estoque. |
| `fulfillment/index.ts` | `registerFulfillment()`: liga a porta de pedidos e o aviso "saldo subiu" de estoque/produção às funções acima. |
| `inventory/stock-events.ts` | `onStockIncreased`/`notifyStockIncreased`: estoque e produção avisam que o saldo livre de um produto aumentou, sem saber quem escuta. |
| `orders/order-service.ts` | Cria/cancela/aloca pedidos (pela porta) e executa pronto, etiqueta e expedição dentro de transações. Também publica eventos de domínio. |
| `orders/routes.ts` | Expõe as rotas HTTP de pedidos e exige `Idempotency-Key` na criação. |

A criação de pedido é idempotente: mesma chave com mesmo corpo reproduz a resposta; mesma chave com corpo diferente retorna 409. Além disso, `UNIQUE(channel_id, external_order_id)` evita duplicidade de pedidos externos.

## 9. Módulo de produção

Jobs podem nascer de um pedido ou ser criados diretamente para recompor estoque. A fila é ordenada por prazo, prioridade e data de criação.

```text
queued → printing → done
   └──────────────→ cancelled
pedido cancelado → on_hold → cancel ou continue_for_stock
```

| Arquivo | Função |
|---|---|
| `production/production-input.ts` | Valida filtros, criação de job, gramas reais, cancelamento, decisão de job pausado e prioridade. |
| `production/production-rules.ts` | Estados, ordenação da fila, identificação de materiais bloqueadores e conversão precisa de gramas. |
| `production/production-repository.ts` | SQL de jobs, locks, materiais do job, status, prioridade, histórico e cancelamento de jobs redundantes. |
| `production/production-service.ts` | Cria, inicia, conclui, cancela e decide jobs. Coordena reservas de filamento, entrada de peças e realocação de pedidos. |
| `production/routes.ts` | Rotas da fila e ações de produção. |

Um job não começa se faltar filamento de alguma cor. Na conclusão, `actualGrams` pode registrar o consumo real, permitindo comparar estimativa e consumo efetivo.

## 10. Módulo de integrações

O projeto usa uma abstração de conector para que o simulador possa ser substituído futuramente por Mercado Livre ou Shopee sem reescrever a importação.

| Arquivo | Função |
|---|---|
| `integrations/connector.ts` | Define `MarketplaceConnector`, pedidos externos, páginas, shipments, falhas e retry com timeout. |
| `integrations/simulated-connector.ts` | Implementa fixtures previsíveis de marketplace; deixa claro que nenhuma plataforma real está conectada. |
| `integrations/integration-input.ts` | Valida pedidos externos, itens, status e mapeamentos, com limites de lote. |
| `integrations/integration-repository.ts` | Persiste eventos recebidos, cursores, falhas, SKUs externos e canais. |
| `integrations/sku-mapping-service.ts` | Converte SKU externo em produto interno e reprocessa pedidos pendentes quando o mapeamento é criado. |
| `integrations/import-service.ts` | Importa pedidos, deduplica eventos, aplica status monotônico, retoma por cursor e produz resumo da sincronização. |
| `integrations/routes.ts` | Rotas de sync, importação manual, canais, pendências, mapeamentos e erros. |

A importação é segura para repetição porque usa:

- `UNIQUE(channel_id, event_id)` para eventos;
- `UNIQUE(channel_id, external_order_id)` para pedidos;
- cursor salvo apenas depois que a página inteira foi processada;
- status externo que nunca regride.

## 11. Módulo de precificação

O módulo calcula custo e preço usando somente inteiros: centavos, miligramas e pontos-base. Isso evita erros acumulados de `number` decimal.

| Arquivo | Função |
|---|---|
| `pricing/pricing-input.ts` | Valida configurações, canais, ficha de custo e parâmetros de preview. |
| `pricing/pricing-rules.ts` | Regras puras de custo, purga, energia, desgaste, falhas, mão de obra, tarifa, imposto, margem e preço sugerido. |
| `pricing/pricing-repository.ts` | Persiste settings, canais, ficha de custo e consultas de custo por produto. |
| `pricing/pricing-service.ts` | Monta a visão completa de precificação, salva fichas e converte pontos-base para o formato da API. |
| `pricing/routes.ts` | Rotas de configuração, canais, preview, ficha e listagem de custos. |

O cálculo considera:

```text
custo = filamento + purga + energia + desgaste + falhas + mão de obra + embalagem + extras
preço = (custo + tarifa fixa) / (1 - tarifa percentual - imposto - margem)
```

Quando o denominador é zero ou negativo, o preço sugerido é `null`. O sistema também devolve alertas para receita ausente, filamento sem preço e parâmetros de energia/desgaste não configurados.

## 12. Segurança e autenticação

| Arquivo | Função |
|---|---|
| `security/auth-input.ts` | Valida e normaliza e-mail e senha do login. |
| `security/auth-service.ts` | Autentica, usa hash dummy para reduzir diferença de tempo entre usuário existente e inexistente e aplica os limitadores. |
| `security/csrf.ts` | Configura `csrf-sync` e exporta a proteção/token. |
| `security/login-limiter.ts` | Implementa contagem persistente e atômica de tentativas por IP, IP+e-mail e conta. Guarda hashes das chaves. |
| `security/password.ts` | Hash e verificação com `scrypt` (`N=2^15, r=8, p=3`), salt aleatório, comparação timing-safe e `needsRehash`: um hash gravado com parâmetros antigos é refeito no próximo login certo. |
| `security/require-auth.ts` | Verifica sessão e carrega usuária ativa para `res.locals`. |
| `security/routes.ts` | Endpoints de CSRF, login, sessão atual e logout; regenera a sessão no login. |
| `security/session.ts` | Configura cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção e armazenamento em PostgreSQL via `connect-pg-simple`. |
| `security/user-repository.ts` | Busca credenciais para login e usuários ativos para sessão. |

O login também exige CSRF. A sessão anônima criada para obter o primeiro token expira em 10 minutos; depois do login a sessão é regenerada para evitar session fixation. Todas as escritas da aplicação exigem `X-CSRF-Token`.

`requireAuth` consulta a tabela `users` a cada requisição: desativar a conta tem efeito imediato, ao custo de uma consulta por chamada. Com uma única usuária o custo é irrelevante; vale lembrar se surgirem mais contas.

## 13. Frontend: arquitetura React

O frontend não usa biblioteca global de estado nem biblioteca de UI. A organização separa:

- `api/`: transporte e contratos;
- `hooks/`: estado assíncrono e ações;
- `features/`: telas e lógica específica de cada domínio;
- `components/ui/`: design system reutilizável;
- `lib/`: funções puras e formatação;
- `styles/`: tokens, base, layout e componentes.

A regra principal é: componentes `.tsx` apresentam e coordenam a tela; hooks `.ts` carregam dados e executam ações; regras derivadas ficam em arquivos puros testáveis.

### Entrada e composição

| Arquivo | Função |
|---|---|
| `web/src/main.tsx` | Ponto de entrada React; monta `App` no DOM. |
| `web/src/App.tsx` | Decide entre login, loading e painel autenticado usando `useSession`. |
| `web/src/app/routes.ts` | Catálogo central de rotas do menu e resolução por hash. |
| `web/src/api/types.ts` | Tipos TypeScript que espelham os contratos da API. |
| `web/src/api/client.ts` | Wrapper de `fetch`, cookie, CSRF, parsing de erro, tratamento de 401 e query string. |
| `web/src/api/endpoints.ts` | Uma função por endpoint; é a camada que traduz intenção da feature em HTTP. |

O uso de hash route (`#/produtos`, por exemplo) não depende de fallback de rotas no servidor (o `nginx.conf` tem `try_files … /index.html` apenas por segurança). Seção, item aberto e filtros ficam no hash (`#/pedidos/<id>?status=ready&page=2`, montado e lido por `lib/hash.ts`): recarregar ou compartilhar o link preserva o contexto, e trocar só o item ou um filtro não rouba o foco da seção.

Um `ErrorBoundary` (`components/ErrorBoundary.tsx`) envolve cada seção (com `key` na rota, para remontar limpo ao navegar) e o painel inteiro: um erro de renderização mostra a mensagem e um botão para tentar de novo, em vez de deixar a tela em branco.

Listas nunca têm teto silencioso: seleções de produto usam o `ProductPicker` (busca incremental na API, 20 resultados e aviso para refinar), filas e tabelas são paginadas, e as poucas listas carregadas inteiras (filamentos) percorrem as páginas com `lib/pages.ts` e avisam se passarem do limite.

### Hooks compartilhados e utilitários

| Arquivo | Função |
|---|---|
| `hooks/useAction.ts` | Controla submissão, loading e feedback, evitando duplo envio. |
| `hooks/useDebouncedValue.ts` | Atrasa buscas enquanto a usuária digita. |
| `hooks/useHashRoute.ts` | Lê e altera a rota baseada em hash. |
| `hooks/usePagination.ts` | Mantém página, tamanho e navegação de listas. |
| `hooks/useResource.ts` | Padroniza loading, erro, reload e dados de recursos GET. |
| `hooks/useSession.ts` | Inicializa sessão, guarda usuária/token CSRF e executa login/logout. |
| `lib/charts.ts` | Cálculos geométricos para gráficos, sem dependência visual externa. |
| `lib/errors.ts` | Converte erros da API para mensagens apresentáveis. |
| `lib/format.ts` | Formata moeda, números, gramas, datas, nomes e iniciais. |
| `lib/idempotency.ts` | Gera chaves para ações que precisam ser repetíveis com segurança. |
| `lib/labels.ts` | Mapeia estados para rótulo, tom e semântica visual. |
| `lib/parse.ts` | Converte inputs de moeda, gramas e números para os formatos da API. |

### Layout e design system

| Arquivo | Função |
|---|---|
| `components/layout/AppShell.tsx` | Estrutura principal autenticada, sidebar e conteúdo da rota atual. |
| `components/layout/Sidebar.tsx` | Menu, identificação da usuária e logout. |
| `components/ui/AlertList.tsx` | Lista de alertas curtos. |
| `components/ui/Badge.tsx` | Badges semânticos e `StatusBadge`. |
| `components/ui/BarList.tsx` | Lista de barras proporcionais. |
| `components/ui/Button.tsx` | Botão com variantes, ícones e estados. |
| `components/ui/Card.tsx` | Painel visual reutilizável. |
| `components/ui/DataTable.tsx` | Tabela genérica tipada por colunas. |
| `components/ui/DonutChart.tsx` | Gráfico de rosca usando cálculos de `lib/charts.ts`. |
| `components/ui/Drawer.tsx` | Painel lateral/modal para edição contextual. |
| `components/ui/EmptyState.tsx` | Estado vazio consistente. |
| `components/ui/Field.tsx` | Inputs e selects acessíveis e padronizados. |
| `components/ui/Form.tsx` | Formulário, ações e feedback. |
| `components/ui/Icon.tsx` | Ícones SVG definidos localmente por nome. |
| `components/ui/Notice.tsx` | Mensagens de sucesso/erro/aviso. |
| `components/ui/PageHeader.tsx` | Cabeçalho de página com descrição e ações. |
| `components/ui/Pager.tsx` | Paginação visual. |
| `components/ui/ProgressBar.tsx` | Barra de progresso semântica. |
| `components/ui/ResourceView.tsx` | Alterna loading, erro, vazio e conteúdo. |
| `components/ui/SegmentedControl.tsx` | Controle de opções em segmentos. |
| `components/ui/Skeleton.tsx` | Placeholder durante carregamento. |
| `components/ui/StatCard.tsx` | Cartão de métrica com tom e ícone. |

Centralizar esses elementos evita que cada feature invente seus próprios estados de loading, erro, tabela, botão e semântica de cores. Os estilos são divididos em `tokens.css` (variáveis e tons), `base.css` (normalização e tipografia), `layout.css` (grid, shell e responsividade) e `components.css` (aparência dos componentes).

### Configuração e entrega do frontend

| Arquivo | Função |
|---|---|
| `web/index.html` | HTML raiz que fornece o elemento onde React é montado e carrega o módulo de entrada. |
| `web/public/favicon.svg` | Ícone estático do painel. |
| `web/vite.config.ts` | Configura Vite, plugin React e proxy de desenvolvimento para `/api`. |
| `web/tsconfig.json` | Configuração base de TypeScript do frontend. |
| `web/tsconfig.app.json` | Opções de TypeScript para o código da aplicação. |
| `web/tsconfig.node.json` | Opções de TypeScript para arquivos de configuração executados no Node, como o Vite. |
| `web/package.json` | Scripts de dev, build, lint e testes, além das dependências React/Vite. |
| `web/package-lock.json` | Fixa as versões do frontend. |
| `web/Dockerfile` | Compila o painel e cria a imagem final de entrega estática. |
| `web/nginx.conf` | Serve o build, envia os cabeçalhos de segurança do HTML (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` e uma `Content-Security-Policy` sem inline), aceita corpos até 256 kB, repassa `X-Request-Id` e encaminha `/api/*` para o serviço `api` dentro do Compose. `Strict-Transport-Security` fica comentado até existir TLS. |

Na produção o browser recebe arquivos estáticos; não existe renderização React no servidor. O nginx é também o ponto de mesma origem que permite cookies de sessão e CSRF sem CORS.

## 14. Features do frontend

Cada feature combina uma tela `.tsx`, hooks de dados e componentes especializados.

| Feature | Arquivos e responsabilidade |
|---|---|
| `features/auth` | `LoginPage.tsx` apresenta o formulário; `useLoginForm.ts` controla campos, validação e feedback. |
| `features/dashboard` | `DashboardPage.tsx` compõe o painel; `useDashboard.ts` carrega recursos; `dashboard-metrics.ts` deriva métricas puras; `UpcomingShipments.tsx` mostra próximos envios. |
| `features/products` | `ProductsPage.tsx` e `ProductsTable.tsx` listam catálogo; `ProductForm.tsx` cria/edita; `StockAdjustmentForm.tsx` ajusta saldo; `useProducts.ts`, `useProductForm.ts` e `useStockAdjustment.ts` isolam ações e dados. |
| `features/materials` | `MaterialsPage.tsx` compõe a seção; `MaterialsTable.tsx` mostra/ajusta filamento; `MaterialForm.tsx` cria material; `RecipeEditor.tsx` edita receita; `useMaterials.ts` concentra hooks. |
| `features/orders` | `OrdersPage.tsx` lista e abre pedido; `OrdersTable.tsx` apresenta a fila; `OrderDetail.tsx` mostra o agregado e ações; `OrderForm.tsx` cria pedidos; `order-rules.ts` deriva regras de apresentação; `useOrders.ts` coordena dados e ações. |
| `features/production` | `ProductionPage.tsx` mostra a fila; `JobCard.tsx` apresenta bloqueios e ações; `useProductionQueue.ts` carrega jobs e executa transições. |
| `features/shipping` | `ShippingPage.tsx` apresenta expedição; `ShippingColumn.tsx` organiza pedidos por etapa; `useShipping.ts` carrega e executa pronto/etiqueta/expedição. |
| `features/integrations` | `IntegrationsPage.tsx` controla sync, erros e pendências; `SkuMappingRow.tsx` resolve cada SKU; `useIntegrations.ts` carrega canais, produtos, pendências e ações. |
| `features/pricing` | `PricingPage.tsx` orquestra calculadora; cards/forms/editors dividem custo, canais, ficha e mistura de filamentos; `useCostCalculator.ts`, `useFilamentMix.ts` e `usePricingConfig.ts` isolam estado e chamadas; `filament-mix.ts` e `pricing-view.ts` são derivações puras testáveis. |

Essa estrutura é organizada por domínio porque uma alteração em pedidos tende a envolver a tela, seus hooks e seus componentes, sem espalhar conhecimento por todo o frontend.

## 15. Testes

### Backend

| Arquivo/pasta | O que protege |
|---|---|
| `api/test/http.test.ts` | Contratos HTTP, autenticação, CSRF, erros e limites. |
| `api/test/inventory-rules.test.ts` | Regras puras de estoque. |
| `api/test/order-rules.test.ts` | Estados e transições de pedidos. |
| `api/test/pricing-rules.test.ts` | Cálculos de custo e preço. |
| `api/test/production-rules.test.ts` | Ordenação e bloqueios da fila. |
| `api/test/security-connector.test.ts` | Segurança e comportamento do conector/retry. |
| `api/test/integration/*.test.ts` | PostgreSQL real: pedidos, concorrência, importação, produção, preço, worker e login. |
| `api/test/integration/setup.ts` | Prepara e recria o schema do banco de teste. Exige nome terminado em `_test`. |

Os testes puros são rápidos e isolam regras matemáticas/estados. Os testes de integração verificam o que só aparece com transações, locks, constraints e concorrência real.

### Frontend

| Arquivo | O que protege |
|---|---|
| `dashboard-metrics.test.ts` | Derivações do dashboard, próximos envios e indicadores. |
| `pricing/filament-mix.test.ts` | Composição e distribuição de filamentos. |
| `pricing/pricing-view.test.ts` | Formatação/derivação da visão de precificação. |
| `lib/charts.test.ts` | Cálculos de gráficos. |
| `lib/format.test.ts` | Formatação de valores. |
| `lib/parse.test.ts` | Conversão e validação de inputs. |

Só há testes de funções puras no painel (inclusive `lib/hash.test.ts`, do roteamento); componentes e fluxos (hooks que recarregam após uma ação, formulários) dependem do roteiro manual do README. Esses testes exigem Node 24 (com Node 21 todos falham com `ERR_UNKNOWN_FILE_EXTENSION`); os dois `package.json` declaram `engines.node >= 24` e o job `web` do CI roda `lint`, `test` e `build`.

## 16. Fluxos importantes de ponta a ponta

### Criar pedido com estoque

1. `OrderForm.tsx` chama `ordersApi.create`.
2. `client.ts` envia sessão, CSRF e `Idempotency-Key`.
3. `orders/routes.ts` valida o corpo.
4. `order-service.ts` cria pedido e itens em transação.
5. `allocation.ts` tenta `reserveIfAvailable` para cada item.
6. `inventory-repository.ts` grava saldo e movimento.
7. O pedido vai para `reserved`; na mesma transação entram na outbox `order.status_changed` (awaiting_stock → reserved) e `order.created`.

### Criar pedido sem estoque

1. A reserva atômica não encontra saldo.
2. `allocation.ts` calcula a falta real descontando demanda e jobs já abertos.
3. É criado no máximo um job aberto por item.
4. O pedido fica `awaiting_stock`.
5. Ao concluir a produção, o saldo aumenta e pedidos em espera são realocados na ordem de prazo.

### Expedir

1. A interface executa `ready`, `label` e `dispatch` separadamente.
2. O serviço valida o estado anterior.
3. A expedição baixa `physical` e `reserved` uma vez por reserva.
4. A operação usa chave idempotente `ship:<reservationId>`.
5. O pedido vira `shipped` e um evento é publicado depois pelo worker.

### Sincronizar marketplace simulado

1. A tela chama `integrationsApi.syncSimulator`.
2. O conector entrega páginas/fixtures.
3. `import-service.ts` valida, deduplica e tenta mapear cada SKU.
4. SKU desconhecido fica pendente, sem criar um pedido inválido.
5. Ao mapear o SKU, os pedidos pendentes são reprocessados.

## 17. Decisões de organização e seus motivos

- **Monólito modular:** mantém consistência transacional entre pedidos, estoque e produção sem complexidade de rede.
- **Serviços e repositórios separados:** permite testar regras e trocar detalhes SQL sem colocar regra de negócio na rota.
- **Entradas `unknown`:** força validação explícita e impede que o TypeScript seja confundido com validação em runtime.
- **Inteiros para dinheiro e pontos-base:** elimina arredondamentos implícitos em custos e preços.
- **Strings decimais para gramas:** preserva precisão de até três casas e evita perdas em `number`.
- **Histórico append-only:** permite auditoria de ajustes, reservas, consumo e expedição.
- **Outbox transacional:** evita o problema de atualizar o banco e perder a publicação do evento.
- **Idempotência em várias camadas:** protege reenvio HTTP, importação externa e operações de estoque.
- **Frontend por feature:** mantém a lógica de cada domínio próxima da sua tela e reduz acoplamento.
- **Design system local:** garante consistência visual sem adicionar dependência de UI pesada.
- **Hash routing:** simplifica a hospedagem de arquivos estáticos pelo nginx.

## 18. Limitações atuais

- Não há conectores reais de Mercado Livre ou Shopee; existe apenas o simulador.
- O destino da outbox é log ou webhook genérico, ainda sem consumidor de negócio real.
- A reserva de um item é tudo-ou-nada: se faltarem unidades, o pedido aguarda a quantidade inteira.
- O sistema modela uma única loja e uma conta de dona; não há permissões por equipe.
- O cálculo de preço não inclui frete nem despesas fixas mensais.

Limites técnicos conhecidos (o histórico do que foi avaliado e aplicado está em `docs/avaliacao-arquitetura.md`):

- Os tipos do contrato continuam duplicados à mão em `web/src/api/types.ts` (hoje em dia com o backend); o CI não compara os dois. A evolução prevista é um pacote de contratos compartilhado via workspaces npm.
- Não há teste de contrato nem e2e no navegador: o roteiro do README segue manual.
- O `compose.yaml` não tem TLS: serve para demonstração local. Para expor na internet, terminador HTTPS na frente do `web`, `COOKIE_SECURE=true` e HSTS no nginx.
- Uma única conta de dona; não há papéis nem permissões por equipe.
- As métricas de `GET /metrics` são por instância e em memória: zeram a cada reinício e não são agregadas por um coletor.

## 19. Checklist para alterar o sistema

Ao adicionar uma funcionalidade de negócio:

1. defina ou altere a migration, sem editar migrations aplicadas;
2. crie/ajuste tipos e parser `*-input.ts`;
3. coloque regras sem efeitos colaterais em `*-rules.ts`;
4. implemente SQL no repository;
5. orquestre transação, locks, histórico e outbox no service (se a mudança cruza pedidos, estoque e produção, ela passa por `fulfillment/allocation.ts`; respeite a ordem de locks pedido → jobs → estoque → materiais e as regras de dependência do `dependency-cruiser`);
6. exponha a rota;
7. atualize `api/types.ts` e `api/endpoints.ts`;
8. crie hook e componentes na feature correspondente;
9. adicione testes puros e de integração quando houver concorrência ou banco;
10. atualize `docs/api.md`, `docs/arquitetura.md` e este tutorial se o contrato ou a arquitetura mudarem.

Comandos de verificação (com Node 24 ativo: `nvm use` lê o `.nvmrc`):

```bash
cd api
npm test
npm run test:integration
npm run typecheck
npm run deps:check
npm run build

cd ../web
npm test
npm run lint
npm run build
```

