# Três Eixos

Sistema de gestão para meu negócio de impressão 3D.

## Objetivo

Centralizar o controle de produtos, materiais, estoque, pedidos
e produção, com integração futura ao Mercado Livre e à Shopee.

## O que o sistema faz hoje

- **Catálogo**: produtos com SKU único, preço em centavos, ativo/inativo.
- **Estoque de peças prontas**: físico, reservado e disponível, com histórico de cada movimento.
- **Filamento**: estoque em gramas por material e cor, e receita (gramas por unidade de cada produto).
- **Pedidos manuais**: reserva automática; o que falta vira job na fila de produção. Repetir o envio não duplica o pedido (`Idempotency-Key`).
- **Produção**: fila ordenada por prazo de envio. Mostra bloqueio quando falta filamento de uma cor e registra o consumo estimado e o real.
- **Expedição**: pronto → etiqueta impressa → enviado.
- **Precificação**: custo real de cada peça (filamento, energia, desgaste da impressora, falhas, mão de obra, embalagem) e preço sugerido por canal de venda, já descontando tarifas e imposto.
- **Integrações**: somente o **simulador** de marketplace. SKUs desconhecidos viram pendência e a importação retoma sem duplicar.
- **Worker**: publica os eventos do outbox (pedido criado, enviado, cancelado…).
- **Painel React** com login, para tudo acima (visual claro em estilo glass).

Todos os dados de demonstração são fictícios. Nenhum marketplace real está conectado.

Documentação técnica:
- [docs/arquitetura.md](docs/arquitetura.md): módulos, concorrência, estados, segurança e limitações
- [docs/api.md](docs/api.md): todas as rotas, corpos e exemplos de erro

## Tecnologias

Node.js 24, TypeScript, Express 5, PostgreSQL 16, React 19 + Vite, Docker Compose.

## Pré-requisitos

- **Node 24** (com nvm: `nvm use`, que lê o `.nvmrc`)
- **Docker** com o plugin Compose (`docker compose version`)
- `curl` e `jq` (só para testar a API pelo terminal)

## 1. Configuração inicial (uma vez)

```bash
cp .env.example .env
npm ci
```

O repositório é um workspace npm: um único `npm ci` na raiz instala os contratos (`packages/contracts`), a API e o painel, com um só `package-lock.json` e uma só versão de TypeScript. Os scripts de cada projeto rodam com `-w` (`npm run dev -w api`) ou entrando na pasta (`cd api && npm run dev`).

O `.env` fica na raiz porque é compartilhado pela API, pelo proxy do Vite e pelo Docker Compose. Edite o `.env`:

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | banco local (Postgres do Compose em `127.0.0.1:5434`) |
| `PORT` | porta da API em desenvolvimento (ex.: `8080`) |
| `SESSION_SECRET` | **troque** por um valor aleatório: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TEST_DATABASE_URL` | banco dos testes de integração; o nome precisa terminar em `_test` |
| `POSTGRES_PASSWORD` | senha do banco no Docker Compose (o Compose se recusa a subir sem ela); mantenha `DATABASE_URL` coerente |
| `API_HOST_PORT`, `WEB_HOST_PORT` | portas do Compose no host (padrão 8080 e 8088); troque se estiverem ocupadas |
| `OUTBOX_WEBHOOK_URL`, `OUTBOX_WEBHOOK_SECRET` | destino dos eventos do outbox e o segredo da assinatura HMAC (opcionais; sem URL, os eventos vão para o log) |
| `LOG_LEVEL` | nível de log da API e do worker (`info` por padrão) |

O `.env` nunca vai para o Git nem para as imagens Docker.

## 2. Banco de dados e migrations

```bash
cd api
npm run db:up        # sobe o PostgreSQL (container tres-eixos-postgres)
npm run migrate      # aplica as migrations pendentes de api/migrations/ em ordem
```

O `migrate` pode ser rodado sempre: ele aplica só o que falta e registra tudo em `schema_migrations`. **Nunca edite uma migration já aplicada**; crie a próxima (`011_...sql`).

Para conferir no psql:

```bash
docker compose exec postgres psql -U app -d app -c "SELECT name, applied_at FROM schema_migrations"
```

## 3. Criar a conta de acesso

Não existe cadastro público. Crie a conta pelo terminal (a senha é pedida sem eco, mínimo 12 caracteres):

```bash
cd api
npm run user:create -- --email voce@exemplo.com --name "Seu nome"
```

## 4. Colocar no ar: opção A, desenvolvimento local

Três terminais, a partir da raiz do projeto:

```bash
cd api && npm run dev        # terminal 1: API em http://localhost:<PORT>, reinicia ao salvar
cd api && npm run worker     # terminal 2: publica os eventos do outbox (opcional)
cd web && npm run dev        # terminal 3: painel em http://localhost:5173
```

O painel chama `/api/...` e o Vite repassa para a API na porta `PORT` do `.env`, sem o prefixo `/api`.

Conferindo:

```bash
curl -i http://localhost:8080/health   # 200: o processo está vivo (use a sua PORT)
curl -i http://localhost:8080/ready    # 200: o banco está acessível
```

Para parar, use `Ctrl+C` em cada terminal.

## 5. Colocar no ar: opção B, tudo no Docker Compose

Sobe banco, API, worker e painel (nginx), como em uma demonstração. Os comandos rodam na raiz do projeto, onde fica o `compose.yaml`:

```bash
docker compose up -d postgres
docker compose build
docker compose run --rm api node src/scripts/migrate.mjs
docker compose run --rm api node dist/src/scripts/create-user.js --email voce@exemplo.com --name "Seu nome"
docker compose up -d api worker web
docker compose ps
```

- Painel: **http://localhost:8088**
- API direta: `http://localhost:8080` (ou o `API_HOST_PORT` do `.env`)
- `docker compose ps` mostra `healthy` para `api` (responde `/ready`) e para `worker` (tocou o heartbeat nos últimos 60 s)

Dentro do Compose, a API fala com o banco pelo nome `postgres`, porta 5432. Tudo é publicado só em `127.0.0.1`, nunca na rede.

Comandos do dia a dia:

```bash
docker compose logs -f api worker     # acompanhar logs (uma linha JSON por evento; a cada minuto o worker resume o outbox)
docker compose stop                   # pausar mantendo os dados
docker compose down                   # remover containers mantendo os volumes
```

**Não** use `docker compose down -v` como rotina: o `-v` **apaga o banco**.

Se a API e o Compose forem usados ao mesmo tempo, as portas conflitam. Use uma opção de cada vez.

Para expor na internet (não é o caso da demo): um terminador HTTPS (Caddy ou certbot) na frente do `web`, `COOKIE_SECURE=true` e `TRUST_PROXY` conferidos no `.env`, e o `Strict-Transport-Security` descomentado em `web/nginx.conf`.

## 6. Testar a aplicação

### Pelo painel (roteiro de 10 minutos)

Abra o painel (`http://localhost:5173` na opção A ou `http://localhost:8088` na opção B) e entre com a conta criada.

1. **Produtos**: cadastre `CUBO-AZUL`, "Cubo infinito azul", R$ 15,00. Tente cadastrar o mesmo SKU de novo: o painel explica o conflito.
2. **Produtos → Ajustar estoque**: SKU `CUBO-AZUL`, quantidade `1`, motivo "Saldo inicial". A tabela mostra físico 1 e disponível 1.
3. **Materiais**: cadastre PLA Azul e registre `+50` gramas. Na receita, defina 30 g por unidade de `CUBO-AZUL`.
4. **Pedidos**: crie um pedido com 1 × `CUBO-AZUL` e depois outro com 2 × `CUBO-AZUL`. O primeiro fica **Reservado**; o segundo fica **Aguardando estoque** e gera produção.
5. **Fila de produção**: o job aparece **bloqueado por falta de cor** (precisa de 60 g, há 50 g). Em Materiais, registre `+20` g, volte e clique em **Iniciar impressão** e depois em **Concluir**. O segundo pedido passa a **Reservado**.
6. **Expedição**: **Marcar como pronto** → **Etiqueta impressa** → **Expedir**. O estoque físico baixa.
7. **Pedidos → Detalhes** de um pedido ainda reservado: cancele-o. A reserva é liberada e o histórico registra o motivo.
8. **Precificação**: em **Configurar custos**, preencha energia, impressora, valor da sua hora, falhas e imposto, e as tarifas de cada canal. Em **Materiais**, informe o preço por kg do PLA Azul. Escolha `CUBO-AZUL` na calculadora, informe 150 min de impressão e 20 min de mão de obra e veja o custo e o preço sugerido por canal; **Usar este preço** atualiza o produto.
9. **Integrações**: **Sincronizar pedidos simulados**. Aparecem pendências de SKU (`SIM-...`). Mapeie cada uma para um produto (o campo de busca aceita SKU ou nome); os pedidos pendentes são reprocessados. Sincronize de novo: nada é duplicado. A mesma tela lista os eventos de saída que esgotaram as tentativas de publicação, com o botão para tentar de novo.
10. **Links**: abra um pedido e recarregue a página: a URL (`#/pedidos/<id>?status=…`) guarda a seção, o pedido aberto e o filtro.

### Pela API com curl

Ajuste `API` para a sua porta. As escritas exigem o cookie de sessão e o cabeçalho `X-CSRF-Token`:

```bash
API=http://localhost:8080
JAR=/tmp/tres-eixos-cookies.txt

# login (primeiro pede um token CSRF; o login devolve um novo)
CSRF=$(curl -s -c $JAR -b $JAR $API/auth/csrf | jq -r .csrfToken)
CSRF=$(curl -s -c $JAR -b $JAR -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \
  -d '{"email":"voce@exemplo.com","password":"SUA_SENHA"}' $API/auth/login | jq -r .csrfToken)
req() { curl -s -c $JAR -b $JAR -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" "$@"; echo; }

# produto e estoque
PID=$(req -d '{"sku":"vaso-rosa","name":"Vaso rosa","priceCents":4200}' $API/products | jq -r .id)
req -d "{\"productId\":\"$PID\",\"delta\":1,\"reason\":\"Saldo inicial\"}" $API/inventory/adjustments

# pedidos: com 1 peça, o primeiro reserva e o segundo vai para a produção
req -H "Idempotency-Key: meu-pedido-0001" -d '{"items":[{"sku":"VASO-ROSA","quantity":1}]}' $API/orders | jq '{id,status}'
req -H "Idempotency-Key: meu-pedido-0002" -d '{"items":[{"sku":"VASO-ROSA","quantity":2}]}' $API/orders | jq '{id,status,productionJobs}'

# repetir a mesma Idempotency-Key devolve o mesmo pedido (cabeçalho Idempotent-Replayed: true)
req -i -H "Idempotency-Key: meu-pedido-0001" -d '{"items":[{"sku":"VASO-ROSA","quantity":1}]}' $API/orders | grep -i replayed

# produção: inicie e conclua o job (troque ID_DO_JOB)
req $API/production/jobs | jq '.items[] | {id,status,quantity,blockedBy}'
req -X POST $API/production/jobs/ID_DO_JOB/start
req -X POST $API/production/jobs/ID_DO_JOB/complete

# expedição (troque ID_DO_PEDIDO) e saldo final
req -X POST $API/orders/ID_DO_PEDIDO/ready
req -X POST $API/orders/ID_DO_PEDIDO/label
req -X POST $API/orders/ID_DO_PEDIDO/dispatch
req $API/inventory/$PID

# simulador de marketplace
req -X POST $API/integrations/simulator/sync | jq
req $API/integrations/pending-skus

# operação: visão geral em uma chamada, métricas desta instância e eventos de saída parados
req $API/dashboard/summary | jq '{orders, production}'
req $API/metrics | jq '{counters, outbox}'
req $API/outbox/dead
```

Toda resposta de erro traz `code` além da mensagem (`{"error":"SKU já cadastrado","code":"sku_taken"}`) e toda resposta traz `X-Request-Id`, o mesmo id da linha de log da API.

Também vale testar os erros esperados:
- requisição sem login: `401`;
- escrita sem `X-CSRF-Token`: `403`;
- SKU duplicado: `409`;
- pedido sem `Idempotency-Key`: `400`;
- cancelar pedido já enviado: `409`;
- seis senhas erradas seguidas: `429`.

### Testes automatizados

Na raiz, cada comando percorre os workspaces (contratos, API e painel):

```bash
npm run typecheck            # tsc nos três; na API inclui a prova de contrato (api/test/contracts.types.ts)
npm run lint                 # oxlint no painel
npm run deps:check           # fronteiras entre módulos da API (dependency-cruiser): sem ciclos, núcleo não importa pedidos…
npm test                     # API: regras puras, sem banco; painel: funções puras
npm run test:integration     # API com PostgreSQL real: concorrência, idempotência, produção, importação, worker, login, dead-letter, retenção
npm run build
npm run check                # typecheck + lint + deps:check + test, de uma vez
```

Para um projeto só: `npm test -w api`, `npm run lint -w web`, ou `cd api && npm test`.

O roteiro de 10 minutos acima também roda sozinho no navegador (Playwright, `e2e/tests/smoke.spec.ts`), contra a pilha do Compose:

```bash
npx playwright install --with-deps chromium   # uma vez; baixa o navegador
scripts/e2e-stack.sh up                       # sobe o Compose, aplica migrations, cria a conta e2e e espera o painel
npm run e2e                                   # 12 passos: login, produto, estoque, receita, pedidos, produção, expedição, cancelamento, integrações, links
scripts/e2e-stack.sh down                     # para api/worker/web (o banco fica)
```

Cada execução usa um sufixo próprio (`E2E-…`), então pode repetir; mas os dados do roteiro ficam gravados no banco local. No CI o banco é descartável.

Os `package.json` declaram `"engines": { "node": ">=24" }`: os testes do painel usam o type stripping nativo do Node e falham com versões anteriores (`nvm use`).

Os testes de integração usam `TEST_DATABASE_URL` e **recriam o schema** desse banco a cada execução. Por isso se recusam a rodar em um banco cujo nome não termine em `_test`. Nunca aponte para o banco real da loja.

O CI (`.github/workflows/ci.yml`) roda tudo isso no GitHub: `checks` (typecheck, lint, fronteiras, testes e build dos três workspaces), `integration` (PostgreSQL isolado), `docker` (as duas imagens) e `e2e` (a pilha inteira do Compose no runner, com o smoke no Chromium; em falha, o relatório do Playwright fica como artefato).

## Backup

```bash
scripts/backup-db.sh          # pg_dump comprimido em backups/app-AAAA-MM-DD-HHMM.sql.gz; mantém os 14 mais recentes
```

Para um backup diário automático, uma linha no `crontab -e` do host:

```
0 3 * * * cd /caminho/do/projeto && scripts/backup-db.sh >> backups/backup.log 2>&1
```

`backups/` está no `.gitignore`. Teste a restauração em um banco separado, nunca sobre o banco em uso (o comando está no cabeçalho do script).

## Estrutura

```
package.json        workspaces npm (packages/contracts, api, web): um lockfile, uma versão de TypeScript, scripts da raiz
packages/contracts/ tipos do que trafega entre API e painel (index.d.ts); a API prova em api/test/contracts.types.ts que cumpre o contrato
api/                backend: projeto Node próprio (package.json, tsconfig, Dockerfile com contexto na raiz)
  src/              API (módulos catalog, inventory, orders, fulfillment, production, integrations, dashboard, security, pricing)
  src/worker.ts     worker do outbox (publicação, métricas, retenção)
  migrations/       SQL versionado (001…010)
  test/             testes unitários (test/*.test.ts) e de integração (test/integration/)
web/                frontend: painel React (Vite) + Dockerfile e nginx.conf (cabeçalhos de segurança, CSP, proxy /api)
scripts/            backup-db.sh, e2e-stack.sh (pilha do Compose pronta para o smoke e2e)
e2e/                smoke e2e com Playwright (tests/smoke.spec.ts, playwright.config.ts)
compose.yaml        postgres, api, worker e web (as imagens são construídas a partir da raiz: `docker build -f api/Dockerfile .`)
.env                configuração local compartilhada (a partir do .env.example)
docs/               arquitetura, contratos da API, tutorial e avaliação de arquitetura
```

## Solução de problemas

| Sintoma | O que verificar |
|---|---|
| `DATABASE_URL não configurada` | rode pelos scripts `npm run ...` dentro de `api/`, que carregam o `.env` da raiz |
| `SESSION_SECRET deve ter ao menos 32 caracteres` | defina o segredo no `.env` |
| Conexão recusada no banco | `npm run db:up` e `docker compose ps`; porta local 5434 |
| `relation ... does not exist` | `npm run migrate` no banco certo |
| `address already in use` | outra aplicação usa a porta: troque `PORT` ou `API_HOST_PORT`/`WEB_HOST_PORT` no `.env` |
| Painel abre, mas a API falha | API no ar? O proxy do Vite usa a `PORT` do `.env`; no Compose, `docker compose logs web api` |
| 403 em toda escrita | o token CSRF mudou (novo login ou sessão expirada): recarregue a página |
| `defina POSTGRES_PASSWORD no .env` ao subir o Compose | o `.env` foi criado antes desta variável existir: copie a linha do `.env.example` |
| `worker` aparece `unhealthy` | `docker compose logs worker`; o healthcheck exige que o laço toque o heartbeat a cada 5 s |
| Evento do outbox parado | `GET /outbox/dead` (ou a tela Integrações) mostra o erro; corrija o destino e use **Tentar de novo** |

## Limitações

- Integração real com Mercado Livre e Shopee ainda não existe. Depende de aplicativo aprovado nas plataformas (Fase E do plano).
- Os eventos do outbox vão para o log ou para um webhook genérico; ainda não há consumidor real.
- Uma única loja e uma conta de dona; não há permissões por equipe.
- Uma resposta 200 não comprova segurança nem capacidade para produção; não há garantia de escala.
