#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-/home/projeto-mae/.env}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI nao encontrado no ambiente." >&2
  exit 1
fi

DB_URL="${SUPABASE_DB_URL:-}"

if [ -z "$DB_URL" ] && [ -n "${SUPABASE_POOLER_HOST:-}" ]; then
  DB_URL="$("$ROOT_DIR/.venv/bin/python" - <<'PY'
import os
import urllib.parse

project_url = os.getenv("SUPABASE_PROJECT_URL") or os.getenv("SUPABASE_URL") or ""
ref = project_url.split("//")[-1].split(".")[0].strip()
password = urllib.parse.quote(os.getenv("SENHA_SUPABASE", ""), safe="")
host = os.getenv("SUPABASE_POOLER_HOST", "").strip()
port = os.getenv("SUPABASE_DB_PORT", "5432").strip()
user = os.getenv("SUPABASE_DB_USER", f"postgres.{ref}").strip()

if not ref or not password or not host:
    raise SystemExit("SUPABASE_PROJECT_URL, SENHA_SUPABASE e SUPABASE_POOLER_HOST sao obrigatorios.")

print(f"postgresql://{user}:{password}@{host}:{port}/postgres")
PY
)"
fi

if [ -z "$DB_URL" ]; then
  DB_URL="$("$ROOT_DIR/.venv/bin/python" - <<'PY'
import os
import urllib.parse

project_url = os.getenv("SUPABASE_PROJECT_URL") or os.getenv("SUPABASE_URL") or ""
ref = project_url.split("//")[-1].split(".")[0].strip()
password = urllib.parse.quote(os.getenv("SENHA_SUPABASE", ""), safe="")

if not ref or not password:
    raise SystemExit("SUPABASE_PROJECT_URL e SENHA_SUPABASE sao obrigatorios.")

print(f"postgresql://postgres:{password}@db.{ref}.supabase.co:5432/postgres")
PY
)"
fi

if [[ "$DB_URL" == *"YOUR-PASSWORD"* ]] && [ -n "\${SENHA_SUPABASE:-}" ]; then
  DB_URL="$(DB_URL="$DB_URL" SENHA_SUPABASE="$SENHA_SUPABASE" "$ROOT_DIR/.venv/bin/python" - <<'PY'
import os
import urllib.parse

db_url = os.environ["DB_URL"]
password = urllib.parse.quote(os.environ["SENHA_SUPABASE"], safe="")
db_url = db_url.replace("[YOUR-PASSWORD]", password)
db_url = db_url.replace("YOUR-PASSWORD", password)
print(db_url)
PY
)"
fi

echo "Aplicando migrations do Supabase..."
if ! OUTPUT="$(supabase db push --workdir "$ROOT_DIR/cloudflare" --db-url "$DB_URL" --yes 2>&1)"; then
  printf '%s\n' "$OUTPUT" >&2
  if printf '%s' "$OUTPUT" | grep -q "network is unreachable"; then
    cat >&2 <<'MSG'

Nao foi possivel conectar ao Postgres direto do Supabase a partir desta maquina.
Esse projeto esta resolvendo o host db.<project-ref>.supabase.co para IPv6, mas o ambiente atual nao tem rota IPv6.

Configure uma destas variaveis no .env e rode o script novamente:

1. SUPABASE_DB_URL
   Cole a connection string completa do Supabase em Project Settings > Database > Connection string.
   Preferencialmente use a string do pooler/session pooler, nao a direct connection IPv6.

2. Ou configure o pooler em partes:
   SUPABASE_POOLER_HOST=aws-...pooler.supabase.com
   SUPABASE_DB_PORT=5432
   SUPABASE_DB_USER=postgres.<project-ref>

MSG
  fi
  exit 1
fi
printf '%s\n' "$OUTPUT"
echo "Migrations aplicadas."
