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
cd api && npm ci && cd ..
cd web && npm ci && cd ..
```

O `.env` fica na raiz porque é compartilhado pela API, pelo proxy do Vite e pelo Docker Compose. Edite o `.env`:

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | banco local (Postgres do Compose em `127.0.0.1:5434`) |
| `PORT` | porta da API em desenvolvimento (ex.: `8080`) |
| `SESSION_SECRET` | **troque** por um valor aleatório: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TEST_DATABASE_URL` | banco dos testes de integração; o nome precisa terminar em `_test` |
| `API_HOST_PORT`, `WEB_HOST_PORT` | portas do Compose no host (padrão 8080 e 8088); troque se estiverem ocupadas |

O `.env` nunca vai para o Git nem para as imagens Docker.

## 2. Banco de dados e migrations

```bash
cd api
npm run db:up        # sobe o PostgreSQL (container tres-eixos-postgres)
npm run migrate      # aplica as migrations pendentes de api/migrations/ em ordem
```

O `migrate` pode ser rodado sempre: ele aplica só o que falta e registra tudo em `schema_migrations`. **Nunca edite uma migration já aplicada**; crie a próxima (`010_...sql`).

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

Dentro do Compose, a API fala com o banco pelo nome `postgres`, porta 5432. Tudo é publicado só em `127.0.0.1`, nunca na rede.

Comandos do dia a dia:

```bash
docker compose logs -f api worker     # acompanhar logs
docker compose stop                   # pausar mantendo os dados
docker compose down                   # remover containers mantendo os volumes
```

**Não** use `docker compose down -v` como rotina: o `-v` **apaga o banco**.

Se a API e o Compose forem usados ao mesmo tempo, as portas conflitam. Use uma opção de cada vez.

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
9. **Integrações**: **Sincronizar pedidos simulados**. Aparecem pendências de SKU (`SIM-...`). Mapeie cada uma para um produto; os pedidos pendentes são reprocessados. Sincronize de novo: nada é duplicado.

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
```

Também vale testar os erros esperados:
- requisição sem login: `401`;
- escrita sem `X-CSRF-Token`: `403`;
- SKU duplicado: `409`;
- pedido sem `Idempotency-Key`: `400`;
- cancelar pedido já enviado: `409`;
- seis senhas erradas seguidas: `429`.

### Testes automatizados

```bash
cd api
npm test                     # regras puras (estoque, pedidos, fila, validação, conector), sem banco
npm run test:integration     # PostgreSQL real: concorrência, idempotência, produção, importação, worker, login
npm run typecheck
cd ../web && npm test && npm run lint && npm run build
```

Os testes de integração usam `TEST_DATABASE_URL` e **recriam o schema** desse banco a cada execução. Por isso se recusam a rodar em um banco cujo nome não termine em `_test`. Nunca aponte para o banco real da loja.

O CI (`.github/workflows/ci.yml`) roda tudo isso no GitHub, com um PostgreSQL isolado, e também constrói as imagens Docker.

## Backup

```bash
mkdir -p backups
docker compose exec -T postgres sh -c 'pg_dump -U app app' > backups/demo.sql
```

`backups/` está no `.gitignore`. Teste a restauração em um banco separado, nunca sobre o banco em uso.

## Estrutura

```
api/                backend: projeto Node próprio (package.json, tsconfig, Dockerfile)
  src/              API (módulos catalog, inventory, orders, production, integrations, security, pricing)
  src/worker.ts     worker do outbox
  migrations/       SQL versionado (001…009)
  test/             testes unitários (test/*.test.ts) e de integração (test/integration/)
web/                frontend: painel React (Vite) + Dockerfile e nginx.conf
compose.yaml        postgres, api, worker e web
.env                configuração local compartilhada (a partir do .env.example)
docs/               arquitetura e contratos da API
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

## Limitações

- Integração real com Mercado Livre e Shopee ainda não existe. Depende de aplicativo aprovado nas plataformas (Fase E do plano).
- Os eventos do outbox vão para o log ou para um webhook genérico; ainda não há consumidor real.
- Uma única loja e uma conta de dona; não há permissões por equipe.
- Uma resposta 200 não comprova segurança nem capacidade para produção; não há garantia de escala.
