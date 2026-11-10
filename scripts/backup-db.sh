#!/usr/bin/env sh
# Backup diário do banco do Compose: pg_dump comprimido em backups/, mantendo os últimos 14.
# Uso manual:  scripts/backup-db.sh
# Cron (todo dia às 3h):  0 3 * * * cd /caminho/do/projeto && scripts/backup-db.sh >> backups/backup.log 2>&1
# Restauração (em um banco separado, nunca sobre o banco em uso):
#   gunzip -c backups/app-AAAA-MM-DD.sql.gz | docker compose exec -T postgres psql -U app -d app_restaurado
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
file="backups/app-$(date +%Y-%m-%d-%H%M).sql.gz"
docker compose exec -T postgres sh -c 'pg_dump -U app app' | gzip > "$file"
echo "backup gravado em $file ($(du -h "$file" | cut -f1))"
# Apaga os mais antigos, mantendo 14 arquivos.
ls -1t backups/app-*.sql.gz | tail -n +15 | xargs -r rm --
