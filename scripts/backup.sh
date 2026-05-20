#!/usr/bin/env bash
# Backup do SQLite usando ".backup" (atômico, suporta WAL).
#
# Uso (manual):
#   bash scripts/backup.sh
#
# Variáveis:
#   DATABASE_URL          file:caminho/para/o/banco.db (default: file:./prisma/dev.db)
#   BACKUP_DIR            destino dos snapshots (default: ./backups)
#   BACKUP_RETENTION_DAYS dias de retenção (default: 14)
#
# Cron diário às 03:00:
#   0 3 * * * cd /opt/unifi-captiveportal && bash scripts/backup.sh >> /var/log/portal-backup.log 2>&1

set -euo pipefail

DB_URL="${DATABASE_URL:-file:./prisma/dev.db}"
DB_PATH="${DB_URL#file:}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if [ ! -f "$DB_PATH" ]; then
  echo "[backup] erro: banco não encontrado em $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/portal-$STAMP.db"

# .backup é a forma oficial e atômica do sqlite3, segura mesmo com WAL ativo
# e escritas concorrentes pelo Node.
sqlite3 "$DB_PATH" ".backup '$TARGET'"

# Comprime para economizar espaço.
gzip -f "$TARGET"
echo "[backup] criado $TARGET.gz"

# Retenção: remove arquivos mais velhos que RETAIN_DAYS dias.
find "$BACKUP_DIR" -type f -name 'portal-*.db.gz' -mtime "+$RETAIN_DAYS" -print -delete
