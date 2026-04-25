#!/usr/bin/env bash
set -euo pipefail

# trigger_posts_workflow.sh
# Dispara el workflow de deteccion de posts sociales mediante repository_dispatch.
# Uso minimo:
#   GITHUB_TOKEN=... ./trigger_posts_workflow.sh
# Uso completo:
#   GITHUB_TOKEN=... GITHUB_OWNER=Mundo-Dolphins GITHUB_REPO=mundo-dolphins.github.io ./trigger_posts_workflow.sh

GITHUB_OWNER="${GITHUB_OWNER:-Mundo-Dolphins}"
GITHUB_REPO="${GITHUB_REPO:-mundo-dolphins.github.io}"
EVENT_TYPE="${EVENT_TYPE:-social-check}"
GITHUB_API="${GITHUB_API:-https://api.github.com}"
MAX_RETRIES="${MAX_RETRIES:-3}"
LOCK_FILE="${LOCK_FILE:-/tmp/md-social-dispatch.lock}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/.env}"

# Auto-load environment when running from cron/systemd.
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ERROR: falta GITHUB_TOKEN" >&2
  echo "Define un token con permisos para dispatch de workflows en ${GITHUB_OWNER}/${GITHUB_REPO}." >&2
  exit 1
fi

if command -v flock >/dev/null 2>&1; then
  exec 9>"${LOCK_FILE}"
  if ! flock -n 9; then
    echo "INFO: otro trigger sigue en ejecucion, se omite esta ronda"
    exit 0
  fi
fi

URL="${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HOSTNAME_VALUE="$(hostname 2>/dev/null || echo unknown-host)"
RESPONSE_FILE="$(mktemp)"

cleanup() {
  rm -f "$RESPONSE_FILE"
}
trap cleanup EXIT

PAYLOAD=$(cat <<EOF
{
  "event_type": "${EVENT_TYPE}",
  "client_payload": {
    "source": "external-cron",
    "host": "${HOSTNAME_VALUE}",
    "triggered_at": "${TIMESTAMP}"
  }
}
EOF
)

echo "Dispatching ${EVENT_TYPE} to ${GITHUB_OWNER}/${GITHUB_REPO}..."

ATTEMPT=1
while [[ "$ATTEMPT" -le "$MAX_RETRIES" ]]; do
  HTTP_CODE=$(curl -sS -o "$RESPONSE_FILE" -w "%{http_code}" \
    --connect-timeout 10 \
    --max-time 40 \
    -X POST \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -H "User-Agent: md-social-dispatcher" \
    "${URL}" \
    -d "${PAYLOAD}" || true)

  if [[ "${HTTP_CODE}" == "204" ]]; then
    echo "OK: workflow disparado (${EVENT_TYPE}) a las ${TIMESTAMP}"
    exit 0
  fi

  echo "WARN: intento ${ATTEMPT}/${MAX_RETRIES} fallo con HTTP ${HTTP_CODE}" >&2
  cat "$RESPONSE_FILE" >&2 || true

  if [[ "$ATTEMPT" -lt "$MAX_RETRIES" ]]; then
    sleep "$((ATTEMPT * 5))"
  fi

  ATTEMPT=$((ATTEMPT + 1))
done

echo "ERROR: no se pudo disparar el workflow tras ${MAX_RETRIES} intentos" >&2
exit 1
