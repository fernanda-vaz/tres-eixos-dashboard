# Arquitetura do backend

Monólito modular em Node.js 24 + TypeScript + Express 5 + PostgreSQL. Um único processo, organizado por módulo de negócio. Cada módulo separa as responsabilidades em arquivos:

| Arquivo | Responsabilidade |
|---|---|
| `routes.ts` | HTTP: lê parâmetros, chama a validação e o serviço, monta a resposta |
| `*-input.ts` | validação da entrada `unknown` (corpo, query, ids) para tipos do domínio |
| `*-service.ts` | casos de uso: transações, ordem de locks, orquestração das regras |
| `*-repository.ts` | SQL parametrizado e mapeamento de linhas para tipos |
| `*-rules.ts` / `rules.ts` | regras puras, sem HTTP nem banco (testadas sem banco) |

As dependências apontam para dentro: rotas → serviço → repositório. Repositórios não importam nada de `http/`.

```
api/src/
  app.ts, server.ts      composição, /health, /ready, encerramento gracioso
  db.ts                  pool, withTransaction (um único client por transação), queryPage (página + total)
  pagination.ts          Page, PageRequest, toPage
  sql.ts, pg-errors.ts   helpers sem conexão (likePattern, códigos de erro do pg)
  outbox.ts              eventos gravados na mesma transação da mudança
  http/                  erros, validação de entrada unknown, Idempotency-Key
  catalog/               produtos (SKU, preço em centavos, ativo)
  inventory/             peças prontas (physical/reserved), filamento (gramas) e receitas: inventory-* e material-*
  orders/                pedidos, alocação (allocation.ts), reservas, envio (shipment-repository), canais fixos
  production/            fila de impressão, bloqueio por cor, conclusão
  integrations/          MarketplaceConnector, simulador, importação com retomada, mapeamento de SKU externo
  security/              sessão (session.ts: express-session + connect-pg-simple), CSRF (csrf.ts: csrf-sync),
                         login (auth-service.ts + login-limiter.ts), senha, requireAuth
  outbox-worker.ts       publicação dos eventos (lote alugado com SKIP LOCKED, fora de transação)
  worker.ts              processo do worker (npm run worker / serviço "worker")
  scripts/               migrate.mjs, create-user.ts
api/migrations/          001…009, aplicadas em ordem; nunca editar uma já aplicada
```

## Processos

| Processo | Papel |
|---|---|
| `api` | HTTP: regras de negócio, sessões, importação |
| `worker` | lê o `outbox` e publica os eventos (log estruturado ou `OUTBOX_WEBHOOK_URL`) |
| `postgres` | única fonte de verdade |

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
- Sem CORS: um cliente web deve acessar a API pela mesma origem, via proxy reverso.
- Corpo limitado a 32 kB, listagens paginadas (máx. 100), campos inesperados recusados e erros 500 sem stack trace.

## Outbox

Mudanças relevantes (pedido criado, status alterado, enviado, cancelado, produção concluída) gravam um evento em `outbox` **na mesma transação**. O worker:

1. aluga um lote (`locked_until` + `lease_id`) com `FOR UPDATE SKIP LOCKED`: dois workers nunca pegam o mesmo evento. O aluguel dura mais que o pior caso do lote (20 eventos × 5 s de timeout + folga), e só quem detém o `lease_id` pode marcar o evento como publicado ou reagendá-lo;
2. cada lote leva **só o primeiro evento pendente de cada pedido** (ordem pela sequência de gravação `seq`): um evento nunca sai antes do anterior do mesmo pedido, mesmo que o anterior esteja aguardando retentativa;
3. publica cada evento **fora** de transação e marca `published_at`;
4. em caso de falha, incrementa `attempts`, guarda `last_error` e reagenda (`next_attempt_at`: 2, 4, 8… s, até 15 min); os outros pedidos seguem normalmente.

A entrega é "pelo menos uma vez": se o worker morrer entre publicar e marcar, o aluguel expira e o evento é republicado. O receptor deve deduplicar pelo `id` (enviado também em `Idempotency-Key` no webhook). No encerramento, o lote em andamento termina antes de o processo sair.

## Limitações conhecidas

- Conectores reais (Mercado Livre, Shopee) não estão implementados (Fase E): dependem de app aprovado nas plataformas. Há apenas o simulador, rotulado como tal.
- O destino do outbox é log ou webhook genérico; ainda não há um consumidor real dos eventos.
- Reserva de item é tudo-ou-nada: um item de 3 unidades aguarda as 3.
- Uma única loja e uma conta de dona. Não há permissões por equipe.
