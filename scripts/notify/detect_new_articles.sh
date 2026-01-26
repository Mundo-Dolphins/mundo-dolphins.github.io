#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUTPUT_FILE="${REPO_ROOT}/scripts/notify/notifications.json"
TEMP_JSONL="$(mktemp)"

CHANGED_FILES=$(git -c core.quotepath=false diff --name-only -z HEAD~1 HEAD 2>/dev/null || true)
if [ -z "$CHANGED_FILES" ]; then
  echo "✅ No files changed in last commit"
  echo "[]" > "$OUTPUT_FILE"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "has_new_articles=false" >> "$GITHUB_OUTPUT"
    echo "notifications_count=0" >> "$GITHUB_OUTPUT"
  fi
  exit 0
fi

CHANGED_FILES=$(printf '%s' "$CHANGED_FILES" | tr '\0' '\n')

append_notification() {
  local title="$1"
  local body="$2"
  local url="$3"
  local type="$4"

  jq -n \
    --arg title "$title" \
    --arg body "$body" \
    --arg url "$url" \
    --arg type "$type" \
    '{title:$title, body:$body, url:$url, type:$type}' >> "$TEMP_JSONL"
}

# Detect new articles
while IFS= read -r file; do
  if [[ "$file" =~ ^content/noticias/.*\.md$ ]] && [ -f "$file" ]; then
    TITLE=$(grep -m 1 "^title:" "$file" | sed 's/title: *//;s/"//g;s/'"'"'//g' || echo "")
    SLUG=$(basename "$file" .md)
    if [ -n "$TITLE" ]; then
      append_notification "$TITLE" "Nuevo articulo publicado" "https://mundodolphins.es/noticias/${SLUG}/" "article"
    fi
  fi
done <<< "$CHANGED_FILES"

# Detect new podcast episodes
while IFS= read -r file; do
  if [[ "$file" =~ ^data/season_.*\.json$ ]] && [ -f "$file" ]; then
    CURRENT_JSON=$(cat "$file")
    PREVIOUS_JSON=$(git show HEAD~1:"$file" 2>/dev/null || echo "[]")

    TEMP_PREV=$(mktemp)
    TEMP_CURR=$(mktemp)
    echo "$PREVIOUS_JSON" | jq -r '.[].audio // empty' | sort > "$TEMP_PREV"
    echo "$CURRENT_JSON" | jq -r '.[].audio // empty' | sort > "$TEMP_CURR"
    NEW_URLS=$(comm -13 "$TEMP_PREV" "$TEMP_CURR")

    if [ -n "$NEW_URLS" ]; then
      while IFS= read -r url; do
        TITLE=$(echo "$CURRENT_JSON" | jq -r --arg url "$url" '.[] | select(.audio == $url) | .title')
        if [ -n "$TITLE" ] && [ "$TITLE" != "null" ]; then
          SLUG=$(printf '%s' "$TITLE" | python3 -c 'import sys,unicodedata,re; t=sys.stdin.read(); s=unicodedata.normalize("NFKD", t); s=s.encode("ascii","ignore").decode("ascii"); s=re.sub(r"[^a-zA-Z0-9]+","-", s).strip("-").lower(); print(s)')
          if [ -n "$SLUG" ]; then
            append_notification "$TITLE" "Nuevo episodio del podcast" "https://mundodolphins.es/podcast/${SLUG}/" "podcast"
          fi
        fi
      done <<< "$NEW_URLS"
    fi

    rm -f "$TEMP_PREV" "$TEMP_CURR"
  fi
done <<< "$CHANGED_FILES"

if [ -s "$TEMP_JSONL" ]; then
  jq -s '.' "$TEMP_JSONL" > "$OUTPUT_FILE"
else
  echo "[]" > "$OUTPUT_FILE"
fi

NOTIFICATIONS_COUNT=$(jq length "$OUTPUT_FILE")
HAS_NEW="false"
if [ "$NOTIFICATIONS_COUNT" -gt 0 ]; then
  HAS_NEW="true"
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "has_new_articles=${HAS_NEW}" >> "$GITHUB_OUTPUT"
  echo "notifications_count=${NOTIFICATIONS_COUNT}" >> "$GITHUB_OUTPUT"
fi

rm -f "$TEMP_JSONL"
