# Arquitetura do backend

Monólito modular em Node.js 24 + TypeScript + Express 5 + PostgreSQL. Um único processo, organizado por módulo de negócio. Cada módulo separa as responsabilidades em arquivos:

| Arquivo | Responsabilidade |
|---|---|
| `routes.ts` | HTTP: lê parâmetros, chama a validação e o serviço, monta a resposta |
| `*-input.ts` | validação da entrada `unknown` (corpo, query, ids) para tipos do domínio |
| `*-service.ts` | casos de uso: transações, ordem de locks, orquestração das regras |
| `*-repository.ts` | SQL parametrizado e mapeamento de linhas para tipos |
| `*-rules.ts` / `rules.ts` | regras puras, sem HTTP nem banco (testadas sem banco) |

As dependências apontam para dentro: rotas → serviço → repositório. Repositórios não importam nada de `http/` e recebem sempre o `db: Queryable` (pool ou client de transação) como primeiro parâmetro: a mesma função serve dentro e fora de uma transação.

### Dependências entre módulos

```
catalog, pricing, security   →  (só infraestrutura: db, http, outbox/enqueue…)
inventory                    →  catalog
production                   →  inventory, catalog
orders                       →  catalog, inventory, production, e a porta allocation-port.ts
fulfillment                  →  orders, inventory, production
integrations                 →  orders, fulfillment, catalog, inventory
dashboard                    →  orders, inventory (só leitura)
app.ts                       →  tudo (composição)
```

- `fulfillment/allocation.ts` é o serviço de domínio que atravessa pedidos, estoque e produção: reservar, enfileirar produção para a falta, realocar quando entra saldo, liberar reservas. Fica em módulo próprio para que nenhum dos três precise importar os outros.
- `orders` chama o fulfillment pela interface que ele mesmo declara (`orders/allocation-port.ts`); `inventory` e `production` só avisam "o saldo deste produto subiu" (`inventory/stock-events.ts`). `app.ts` liga as duas pontas em `registerFulfillment()`. Mesma transação, mesma ordem de locks, sem ciclo.
- Essas regras são verificadas pelo `dependency-cruiser` (`api/.dependency-cruiser.cjs`, `npm run deps:check`, no CI): sem ciclos, núcleo não importa pedidos, repositório não importa `http/`, ninguém importa `app.ts`.

```
api/src/
  app.ts, server.ts      composição, /health, /ready, encerramento gracioso
  db.ts                  pool, withTransaction (um único client por transação), queryPage (página + total)
  logger.ts              pino: uma linha JSON por evento (LOG_LEVEL)
  pagination.ts          Page, PageRequest, toPage
  sql.ts, grams.ts, pg-errors.ts
                         helpers sem conexão (likePattern, gramas em miligramas BigInt, códigos de erro do pg)
  retention.ts           steady state: apaga chaves de idempotência, outbox publicado, eventos processados e
                         janelas de login antigos (rodado pelo worker a cada hora)
  http/                  erros com código estável, validação de entrada unknown, Idempotency-Key,
                         log por requisição com X-Request-Id, contadores de /metrics
  outbox/                enqueue (mesma transação), publishers (log, webhook assinado), worker (lote alugado,
                         dead-letter), retry-policy, routes (GET /outbox/dead, POST /outbox/:id/retry)
  catalog/               produtos (SKU, preço em centavos, ativo, busca por SKU exato)
  inventory/             peças prontas (physical/reserved), filamento (gramas), receitas e o aviso
                         "saldo subiu" (stock-events.ts): inventory-* e material-*
  orders/                pedidos, reservas, envio (shipment-repository), canais fixos e a porta para o
                         fulfillment (allocation-port.ts)
  fulfillment/           allocation.ts (reservar, enfileirar falta, realocar, liberar) e o registro na composição
  production/            fila de impressão, bloqueio por cor, conclusão
  integrations/          MarketplaceConnector, simulador, importação com retomada, mapeamento de SKU externo
  dashboard/             GET /dashboard/summary: a visão geral em uma consulta
  security/              sessão (session.ts: express-session + connect-pg-simple), CSRF (csrf.ts: csrf-sync),
                         login (auth-service.ts + login-limiter.ts), senha (scrypt com rehash), requireAuth
  worker.ts              processo do worker: outbox, heartbeat, métricas por minuto, retenção por hora
  scripts/               migrate.mjs, create-user.ts
api/migrations/          001…010, aplicadas em ordem; nunca editar uma já aplicada
api/.dependency-cruiser.cjs
                         regras de dependência entre módulos (npm run deps:check)
web/                     painel React (Vite); em produção, nginx serve o build e faz proxy de /api
```

## Processos

| Processo | Papel |
|---|---|
| `api` | HTTP: regras de negócio, sessões, importação |
| `worker` | lê o `outbox` e publica os eventos (log estruturado ou `OUTBOX_WEBHOOK_URL`); a cada minuto registra fila, idade do evento mais antigo e eventos mortos; a cada hora roda a retenção; toca um arquivo de heartbeat para o healthcheck do Compose |
| `web` | nginx com o build do painel; `/api/*` → `api:3000/*` |
| `postgres` | única fonte de verdade |

## Frontend (`web/`)

React 19 + Vite, sem bibliotecas de estado ou de UI. A regra é: **componentes `.tsx` só apresentam**; dados, ações e regras ficam em `.ts`.

```
web/src/
  api/          client.ts (fetch, CSRF, ApiError com code), endpoints.ts (uma função por rota); os tipos vêm de @tres-eixos/contracts
  lib/          funções puras: format, parse, labels (status → rótulo e tom), charts, errors (mensagem por code),
                idempotency, hash (rota, item e filtros na URL), pages (percorrer páginas de listas pequenas)
  hooks/        useResource (carga + estados), useAction (escrita sem envio duplo), useSession,
                useHashRoute (#/secao/<id>?filtro=…), useDebouncedValue
  components/
    ErrorBoundary.tsx   um erro de renderização derruba só a seção, com "tentar de novo"
    ui/         design system reutilizável: Button, Card, Badge, TextField/SelectField, Form, DataTable,
                Drawer, SegmentedControl, StatCard, DonutChart, BarList, ProgressBar, ResourceView…
    layout/     AppShell e Sidebar
  features/<seção>/
                use*.ts (dados e ações da seção), *-metrics.ts / *-rules.ts (derivações puras), *.tsx (telas)
  app/routes.ts rotas do menu
  styles/       tokens (cores, glass, claro/escuro), base, layout, components
```

- Visual "glass": fundo em degradê claro (lilás → azul-céu → rosa) com brilhos desfocados e painéis translúcidos com `backdrop-filter`. Tema claro fixo, mesmo com o sistema em modo escuro.
- Cores semânticas via classes `tone-*` (que expõem `--tone`): o mesmo tom serve para badge, gráfico, barra e ícone.
- Funções puras têm testes com o runner nativo do Node (`npm test -w web`, exige Node 24; roda no CI). O fluxo inteiro, do navegador ao banco, é coberto pelo smoke e2e (`e2e/`, Playwright) contra a pilha do Compose, no CI e localmente (`scripts/e2e-stack.sh up && npm run e2e`).
- Listas nunca têm teto silencioso: seleções de produto usam busca incremental (`ProductPicker`, 20 resultados e aviso para refinar), filas e tabelas são paginadas, e as poucas listas carregadas inteiras (filamentos) percorrem as páginas e avisam se passarem do limite.
- Seção, item aberto e filtros ficam no hash da URL (`#/pedidos/<id>?status=ready&page=2`): recarregar ou compartilhar o link preserva o contexto.
- Os tipos do contrato vêm de `packages/contracts` (`@tres-eixos/contracts`), compartilhado via workspaces npm. O painel importa direto; a API prova em `api/test/contracts.types.ts` que cada tipo interno, depois de serializado (`Date` → texto ISO), é igual ao do contrato. Mudar um campo de um lado só faz o `typecheck` falhar apontando o tipo. `docs/api.md` é exemplo e explicação, não contrato.
- Uma única versão de TypeScript (5.9) na raiz: a 7 ainda não expõe a API JavaScript que o `dependency-cruiser` usa para ler os `.ts`.

## Estoque: dois estoques, unidades diferentes

- **Peças prontas** (`inventory`): `physical` = peças na prateleira; `reserved` = comprometidas com pedidos. `CHECK (reserved <= physical)` no banco.
- **Filamento** (`materials`): gramas em `numeric(12,3)`, com `physical_grams` e `reserved_grams`. A receita (`product_materials`) diz quantos gramas uma unidade consome.

| Operação | physical | reserved | Movimento |
|---|---|---|---|
| Reservar (pedido) | — | + | `reservation` |
| Cancelar antes do envio | — | − | `release` |
| Expedir | − | − | `shipment` |
| Concluir produção | + | — | `production` |
| Ajuste manual (delta + motivo) | ± | — | `adjustment` |

Todo movimento tem `operation_key` única (`reserve:<item>`, `release:<reserva>`, `ship:<reserva>`, `produce:<job>`…). Repetir a operação não aplica o delta duas vezes.

## Concorrência

- **Reserva**: `UPDATE inventory SET reserved = reserved + $1 WHERE product_id = $2 AND physical - reserved >= $1`. Zero linhas significa sem saldo. Dois pedidos pela última unidade: só um UPDATE encontra saldo.
- **Ordem de locks** (evita deadlock): pedido → jobs → estoque (por `product_id`) → materiais (por `id`). A conclusão de produção usa job → estoque → materiais.
- **Alocação de pedidos em espera** acontece depois que o saldo aumenta (produção, ajuste, liberação). Ela usa `FOR UPDATE ... SKIP LOCKED` nos pedidos para não esperar segurando o estoque. Um pedido pulado pode ser realocado com `POST /orders/:id/allocation`.
- **Falta de estoque** gera no máximo um job por item, com a falta real: demanda em espera − saldo livre − produção na fila. Se o item for atendido por estoque antes de o job começar, o job é cancelado.
- `lock_timeout = 5s` por transação; deadlock e timeout de lock viram 409 com "tente novamente".
- Nenhuma transação fica aberta durante chamada a provedor externo.

## Estados

Pedido (interno): `pending_mapping` (SKU externo sem correspondência) → `awaiting_stock` → `reserved` → `ready` → `shipped`. De qualquer estado antes de `shipped`, pode ir para `cancelled`. O estado externo (`external_status`) é separado e nunca regride: evento mais antigo ou que volta no ciclo é ignorado.

Job de produção: `queued` → `printing` → `done`, ou `cancelled`. Se o pedido é cancelado, o job vai para `on_hold` e só sai com decisão explícita: `cancel` ou `continue_for_stock`.

## Idempotência

- `POST /orders` exige `Idempotency-Key`. Mesma chave e mesmo corpo devolvem a resposta gravada (cabeçalho `Idempotent-Replayed: true`). Mesma chave com outro corpo dá 409.
- `UNIQUE(channel_id, external_order_id)`: o mesmo pedido externo nunca vira dois registros.
- `UNIQUE(channel_id, event_id)` em `integration_events`: eventos repetidos são descartados.
- A importação paginada salva o cursor só depois de gravar a página inteira. Uma interrupção retoma da última página completa.

## Segurança

- Sessão no servidor com cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção. As sessões ficam no PostgreSQL (`user_sessions`), nunca em memória. A sessão é regenerada no login.
- CSRF (synchronizer token, `csrf-sync`) em toda escrita, inclusive no login (`GET /auth/csrf` antes).
- Senhas com scrypt (`node:crypto`) e salt por senha.
- Limite de login por janela de 15 minutos: 5 tentativas por IP+e-mail, 20 por conta (qualquer IP) e 50 por IP. A tentativa é contada **antes** de conferir a senha, numa instrução atômica, então requisições paralelas não furam o limite. A contagem fica no PostgreSQL (`login_attempts`, só hashes das chaves). Efeito aceito: um ataque distribuído pode bloquear o login da conta por até 15 minutos.
- A sessão anônima criada só para o token CSRF do login dura 10 minutos.
- Sem CORS: o painel acessa a API pela mesma origem, via proxy `/api`.
- Corpo limitado a 32 kB (256 kB só em `POST /imports/orders`; o nginx aceita até 256 kB), listagens paginadas (máx. 100), campos inesperados recusados e erros 500 sem stack trace.
- Senhas com scrypt `N=2^15, r=8, p=3` (faixa recomendada pelo OWASP, ~32 MB por hash). O formato gravado leva os parâmetros; um hash antigo é refeito de forma transparente no próximo login certo.
- Cabeçalhos de segurança do HTML ficam no nginx (`web/nginx.conf`): `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` e uma `Content-Security-Policy` sem inline (scripts e chamadas só da própria origem; fontes do Google Fonts). A API repete os três primeiros nas respostas JSON. `Strict-Transport-Security` fica comentado até existir TLS.
- Servidor HTTP com `headersTimeout` de 10 s e `requestTimeout` de 30 s: uma conexão travada não segura um slot do pool.
- Webhook do outbox assinado com HMAC-SHA256 (`OUTBOX_WEBHOOK_SECRET`), ver docs/api.md.

## Outbox

Mudanças relevantes (pedido criado, status alterado, enviado, cancelado, produção concluída) gravam um evento em `outbox` **na mesma transação**. O worker:

1. aluga um lote (`locked_until` + `lease_id`) com `FOR UPDATE SKIP LOCKED`: dois workers nunca pegam o mesmo evento. O aluguel dura mais que o pior caso do lote (20 eventos × 5 s de timeout + folga), e só quem detém o `lease_id` pode marcar o evento como publicado ou reagendá-lo;
2. cada lote leva **só o primeiro evento pendente de cada pedido** (ordem pela sequência de gravação `seq`): um evento nunca sai antes do anterior do mesmo pedido, mesmo que o anterior esteja aguardando retentativa;
3. publica cada evento **fora** de transação e marca `published_at`;
4. em caso de falha, incrementa `attempts`, guarda `last_error` e reagenda (`next_attempt_at`: 2, 4, 8… s, até 15 min); os outros pedidos seguem normalmente;
5. na 20ª falha o evento vai para a **dead-letter** (`dead_at`), com log de erro, e deixa de ser reagendado. De propósito ele continua segurando os eventos seguintes do mesmo agregado (a ordem vale mais que a pressa). A loja vê a lista em `GET /outbox/dead` (e na tela de Integrações) e, depois de corrigir o destino, devolve o evento à fila com `POST /outbox/:id/retry`.

Cada evento traz `aggregate_type` (`order` ou `production_job`) além do `aggregate_id`: o consumidor não precisa inferir pelo tópico.

A entrega é "pelo menos uma vez": se o worker morrer entre publicar e marcar, o aluguel expira e o evento é republicado. O receptor deve deduplicar pelo `id` (enviado também em `Idempotency-Key` no webhook). No encerramento, o lote em andamento termina antes de o processo sair.

## Observabilidade e steady state

- **Logs**: `pino`, uma linha JSON por evento, em API, worker e scripts (`LOG_LEVEL`). Cada requisição gera uma linha com `requestId`, método, rota (padrão, ex.: `/orders/:id`), status, duração e `userId`. Nunca o corpo nem credenciais. O `requestId` vem do nginx (`X-Request-Id`) ou é gerado, e volta na resposta.
- **Métricas**: `GET /metrics` devolve os contadores desta instância (requisições, por classe de status, 409, 500, latência por rota) e a situação do outbox. O worker registra a cada minuto `pending`, `oldestPendingAgeSeconds`, `dead` e o que publicou/falhou desde o último registro, em `warn` quando há evento morto ou a fila passa de uma hora.
- **Healthcheck do worker**: o laço toca um arquivo (`WORKER_HEARTBEAT_FILE`) a cada 5 s; o Compose considera o worker doente se o arquivo tiver mais de 60 s.
- **Retenção** (`retention.ts`, uma vez por hora no worker): `idempotency_keys` com mais de 7 dias, `outbox` publicado há mais de 30 dias, `integration_events` processados ou ignorados há mais de 90 dias, `login_attempts` com janela de mais de 1 dia. As tabelas de auditoria (`stock_movements`, `material_movements`, históricos de status) não são apagadas: crescem com a operação e, se um dia pesarem, pedem arquivamento, não retenção.
- **Backup**: `scripts/backup-db.sh` (pg_dump comprimido, mantém 14), pensado para um cron diário; ver README.

## Limitações conhecidas

- Conectores reais (Mercado Livre, Shopee) não estão implementados (Fase E): dependem de app aprovado nas plataformas. Há apenas o simulador, rotulado como tal.
- O destino do outbox é log ou webhook genérico; ainda não há um consumidor real dos eventos.
- Reserva de item é tudo-ou-nada: um item de 3 unidades aguarda as 3.
- Uma única loja e uma conta de dona. Não há permissões por equipe.
- Sem TLS no Compose: para expor na internet, ponha um terminador HTTPS (Caddy/certbot) na frente do `web`, ligue `COOKIE_SECURE=true` e descomente o `Strict-Transport-Security` do nginx.
- Os contratos entre API e painel são mantidos à mão (dois arquivos de tipos); não há teste de contrato nem e2e no navegador. Ver `docs/avaliacao-arquitetura.md` para o que foi aplicado e o que ainda falta.
