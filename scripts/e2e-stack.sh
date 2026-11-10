#!/usr/bin/env bash
# Pilha do Compose para o smoke e2e: sobe banco, API, worker e painel, aplica as migrations,
# garante a conta de teste e espera o painel responder. `down` para e remove api/worker/web (o banco fica).
#   scripts/e2e-stack.sh up
#   npm run e2e
#   scripts/e2e-stack.sh down
# A conta vem de E2E_EMAIL / E2E_PASSWORD (os mesmos padrões do teste). Atenção: no banco local os dados
# do roteiro (produto E2E-…, pedidos, material) ficam gravados; o CI usa um banco descartável.
set -euo pipefail
cd "$(dirname "$0")/.."

E2E_EMAIL="${E2E_EMAIL:-e2e@tres-eixos.test}"
E2E_PASSWORD="${E2E_PASSWORD:-e2e-senha-segura-123}"
WEB_PORT="${WEB_HOST_PORT:-$( { grep -E '^WEB_HOST_PORT=' .env 2>/dev/null || echo '=8088'; } | cut -d= -f2)}"

case "${1:-up}" in
  up)
    docker compose up -d --build postgres api worker web
    docker compose run --rm api node src/scripts/migrate.mjs
    if ! output=$(docker compose run --rm -e NEW_PASSWORD="$E2E_PASSWORD" api node dist/src/scripts/create-user.js \
        --email "$E2E_EMAIL" --name "Conta e2e" 2>&1); then
      echo "$output"
      grep -q "já cadastrado" <<<"$output" || exit 1
    fi
    for _ in $(seq 1 60); do
      if curl -fsS "http://127.0.0.1:$WEB_PORT/api/ready" >/dev/null 2>&1; then
        echo "painel pronto em http://127.0.0.1:$WEB_PORT"
        exit 0
      fi
      sleep 2
    done
    echo "o painel não respondeu em 120 s" >&2
    docker compose ps
    docker compose logs --tail=50 api web
    exit 1
    ;;
  down)
    docker compose stop api worker web
    docker compose rm -f api worker web
    ;;
  *)
    echo "uso: $0 up|down" >&2
    exit 2
    ;;
esac
