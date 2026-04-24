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

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ERROR: falta GITHUB_TOKEN" >&2
  echo "Define un token con permisos para dispatch de workflows en ${GITHUB_OWNER}/${GITHUB_REPO}." >&2
  exit 1
fi

URL="${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HOSTNAME_VALUE="$(hostname 2>/dev/null || echo unknown-host)"

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

HTTP_CODE=$(curl -sS -o /tmp/gh_dispatch_response.txt -w "%{http_code}" \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "${URL}" \
  -d "${PAYLOAD}")

if [[ "${HTTP_CODE}" != "204" ]]; then
  echo "ERROR: dispatch fallo con HTTP ${HTTP_CODE}" >&2
  cat /tmp/gh_dispatch_response.txt >&2 || true
  rm -f /tmp/gh_dispatch_response.txt
  exit 1
fi

rm -f /tmp/gh_dispatch_response.txt

echo "OK: workflow disparado (${EVENT_TYPE}) a las ${TIMESTAMP}"
