#!/usr/bin/env bash
set -euo pipefail

# filter_posts_against_telegram.sh
# Usage: filter_posts_against_telegram.sh <ndjson_posts_file> <out_json_array>
# Reads newline-delimited JSON posts (each line a JSON object), fetches recent Telegram
# messages via the bot, extracts URLs, and writes a JSON array with posts whose
# BlueSkyPost.BskyPost URL is NOT present in recent Telegram messages.

IN_FILE="${1:-}"
OUT_FILE="${2:-filtered_posts.json}"

if [ -z "$IN_FILE" ] || [ ! -f "$IN_FILE" ]; then
  echo "❌ Input file required and must exist: $IN_FILE"
  exit 1
fi

echo "🔍 Filtering posts in $IN_FILE against Telegram message history"

# Verbose logging control
VERBOSE=${VERBOSE:-0}

# If bot credentials missing, fallback: copy input -> out as JSON array
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "⚠️ TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set; skipping Telegram deduplication"
  jq -s '.' "$IN_FILE" > "$OUT_FILE"
  echo "✅ Wrote $OUT_FILE (no filtering)"
  exit 0
fi

# Fetch recent updates (bot must have seen messages in the channel)
echo "📡 Fetching recent updates from Telegram (bot)"
UPDATES_JSON=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?limit=100")

OK=$(echo "$UPDATES_JSON" | jq -r '.ok // false')
if [ "$OK" != "true" ]; then
  echo "⚠️ Failed to fetch updates from Telegram; falling back to no-filter"
  jq -s '.' "$IN_FILE" > "$OUT_FILE"
  exit 0
fi

# Extract URLs from messages text and entities
MSG_URLS=$(echo "$UPDATES_JSON" | jq -r '.result[]?.message?.text // empty' | grep -oE 'https?://[^[:space:]]+' || true)

if [ -z "$MSG_URLS" ]; then
  echo "ℹ️ No URLs found in recent Telegram messages; nothing to filter"
  jq -s '.' "$IN_FILE" > "$OUT_FILE"
  exit 0
fi

MSG_COUNT=$(echo "$MSG_URLS" | wc -l | tr -d ' ')
echo "Found $MSG_COUNT URLs in Telegram messages:"
if [ "$VERBOSE" -eq 1 ]; then
  echo "$MSG_URLS" | sed 's/^/ - /' | sed -n '1,20p'
else
  echo "$MSG_URLS" | sed 's/^/ - /' | sed -n '1,5p'
  if [ "$MSG_COUNT" -gt 5 ]; then
    echo "  ... and $((MSG_COUNT-5)) more"
  fi
fi

# Build jq filter: for each post, check BlueSkyPost.BskyPost not in the list
TMP_URLS=$(mktemp)
echo "$MSG_URLS" | sort -u > "$TMP_URLS"

# Count posts in input
TOTAL_POSTS=$(wc -l < "$IN_FILE" | tr -d ' ')
echo "Total posts in input NDJSON: $TOTAL_POSTS"

# Convert NDJSON input to array and filter
jq -n --argfile posts "$IN_FILE" --slurpfile seen_urls "$TMP_URLS" '
  ($posts | map(.)) as $p |
  ($seen_urls | .[]) as $u | . | empty' >/dev/null 2>&1 || true

# We'll implement filtering by reading URLs into shell and using jq select
FILTERED=$(mktemp)
DISCARDED_TMP=$(mktemp)
python3 - <<'PY'
import sys, json
infile = sys.argv[1]
tmpurls = sys.argv[2]
out = sys.argv[3]
seen = set()
with open(tmpurls) as f:
  for l in f:
    ln = l.strip()
    if ln:
      seen.add(ln)
arr = []
discarded = []
with open(infile) as f:
  for line in f:
    line = line.strip()
    if not line:
      continue
    try:
      obj = json.loads(line)
    except Exception:
      # skip invalid json lines
      continue
    url = None
    try:
      url = obj.get('BlueSkyPost', {}).get('BskyPost')
    except Exception:
      url = None
    if not url:
      url = obj.get('link') or obj.get('BskyPost') or ''
    if url and url in seen:
      discarded.append(url)
      continue
    arr.append(obj)
with open(out, 'w') as f:
  json.dump(arr, f)
with open(out + '.discarded', 'w') as f:
  json.dump(discarded, f)
PY "$IN_FILE" "$TMP_URLS" "$FILTERED"

# Ensure output is a JSON array
jq '.' "$FILTERED" > "$OUT_FILE"
echo "✅ Wrote filtered posts to $OUT_FILE"

# Report filtering stats
DISCARDED_FILE="$FILTERED.discarded"
if [ -f "$DISCARDED_FILE" ]; then
  DISC_COUNT=$(jq length "$DISCARDED_FILE" 2>/dev/null || echo 0)
else
  DISC_COUNT=0
fi
REMAINING=$(jq length "$OUT_FILE" 2>/dev/null || echo 0)
echo "Filtered: $DISC_COUNT discarded, $REMAINING remaining"
if [ "$VERBOSE" -eq 1 ] && [ "$DISC_COUNT" -gt 0 ]; then
  echo "Discarded URLs (sample):"
  jq -r '.[]' "$DISCARDED_FILE" | sed 's/^/ - /' | sed -n '1,20p'
fi

rm -f "$TMP_URLS" "$FILTERED" "$DISCARDED_FILE"
