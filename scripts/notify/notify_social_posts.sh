#!/usr/bin/env bash
set -euo pipefail

# notify_social_posts.sh
# Sends only Bluesky posts newer than the last successfully sent post timestamp.
# Cache stores a single value: the ISO 8601 publication timestamp of the last sent post.
# On cache miss or invalid cache, falls back to posts from the last 24 hours only.

echo "📋 Checking for social posts pending notification..."

# Source common Telegram send function with retry logic
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/telegram_send.sh"

TEMP_NEW_POSTS=$(mktemp)
TEMP_POSTS_FILES=$(mktemp)

# Ensure temp files are removed on any exit
cleanup() { rm -f "$TEMP_NEW_POSTS" "$TEMP_POSTS_FILES"; }
trap cleanup EXIT

STATE_DIR="${SOCIAL_NOTIFY_STATE_DIR:-.cache/notify-social}"
LAST_SENT_DATE_FILE="${STATE_DIR}/last-sent-date.txt"

mkdir -p "$STATE_DIR"

to_epoch() {
  local iso_date="$1"
  date -u -d "$iso_date" '+%s' 2>/dev/null || date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$iso_date" '+%s' 2>/dev/null || echo ""
}

# Determine the lower-bound timestamp for candidate posts.
# Cache hit:   use the cached last-sent post timestamp (posts published strictly after it).
# Cache miss:  fall back to 24 hours ago.
# Cache invalid (unparseable): fall back to 24 hours ago.
FETCH_SINCE=""

if [ -f "$LAST_SENT_DATE_FILE" ] && [ -s "$LAST_SENT_DATE_FILE" ]; then
  CACHED_DATE=$(tr -d '[:space:]' < "$LAST_SENT_DATE_FILE")
  if [ -n "$CACHED_DATE" ]; then
    CACHED_EPOCH=$(to_epoch "$CACHED_DATE")
    if [[ "$CACHED_EPOCH" =~ ^[0-9]+$ ]] && [ "$CACHED_EPOCH" -gt 0 ]; then
      FETCH_SINCE="$CACHED_DATE"
      echo "✅ Cache hit: last sent post timestamp: $FETCH_SINCE"
    else
      echo "⚠️ Cache invalid: cannot parse '$CACHED_DATE'. Falling back to 24-hour window."
    fi
  else
    echo "⚠️ Cache invalid: empty content. Falling back to 24-hour window."
  fi
else
  echo "⚠️ Cache miss: no cached timestamp found. Falling back to 24-hour window."
fi

if [ -z "$FETCH_SINCE" ]; then
  FETCH_SINCE=$(date -u -d '24 hours ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-24H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)
  echo "📅 Selected lower-bound timestamp (24h fallback): $FETCH_SINCE"
else
  echo "📅 Selected lower-bound timestamp: $FETCH_SINCE"
fi

find data -maxdepth 1 -type f -name 'posts_*.json' | sort > "$TEMP_POSTS_FILES"

if [ ! -s "$TEMP_POSTS_FILES" ]; then
  echo "❌ No social data files found in data/posts_*.json"
  exit 1
fi

while IFS= read -r posts_file; do
  [ -z "$posts_file" ] && continue
  jq -c --arg cutoff "$FETCH_SINCE" '
    .[] |
    select(.stype == 0) |
    select(.PublishedOn != null) |
    select(.BlueSkyPost.Description != null) |
    select(.BlueSkyPost.BskyPost != null) |
    select(.PublishedOn > $cutoff)
  ' "$posts_file" >> "$TEMP_NEW_POSTS"
done < "$TEMP_POSTS_FILES"

if [ ! -s "$TEMP_NEW_POSTS" ]; then
  echo "✅ No new posts found after $FETCH_SINCE"
  exit 0
fi

# Deduplicate by URL and sort chronologically (oldest first)
jq -s 'unique_by(.BlueSkyPost.BskyPost) | sort_by(.PublishedOn)' "$TEMP_NEW_POSTS" > "${TEMP_NEW_POSTS}.json"
mv "${TEMP_NEW_POSTS}.json" "$TEMP_NEW_POSTS"

NEW_COUNT=$(jq 'length' "$TEMP_NEW_POSTS")
echo "📊 Candidate posts found: $NEW_COUNT"

if [ "$NEW_COUNT" -eq 0 ]; then
  echo "✅ No valid posts to send"
  exit 0
fi

echo "📤 Sending $NEW_COUNT posts to Telegram..."

SENT_COUNT=0
FAILED_COUNT=0
LAST_SENT_DATE=""

while IFS= read -r post; do
  DESCRIPTION=$(echo "$post" | jq -r '.BlueSkyPost.Description')
  URL=$(echo "$post" | jq -r '.BlueSkyPost.BskyPost')
  POST_DATE=$(echo "$post" | jq -r '.PublishedOn')

  # Build message
  MESSAGE="🐬 ${DESCRIPTION}

🔗 ${URL}"

  # Send to Telegram
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    SEND_RESULT=$(send_to_telegram "$MESSAGE")

    if [ "$SEND_RESULT" = "success" ]; then
      echo "✅ Sent: ${DESCRIPTION:0:50}... (${POST_DATE})"
      SENT_COUNT=$((SENT_COUNT + 1))
      LAST_SENT_DATE="$POST_DATE"

      # Small pause between messages to avoid rate limits
      sleep 2
    else
      echo "❌ Error sending: ${DESCRIPTION:0:50}..."
      echo "Response: $SEND_RESULT"
      FAILED_COUNT=$((FAILED_COUNT + 1))
      break
    fi
  else
    echo "⚠️ DRY RUN: ${DESCRIPTION:0:50}... (${POST_DATE})"
    SENT_COUNT=$((SENT_COUNT + 1))
    LAST_SENT_DATE="$POST_DATE"
  fi
done < <(jq -c '.[]' "$TEMP_NEW_POSTS")

if [ "$FAILED_COUNT" -gt 0 ]; then
  echo "❌ Notification run failed before completion. Cache not updated."
  exit 1
fi

echo "📊 Posts sent: $SENT_COUNT of $NEW_COUNT"

# Update cache only when at least one post was successfully sent
if [ -n "$LAST_SENT_DATE" ]; then
  echo "$LAST_SENT_DATE" > "$LAST_SENT_DATE_FILE"
  echo "💾 Cache updated: $LAST_SENT_DATE"
else
  echo "ℹ️ No posts sent, cache not updated."
fi

echo "✅ Process completed"
