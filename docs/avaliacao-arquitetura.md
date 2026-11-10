# Avaliação de arquitetura do Três Eixos

Data: 2026-11-05. Base: branch `feat/desenvolvimento-do-frontend`, commit `137cb51`. Atualizado em 2026-11-06 com o que foi aplicado (seção 7).
Escopo: backend (`api/`), frontend (`web/`), banco (migrations 001 a 009), infraestrutura (Compose, Dockerfiles, nginx, CI) e documentação.

Verificação feita antes da análise: `npm run typecheck` e `npm test` da API passam (30 testes); `npm run lint`, `tsc -b` e `npm test` do web passam com Node 24 (6 arquivos de teste). Os testes do web falham com Node 21 porque dependem do type stripping nativo do Node (ver item 3 dos pontos fracos).

Método: protocolo de evolução do Arquiteto Bob (Martin, Evans, Vernon, Fowler, Nygard, Kleppmann, Ford/Richards, Ousterhout). Cada apontamento traz a severidade e, quando vem de um autor específico, a atribuição.

---

## 1. Resumo executivo

O sistema é um **monólito modular bem calibrado** para o problema: uma loja, uma conta, poucas centenas de pedidos. A complexidade está onde o risco está (concorrência de estoque, idempotência, outbox) e não onde não precisa (sem ORM, sem framework de estado no front, sem microserviços). Isso é raro e é o maior mérito do projeto.

Os pontos fracos não são bugs de regra de negócio; são **limites de crescimento e de operação**: um ciclo de dependência entre módulos escondido em `allocation.ts`, contratos duplicados à mão entre API e painel, listas com teto fixo de 100 itens no front, ausência de observabilidade e de retenção de dados, e dois descuidos de processo (CI não roda os testes do web; cabeçalhos de segurança estão na camada errada).

Nota geral por dimensão (1 a 5):

| Dimensão | Nota | Comentário |
|---|---|---|
| Arquitetura de software | 4 | Camadas limpas e proporcionais; ciclo entre módulos é o débito principal |
| Arquitetura de dados | 4,5 | Invariantes no banco, inteiros para dinheiro, histórico append-only; falta política de retenção |
| Concorrência e consistência | 5 | Reserva atômica, ordem de locks, SKIP LOCKED, idempotência em três camadas |
| Segurança | 4 | Sessão, CSRF, scrypt, rate limit persistente; faltam cabeçalhos no HTML, segredos no Compose, código de erro |
| Clareza e organização | 4,5 | Nomes consistentes, comentários de "porquê", arquivos pequenos |
| Resiliência e operação | 2,5 | Sem logs estruturados, métricas, dead-letter, retenção ou alerta |
| Frontend | 3,5 | Boa separação e acessibilidade; limites de 100 itens, sem error boundary, sem testes de componente |
| Testes e CI | 3,5 | Regras puras + PostgreSQL real; CI não roda testes do web; sem e2e |
| Documentação | 5 | README, arquitetura, API e tutorial coerentes com o código |

---

## 2. Diagnóstico por dimensão

### 2.1 Estrutural (Martin, Vernon)

**Pontos fortes**

- A Dependency Rule é respeitada dentro de cada módulo: `routes → input → service → repository`, e nenhum repositório importa `http/`. Verificado por leitura de todos os `*-repository.ts`.
- Módulos nomeados pelo domínio (`orders`, `production`, `inventory`, `pricing`), não pela técnica. A árvore "grita" o negócio (screaming architecture).
- `app.ts` e `server.ts` separados: a aplicação é importável nos testes sem abrir porta.
- O conector de marketplace é uma interface (`MarketplaceConnector`) com um adapter simulado; a importação não conhece o provedor. É a única fronteira externa e está protegida (Anti-Corruption Layer de fato).

**Pontos fracos**

- **[Importante] Ciclo de dependência entre módulos.** `inventory/inventory-service.ts` importa `orders/allocation.ts`; `allocation.ts` importa `inventory/inventory-repository.ts` e `production/production-repository.ts`; `production/production-service.ts` importa `orders/allocation.ts`; `integrations/*` importa `orders/*`. O grafo entre módulos é `inventory ⇄ orders ⇄ production`. O código funciona porque é um único processo, mas o "monólito modular" não tem fronteira enforced: qualquer arquivo pode importar qualquer outro. Vernon chamaria isso de *big ball of mud em formação*; Martin apontaria violação do Acyclic Dependencies Principle.
  - Causa raiz: `allocation.ts` é um **serviço de domínio de fulfillment** (reservar, enfileirar produção, realocar quando entra saldo). Ele pertence a nenhum dos três módulos e hoje mora em `orders/`.
  - Consequência: uma regra nova de alocação exige tocar três módulos; um teste de `inventory` carrega `orders` e `production`.
- **[Moderado] Repositórios com assinaturas inconsistentes.** Alguns recebem `db: Queryable` (funcionam dentro ou fora de transação), outros usam `pool` fixo (`updateProduct`, `upsertRecipeLine`, `saveSettings`, `insertMaterial`) e portanto não podem participar de uma transação. Quem chama precisa saber qual é qual.

### 2.2 Domínio (Evans, Vernon, Fowler)

**Pontos fortes**

- Linguagem ubíqua consistente entre código, banco, API, painel e docs: reserva, alocação, job, receita, purga, canal, ficha de custo. Não há "manager", "helper" ou "data".
- Agregados implícitos bem delimitados: Pedido (itens, reservas, envio, histórico), Job (materiais reservados, histórico), Estoque por produto, Material. Os locks seguem exatamente essas raízes (`lockOrder`, `lockJob`, `lockInventory`, `lockMaterial…`).
- Padrão de lógica de domínio: **Transaction Script + Repository** (Fowler), com as regras puras extraídas em `*-rules.ts`. É a escolha certa para esta complexidade; um Domain Model rico aqui seria cerimônia sem retorno (Ousterhout).
- Estados como enums explícitos com transições validadas no serviço e `CHECK` no banco. Ações HTTP explícitas (`/cancel`, `/ready`, `/dispatch`) em vez de `PATCH status`.
- Estado interno do pedido separado do estado externo da plataforma, com rank monotônico. Decisão madura para integrações.

**Pontos fracos**

- **[Menor] Erros sem código de máquina.** A API devolve `{ error: "SKU já cadastrado" }` e o painel compara a string (`describeError`). Um ajuste de texto no backend quebra a UX silenciosamente. Falta `code: "sku_taken"` ao lado da mensagem.
- **[Menor] Regra de alocação tudo-ou-nada** e **um único job aberto por item** são decisões de negócio corretas e documentadas, mas não há parâmetro para mudá-las; quando a loja crescer, "reservar parcial" será o primeiro pedido.

### 2.3 Dados (Kleppmann, Fowler)

**Pontos fortes**

- Invariantes no banco, não só na aplicação: `CHECK (reserved <= physical)`, `CHECK (reserved_grams <= physical_grams)`, `UNIQUE (channel_id, external_order_id)`, índice único parcial para "um job aberto por item", `CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))`. O banco é a última barreira e a aplicação sabe disso.
- Tipos corretos para cada grandeza: dinheiro em `integer` centavos, percentuais em pontos-base, gramas em `numeric(12,3)` trafegando como texto, aritmética com `BigInt`. Zero ponto flutuante nas regras de custo.
- Histórico append-only com `operation_key` única: movimentos de estoque, de material, histórico de status de pedido e de job. Auditoria e idempotência saem da mesma estrutura.
- Migrations append-only, aplicadas em transação com advisory lock; executor de 40 linhas sem dependência.
- Outbox com `seq` (identidade) para ordenar eventos da mesma transação e índice parcial por agregado.
- `FOR UPDATE SKIP LOCKED` na realocação para não inverter a ordem de locks (estoque → pedido) e `lock_timeout` por transação. Deadlock, serialização e timeout viram 409.

**Pontos fracos**

- **[Importante] Sem política de retenção.** Crescem sem limpeza: `idempotency_keys` (cada `POST /inventory/adjustments` sem chave grava uma linha com UUID aleatório que nunca será reutilizada), `outbox` publicado, `integration_events` processados, `stock_movements` (este é auditoria, deve crescer, mas precisa de estratégia de arquivamento). `login_attempts` depende de `Math.random() < 0.05` no caminho da requisição. Nygard: todo sistema precisa de steady state.
- **[Moderado] Índice faltante.** `demandAndSupply` e a subconsulta de `listInventory` filtram `production_jobs` por `product_id` + `status`; o único índice é `(status, priority DESC, created_at)`. Com poucas centenas de jobs é invisível; com milhares, cada listagem de estoque faz N scans.
- **[Menor] `queryPage` executa lista e contagem em conexões diferentes do pool**, sem snapshot comum; o `total` pode divergir da página sob escrita concorrente. Irrelevante hoje; vale documentar.
- **[Menor] `aggregate_id` do outbox é polimórfico** (id de pedido ou de job) sem coluna `aggregate_type`. Um consumidor real precisará inferir pelo `topic`.

### 2.4 Resiliência e produção (Nygard)

**Pontos fortes**

- Timeout e retry com backoff exponencial e `retryAfterMs` no conector; chamada externa nunca dentro de transação; cursor salvo só após página inteira.
- Outbox: aluguel com `lease_id`, publicação fora de transação, só o dono do aluguel escreve o resultado, encerramento gracioso termina o lote.
- `/health` e `/ready` separados; `/ready` responde 503 durante shutdown; `SIGTERM` fecha servidor, sessões e pool.
- Pool pequeno (5) com `connectionTimeoutMillis`; `lock_timeout` de 5 s.

**Pontos fracos**

- **[Importante] Observabilidade inexistente.** `console.log` sem estrutura, sem request id, sem latência por rota, sem contagem de 409/500, sem métricas do worker (eventos pendentes, idade do mais antigo). Quando algo falhar em produção, a única fonte será o `docker compose logs`.
- **[Importante] Outbox sem dead-letter nem teto de tentativas.** Um evento que sempre falha (webhook fora do ar, payload rejeitado) é reagendado a cada 15 min para sempre e **bloqueia todos os eventos posteriores do mesmo agregado**. Isso é intencional para ordem, mas sem alerta ninguém descobre.
- **[Moderado] Worker sem healthcheck** (desabilitado no Compose) e sem forma de saber se está vivo além do log.
- **[Moderado] Sem timeout de requisição HTTP no servidor** (`server.requestTimeout`/`headersTimeout` nos padrões do Node); uma conexão lenta segura um dos 5 slots do pool se cair dentro de transação com lock.
- **[Menor] Sem backup automatizado.** O README ensina `pg_dump` manual.

### 2.5 Segurança

**Pontos fortes**

- Sessão no servidor (PostgreSQL), cookie `HttpOnly` + `SameSite=Lax` + `Secure` em produção, regenerada no login, anônima com 10 min de vida.
- CSRF por synchronizer token em toda escrita, inclusive no login; token só em memória no painel.
- Senha com scrypt + salt por senha, comparação timing-safe, hash dummy para igualar o tempo quando o e-mail não existe, mínimo 12 caracteres, sem cadastro público, criação via terminal sem eco.
- Rate limit de login **atômico e persistente** (INSERT … ON CONFLICT), por IP, IP+e-mail e conta, com chaves hasheadas. Resolve a corrida clássica de "200 requisições paralelas".
- Entrada sempre `unknown` + `allowOnly`: mass assignment é impossível por construção. 100% do SQL é parametrizado; `likePattern` escapa curingas; colunas nunca vêm do cliente.
- Corpo limitado (32 kB), paginação com teto, 500 sem stack trace, `x-powered-by` desligado, `trust proxy` numérico, container como `node`, banco publicado só em `127.0.0.1`, testes recusam banco que não termine em `_test`, `.env` fora do Git e das imagens.
- Payload de pedido externo reduzido ao mínimo (sem dados do comprador): LGPD by design.

**Pontos fracos**

- **[Importante] Cabeçalhos de segurança na camada errada.** `X-Frame-Options`, `X-Content-Type-Options` e `Referrer-Policy` são enviados pela API (respostas JSON), onde não protegem nada relevante. O HTML servido pelo nginx, que é o que pode ser enquadrado em iframe (clickjacking), **não tem nenhum cabeçalho**: sem `X-Frame-Options`, sem `Content-Security-Policy`, sem `Strict-Transport-Security`.
- **[Importante] Segredos e TLS no Compose.** A senha do banco (`app_dev_password`) está fixa em três lugares do `compose.yaml`; `COOKIE_SECURE` é `false` por padrão; não há terminador TLS. Está documentado como demo local, mas o arquivo é o mesmo que alguém usaria para "subir na VPS".
- **[Moderado] Parâmetros do scrypt** (`N=2^14`) abaixo da recomendação atual do OWASP (`N=2^17, r=8, p=1`) ou Argon2id. Com uma única conta e rate limit forte o risco é baixo; vale ajustar quando houver mais contas (o formato armazenado já versiona os parâmetros, então a migração é transparente).
- **[Moderado] Webhook do outbox sem assinatura.** Quando existir um consumidor real, o `POST` precisa de HMAC (ou mTLS) para o receptor confiar na origem.
- **[Menor] Limite de corpo incoerente**: 32 kB na API e 64 kB no nginx, mas `POST /imports/orders` aceita 50 pedidos × 50 itens, que não cabem em 32 kB. Hoje o limite efetivo é o do corpo, não o da validação.
- **[Menor] `requireAuth` consulta o banco em toda requisição.** É um trade-off consciente (desativar a conta tem efeito imediato) e aceitável para uma usuária; registrar que vira custo com mais contas.

### 2.6 Complexidade e clareza (Ousterhout)

**Pontos fortes**

- Arquivos pequenos (o maior do backend tem 268 linhas; do front, 112), nomes descritivos, uma responsabilidade por arquivo.
- Comentários explicam **por quê** (ordem de locks, por que SKIP LOCKED, por que o cursor só avança depois), não o quê. É o tipo de comentário que Ousterhout defende.
- Módulos "profundos": `withTransaction`, `runIdempotent`, `queryPage`, `useResource`, `useAction` têm interface de uma linha e escondem a parte difícil.
- Exceções "definidas fora de existência": repetir uma operação (`markReady` em pedido já pronto, `completeJob` em job concluído, `cancelOrder` em cancelado) devolve o estado atual em vez de erro.
- Validação própria, sem biblioteca, em 105 linhas. Para este tamanho é mais claro que um schema DSL.

**Pontos fracos**

- **[Moderado] Conhecimento duplicado entre API e painel.** `web/src/api/types.ts` espelha à mão os tipos do backend e **já divergiu**: `ProductionJob` do front não tem `estimatedMinutes`, `startedAt`, `completedAt`; `Order.productionJobs` não tem `orderItemId`; `IntegrationError` não tem `payload`; `SyncResult` não tem `cursor` nem `results`. Nada quebra hoje porque o front ignora os campos, mas o TypeScript não protege o contrato. `docs/api.md` é a terceira cópia.
- **[Menor] Monorepo sem workspaces.** Dois `package-lock.json`, duas versões de TypeScript (5.9 na API, 7.0 no web), `@types/node` duplicado, nenhum script na raiz. Dificulta o pacote compartilhado de contratos.
- **[Menor] `create-user.ts` usa API privada do readline** (`_writeToOutput`) para esconder a senha; pode quebrar em atualização do Node.

### 2.7 Frontend

**Pontos fortes**

- Regra "`.tsx` apresenta, `.ts` carrega e decide, puros derivam" cumprida em todas as features. Métricas do dashboard, visão de precificação e mistura de filamento são funções puras com testes.
- `useResource` descarta resposta antiga quando a chave muda (evita race de busca); `useAction` bloqueia envio duplo e centraliza feedback; chave de idempotência por tentativa de criação.
- Acessibilidade acima da média para um painel interno: skip link, foco movido ao trocar de seção, `aria-current`, `role="dialog"` + `aria-modal` + Esc + foco devolvido no Drawer, labels em todos os campos (inclusive ocultos), `role="status"`/`role="alert"` nos avisos, `aria-live` no custo recalculado.
- Sem dependência além de React; sem `innerHTML`, sem storage no navegador, sem segredo no bundle.
- Design system próprio (21 componentes) com tons semânticos reutilizados em badge, gráfico, barra e ícone.

**Pontos fracos**

- **[Importante] Teto fixo de 100 itens em 12 pontos** (`pageSize: 100`): selects de produto e material, inventário cruzado com a tabela de produtos, filas de expedição e produção, dashboard. Quando o catálogo passar de 100 produtos, o select de receita não mostra todos, a tabela de produtos exibe linhas sem estoque e a expedição esconde pedidos, **sem nenhum aviso**. `useStockAdjustment` chega a resolver o SKU listando até 100 produtos e procurando no cliente.
- **[Importante] Dashboard faz 14 requisições** (6 contagens por status, 4 listagens, atrasados, jobs, estoque, materiais) para derivar números que o banco calcula em uma consulta. Além do custo, as barras de "menor saldo" só consideram os 100 primeiros itens.
- **[Moderado] Sem Error Boundary.** Um `throw` em render (por exemplo, `ORDER_STATUS[status]` recebendo um status novo da API) derruba o painel inteiro para tela branca, sem mensagem.
- **[Moderado] Estado da tela fora da URL.** Pedido aberto, filtros e página não estão no hash; não há deep link (`#/pedidos/<id>`), e recarregar perde o contexto.
- **[Moderado] Testes só de funções puras.** Nenhum teste de componente ou de fluxo; o roteiro de 10 minutos do README é manual. A regressão mais provável (um hook que para de recarregar após uma ação) não tem rede de proteção.
- **[Menor] `describeError` acopla a texto do backend** (ver 2.2).
- **[Menor] `useResource` carrega com `eslint-disable`** para dependências do effect; funciona porque a identidade é a `key`, mas o padrão `load` recriado a cada render é o tipo de coisa que o React Compiler ou um `useEffectEvent` resolveriam sem desabilitar regra.

### 2.8 Testes, CI e entrega

**Pontos fortes**

- Dois níveis bem separados: regras puras sem banco (rápidos) e integração com PostgreSQL real cobrindo concorrência, idempotência, importação, worker e login. É onde os bugs deste domínio vivem.
- CI com PostgreSQL isolado, typecheck, build e construção das imagens.
- Imagens multi-stage, `npm ci --omit=dev`, usuário `node`, healthcheck na API.

**Pontos fracos**

- **[Importante] O job `web` do CI não executa `npm test`** (só lint e build). Os seis arquivos de teste do painel nunca rodam no pipeline.
- **[Importante] Os testes do web dependem do type stripping nativo do Node** (`node --test 'src/**/*.test.ts'` sem transpiler). Com Node 21 falham todos com `ERR_UNKNOWN_FILE_EXTENSION`. O `.nvmrc` resolve para quem usa nvm, mas o `package.json` do web não declara `engines`, e nada avisa.
- **[Moderado] Sem teste de contrato nem e2e** entre painel e API.

### 2.9 Trade-offs explícitos (Ford/Richards)

| Decisão | Ganho | Custo aceito | Quando revisitar |
|---|---|---|---|
| Monólito modular, um processo | Transações simples, sem rede entre pedido/estoque/produção | Um deploy; sem escala independente | Nunca, para uma loja. Só com múltiplas lojas e times |
| SQL explícito, sem ORM | Locks, `SKIP LOCKED`, `ON CONFLICT` e `unnest` sem lutar com abstração | Mapeamento snake→camel à mão em cada repositório | Se o número de tabelas dobrar, avaliar um query builder tipado |
| Validação própria | 105 linhas, sem dependência, mensagens em português | Tipos do contrato não derivam da validação | Ao criar o pacote de contratos (item 3.2) |
| Hash routing | Zero configuração de servidor | Sem deep link, estado fora da URL | Quando precisar compartilhar link de pedido |
| Sem lib de estado/UI no front | Bundle mínimo, código legível | Design system próprio para manter | Se o time crescer e precisar de componentes complexos (tabela virtualizada, datepicker) |
| Sessão em cookie + CSRF | Sem token no JS, sem CORS | Painel e API precisam compartilhar origem (proxy) | Se surgir um app mobile ou cliente externo |
| Um consumidor por agregado no outbox | Ordem garantida | Um evento travado bloqueia o agregado | Ao adicionar dead-letter (item 3.1) |

---

## 3. Priorização integrada

Ordem de prioridade do orquestrador: estabilidade → dados → fronteiras → domínio → código.

### 3.1 Fazer agora (baixo esforço, alto retorno; 1 a 2 dias)

1. **CI**: adicionar `npm test` ao job `web`; declarar `"engines": { "node": ">=24" }` nos dois `package.json`.
2. **Cabeçalhos de segurança no nginx** (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Content-Security-Policy` restritiva: `default-src 'self'`, sem inline) e remover os da API (ou manter, inofensivos). `Strict-Transport-Security` quando houver TLS.
3. **Compose**: `POSTGRES_PASSWORD` vindo do `.env` (`${POSTGRES_PASSWORD:?}`) e `DATABASE_URL` montada a partir dele; comentário claro de que `COOKIE_SECURE=false` é só local.
4. **Índice** `production_jobs (product_id) WHERE status IN ('queued','printing')` em `010_...sql`.
5. **Limite de corpo** coerente: ou `express.json({ limit: "256kb" })` só na rota de importação, ou reduzir `MAX_ORDERS_PER_IMPORT`.
6. **Código de erro** na resposta (`{ error, code, details }`) e `describeError` passando a usar `code`.
7. **Outbox**: teto de tentativas (por exemplo, 20) com status `dead` e log de erro; endpoint `GET /outbox/dead` ou, no mínimo, uma consulta documentada no README.

### 3.2 Próximas semanas

8. **Endpoint agregado do dashboard** (`GET /dashboard/summary`): contagens por status, atrasados, resumo da produção, N produtos com menor saldo, N materiais com menos gramas. Uma consulta, uma requisição; e as barras passam a considerar o estoque inteiro.
9. **Busca por SKU na API** (`GET /products?sku=` exato ou `GET /products/by-sku/:sku`) e selects com busca incremental (`search=` + debounce, que já existe) no lugar dos `pageSize: 100`. Filas de expedição/produção com paginação visível ou "carregar mais".
10. **Error Boundary** na raiz e por rota, com botão "recarregar seção".
11. **Observabilidade mínima**: `pino` com request id (gerado ou vindo do nginx), log por requisição com rota, status, duração e usuária; contador de 409/500; métricas do worker (pendentes, idade do mais antigo, falhas) expostas em `/metrics` ou gravadas no log a cada minuto.
12. **Retenção**: tarefa no loop do worker (uma vez por hora) apagando `idempotency_keys` com mais de 7 dias, `outbox` publicado com mais de 30 dias, `integration_events` processados com mais de 90 dias e `login_attempts` fora da janela. Documentar em `docs/arquitetura.md`.
13. **`requestTimeout`/`headersTimeout`** no servidor HTTP (por exemplo, 30 s / 10 s).

### 3.3 Evolução estrutural (quando houver folga; 1 a 2 semanas)

14. **Workspaces npm na raiz** (`api`, `web`, `packages/contracts`). Mover os tipos de `web/src/api/types.ts` para `contracts` e fazer os serviços da API devolverem esses tipos (ou derivá-los dos parsers). Uma fonte de verdade; `docs/api.md` passa a ser exemplo, não contrato.
15. **Extrair `fulfillment/`** (ou `allocation/`) como módulo próprio contendo `allocation.ts` e as regras de falta/realocação. `inventory` e `production` deixam de importar `orders`: em vez de chamar `allocateWaitingForProduct` diretamente, publicam um hook in-process ("saldo do produto X aumentou") que o módulo de fulfillment registra na composição (`app.ts`). Mesma transação, mesma semântica, sem ciclo.
16. **Fitness function de dependência**: `dependency-cruiser` no CI com regras: `inventory/**` e `production/**` não importam `orders/**`; nenhum módulo importa `app.ts`; `*-repository.ts` não importa `http/**`.
17. **Padronizar repositórios** com `db: Queryable` em todas as funções (hoje metade aceita, metade usa `pool`).
18. **Deep links**: `#/pedidos/<id>` abre o detalhe; filtros e página no hash. Vinte linhas em `useHashRoute`.
19. **Smoke e2e com Playwright** rodando o roteiro de 10 minutos do README contra o Compose no CI (um job, 2 a 3 minutos).

### 3.4 Antes de ir para produção real (conector de marketplace, outras contas)

20. TLS (Caddy ou certbot no nginx) + `COOKIE_SECURE=true` + `TRUST_PROXY` conferido; HSTS.
21. Assinatura HMAC no webhook do outbox e `aggregate_type` na tabela.
22. scrypt `N=2^17` (ou Argon2id) e re-hash transparente no próximo login.
23. Backup automático diário (`pg_dump` em cron no host ou container) com teste de restauração documentado.
24. Papéis mínimos (dona × ajudante) se outra pessoa for operar o painel; hoje `users.active` é o único controle.

---

## 4. Riscos por fase

| Fase | Risco | Mitigação |
|---|---|---|
| 3.1 | CSP quebrar o painel (Vite injeta nada inline em produção, mas conferir fontes/ícones) | Começar com `Content-Security-Policy-Report-Only` por uma semana |
| 3.1 | Índice novo em tabela grande | Tabela pequena hoje; se crescer, `CREATE INDEX CONCURRENTLY` fora da transação da migration |
| 3.2 | Endpoint de dashboard virar "query de tudo" lenta | Cada bloco em subconsulta com `LIMIT`; medir com `EXPLAIN ANALYZE` |
| 3.2 | Retenção apagar chave de idempotência ainda em uso | Janela de 7 dias é 100× maior que qualquer retry do painel; registrar no `docs/api.md` |
| 3.3 | Extração de `fulfillment` mudar ordem de locks | Manter a ordem documentada (pedido → jobs → estoque → materiais); os testes de integração de concorrência já existem e devem passar sem alteração |
| 3.3 | Workspaces mudarem caminhos dos Dockerfiles | Ajustar `COPY` e `cache-dependency-path` do CI na mesma PR |

---

## 5. Fitness functions para acompanhar

| Característica | Medida | Alvo |
|---|---|---|
| Fronteiras | `dependency-cruiser` no CI | 0 violações |
| Contrato único | `grep -c "export type" web/src/api/types.ts` | 0 (tipos vêm de `contracts`) |
| Limites no front | `grep -rc "pageSize: 100" web/src` | 0 |
| Custo do dashboard | requisições na carga inicial (aba Network) | 1 |
| Testes no CI | job `web` executa `npm test` | sim |
| Steady state | `SELECT count(*) FROM idempotency_keys` após 30 dias | estável, não crescente |
| Outbox | idade do evento pendente mais antigo | < 15 min; alerta acima de 1 h |
| Segurança do HTML | `curl -I` no painel mostra CSP, XFO, nosniff | sim |

---

## 6. Calibração

A solução **não está over-engineered**: as partes complexas (locks, outbox, idempotência, BigInt) correspondem a riscos reais de estoque e dinheiro. Também não está under-engineered no núcleo. Onde ela está abaixo do risco é na **operação** (ninguém vê o que acontece em produção) e no **crescimento do front** (tetos silenciosos). As recomendações seguem a mesma proporção: nada de CQRS, event sourcing ou microserviços; sim para logs, retenção, um módulo a mais e um pacote de contratos.

Limites desta avaliação: não medi desempenho sob carga nem executei os testes de integração (exigem PostgreSQL local); as afirmações sobre índices e crescimento são de leitura, não de medição. Meça na sua configuração antes de otimizar (Fowler, Kleppmann).

---

## 7. O que foi aplicado (2026-11-06)

Tudo verificado com `typecheck`, `deps:check`, 33 testes unitários e 36 de integração na API; `lint`, `tsc -b`, 18 testes e `build` no painel; imagens Docker construídas; cabeçalhos conferidos com `curl` e a CSP com Chrome headless.

| Item | Situação | Onde |
|---|---|---|
| 1. CI roda `npm test` do web; `engines` nos dois `package.json` | feito | `.github/workflows/ci.yml`, `package.json` |
| 2. Cabeçalhos e CSP no nginx | feito (CSP enforçada: sem inline; fontes do Google Fonts; HSTS comentado até TLS) | `web/nginx.conf` |
| 3. Compose sem senha fixa | feito (`POSTGRES_PASSWORD` obrigatório no `.env`, `DATABASE_URL` montada a partir dela) | `compose.yaml`, `.env.example` |
| 4. Índice `production_jobs(product_id)` parcial | feito | `migrations/010` |
| 5. Limite de corpo coerente | feito (32 kB geral, 256 kB em `/imports/orders` e no nginx) | `app.ts`, `nginx.conf` |
| 6. `code` nos erros e `describeError` por código | feito | `http/errors.ts`, `web/src/lib/errors.ts`, `docs/api.md` |
| 7. Outbox com teto de tentativas e dead-letter | feito (20 tentativas, `dead_at`, `GET /outbox/dead`, `POST /outbox/:id/retry`, tela de Integrações) | `outbox/` |
| 8. Endpoint agregado do dashboard | feito (`GET /dashboard/summary`; o painel passou de 14 para 1 requisição) | `dashboard/` |
| 9. Busca por SKU na API e seleções com busca | feito (`GET /products/by-sku/:sku`, `ProductPicker`, filas paginadas, filamentos percorridos por página; zero `pageSize: 100`) | `catalog/`, `web/src/features/**` |
| 10. Error Boundary | feito (por seção, com `key` na rota, e na raiz) | `web/src/components/ErrorBoundary.tsx` |
| 11. Observabilidade mínima | feito (`pino`, `X-Request-Id`, linha por requisição, `GET /metrics`, métricas do worker por minuto, healthcheck do worker por heartbeat) | `logger.ts`, `http/request-log.ts`, `http/metrics.ts`, `worker.ts` |
| 12. Retenção | feito (hora em hora no worker; limpeza aleatória do limitador de login removida) | `retention.ts` |
| 13. `requestTimeout`/`headersTimeout` | feito (30 s / 10 s) | `server.ts` |
| 14. Workspaces npm + pacote `contracts` | **não aplicado**: exige reestruturar Dockerfiles, `cache-dependency-path` do CI e os dois `package-lock.json`; fica como próxima PR. Os tipos do painel foram sincronizados com o backend (campos que faltavam adicionados) | `web/src/api/types.ts` |
| 15. Extrair `fulfillment/` | feito (porta `orders/allocation-port.ts`, aviso `inventory/stock-events.ts`, registro em `app.ts`); os 28 testes de integração originais passaram sem alteração de comportamento | `fulfillment/` |
| 16. Fitness function de dependência | feito (`dependency-cruiser` no CI: sem ciclos, núcleo não importa pedidos, repositório não importa `http/`, ninguém importa `app.ts`) | `api/.dependency-cruiser.cjs` |
| 17. Repositórios com `db: Queryable` | feito (todas as funções; `queryPage` também recebe o `db`) | `*-repository.ts` |
| 18. Deep links | feito (`#/pedidos/<id>?status=&page=`, `#/producao?status=&color=&page=`) | `web/src/lib/hash.ts`, `hooks/useHashRoute.ts` |
| 19. Smoke e2e com Playwright | **não aplicado**: exige baixar navegadores no CI e um job com o Compose inteiro; a verificação desta rodada foi feita à mão com Chrome headless | — |
| 20. TLS + HSTS | **não aplicado** (infra de deploy, fora do repositório); HSTS pronto para descomentar no nginx; instruções no README | `web/nginx.conf`, README |
| 21. HMAC no webhook e `aggregate_type` | feito (`OUTBOX_WEBHOOK_SECRET`, `X-Signature-256`, coluna com backfill) | `outbox/publishers.ts`, `migrations/010` |
| 22. scrypt mais forte com rehash | feito (`N=2^15, r=8, p=3`, ~32 MB por hash para suportar logins em paralelo; rehash transparente no login) | `security/password.ts`, `auth-service.ts` |
| 23. Backup automático | parcialmente: script com rotação de 14 cópias e linha de cron documentada; o agendamento em si é do host | `scripts/backup-db.sh`, README |
| 24. Papéis (dona × ajudante) | **não aplicado**: decisão de negócio, sem demanda hoje | — |

Também: `create-user.ts` deixou de usar a API privada do `readline` (lê a senha em modo raw); `gramsToMilli` foi para `grams.ts` (compartilhado por produção e precificação, sem que precificação importe produção); a listagem de estoque passou a trazer `priceCents` e filtrar por `active`, e o painel de Produtos usa só ela (uma requisição por página em vez de produtos + 100 itens de estoque).

Fitness functions da seção 5, medidas agora: `dependency-cruiser` 0 violações; `grep -rc "pageSize: 100" web/src` = 0; dashboard = 1 requisição; CI executa os testes do web; `curl -I` do painel mostra CSP, XFO e nosniff. Pendentes: contrato único (item 14) e e2e (item 19).

