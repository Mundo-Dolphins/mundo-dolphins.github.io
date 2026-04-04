#!/usr/bin/env bash
set -euo pipefail

# notify_social_posts.sh
# Sends only Bluesky posts that have not been notified yet.
# The notified state is persisted by the workflow and only saved on successful runs.

echo "📋 Checking for social posts pending notification..."

# Source common Telegram send function with retry logic
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/telegram_send.sh"

TEMP_NEW_POSTS=$(mktemp)
TEMP_POSTS_FILES=$(mktemp)
TEMP_KNOWN_URLS=$(mktemp)
TEMP_SENT_URLS=$(mktemp)

STATE_DIR="${SOCIAL_NOTIFY_STATE_DIR:-.cache/notify-social}"
STATE_FILE="${STATE_DIR}/sent-post-urls.txt"
LAST_SENT_DATE_FILE="${STATE_DIR}/last-sent-date.txt"

mkdir -p "$STATE_DIR"
touch "$STATE_FILE"

sort -u "$STATE_FILE" > "${STATE_FILE}.sorted"
mv "${STATE_FILE}.sorted" "$STATE_FILE"
cp "$STATE_FILE" "$TEMP_KNOWN_URLS"

to_epoch() {
  local iso_date="$1"
  date -u -d "$iso_date" '+%s' 2>/dev/null || date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$iso_date" '+%s' 2>/dev/null || echo ""
}

# Determine the fetch start time using the following priority order:
# 1. Timestamp of the last post successfully sent to Telegram (from cache)
# 2. Timestamp of the last successful workflow execution
# 3. 24-hour fallback
FETCH_SINCE=""
FETCH_SINCE_SOURCE=""

# Priority 1: cached last sent post date
if [ -f "$LAST_SENT_DATE_FILE" ] && [ -s "$LAST_SENT_DATE_FILE" ]; then
  CACHED_DATE=$(tr -d '[:space:]' < "$LAST_SENT_DATE_FILE")
  if [ -n "$CACHED_DATE" ]; then
    CACHED_EPOCH=$(to_epoch "$CACHED_DATE")
    if [[ "$CACHED_EPOCH" =~ ^[0-9]+$ ]] && [ "$CACHED_EPOCH" -gt 0 ]; then
      FETCH_SINCE="$CACHED_DATE"
      FETCH_SINCE_SOURCE="cache last sent post timestamp"
      echo "📅 Using cache last sent post timestamp: $FETCH_SINCE"
    fi
  fi
fi

# Priority 2: last successful workflow run date
if [ -z "$FETCH_SINCE" ] && [ -n "${LAST_SUCCESSFUL_RUN_DATE:-}" ]; then
  FETCH_SINCE="$LAST_SUCCESSFUL_RUN_DATE"
  FETCH_SINCE_SOURCE="last successful run timestamp"
  echo "📅 Using last successful run timestamp: $FETCH_SINCE"
fi

# Priority 3: 24-hour fallback
if [ -z "$FETCH_SINCE" ]; then
  FETCH_SINCE=$(date -u -d '24 hours ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-24H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)
  FETCH_SINCE_SOURCE="24-hour fallback"
  echo "⚠️ No workflow history or cache found. Using 24-hour fallback window: $FETCH_SINCE"
fi

find data -maxdepth 1 -type f -name 'posts_*.json' | sort > "$TEMP_POSTS_FILES"

if [ ! -s "$TEMP_POSTS_FILES" ]; then
  echo "❌ No social data files found in data/posts_*.json"
  rm -f "$TEMP_NEW_POSTS" "$TEMP_POSTS_FILES" "$TEMP_KNOWN_URLS" "$TEMP_SENT_URLS"
  exit 1
fi

collect_pending_posts_from_file() {
  local posts_file="$1"
  local current_json temp_current pending_urls post

  current_json=$(cat "$posts_file")
  
  # Check if we have previous state (URL cache) or should use date-based fallback
  if [ -s "$TEMP_KNOWN_URLS" ]; then
    # We have previous state: use URL-based deduplication
    temp_current=$(mktemp)
    printf '%s' "$current_json" | jq -r '.[] | select(.stype == 0) | select(.BlueSkyPost.BskyPost != null) | .BlueSkyPost.BskyPost' | sort -u > "$temp_current"
    pending_urls=$(comm -23 "$temp_current" "$TEMP_KNOWN_URLS")

    if [ -n "$pending_urls" ]; then
      while IFS= read -r url; do
        [ -z "$url" ] && continue
        post=$(printf '%s' "$current_json" | jq -c --arg url "$url" '
          .[] |
          select(.stype == 0) |
          select(.PublishedOn != null) |
          select(.BlueSkyPost.Description != null) |
          select(.BlueSkyPost.BskyPost == $url)
        ')
        if [ -n "$post" ]; then
          echo "$post" >> "$TEMP_NEW_POSTS"
        fi
      done <<< "$pending_urls"
    fi

    rm -f "$temp_current"
  else
    # No previous state: use date-based filtering from FETCH_SINCE
    printf '%s' "$current_json" | jq -c --arg cutoff "$FETCH_SINCE" '
      .[] |
      select(.stype == 0) |
      select(.PublishedOn != null) |
      select(.BlueSkyPost.Description != null) |
      select(.BlueSkyPost.BskyPost != null) |
      select(.PublishedOn > $cutoff)
    ' >> "$TEMP_NEW_POSTS"
  fi
}

while IFS= read -r posts_file; do
  [ -z "$posts_file" ] && continue
  collect_pending_posts_from_file "$posts_file"
done < "$TEMP_POSTS_FILES"

if [ ! -s "$TEMP_NEW_POSTS" ]; then
  echo "✅ No social posts pending notification"
  rm -f "$TEMP_NEW_POSTS" "$TEMP_POSTS_FILES" "$TEMP_KNOWN_URLS" "$TEMP_SENT_URLS"
  exit 0
fi

sort -u "$TEMP_NEW_POSTS" | jq -s 'unique_by(.BlueSkyPost.BskyPost) | sort_by(.PublishedOn)' > "${TEMP_NEW_POSTS}.json"
mv "${TEMP_NEW_POSTS}.json" "$TEMP_NEW_POSTS"

# Count posts to send
NEW_COUNT=$(jq 'length' "$TEMP_NEW_POSTS")
echo "📊 New posts found: $NEW_COUNT"

if [ "$NEW_COUNT" -eq 0 ]; then
  echo "✅ No valid posts to send"
  rm -f "$TEMP_NEW_POSTS" "$TEMP_POSTS_FILES" "$TEMP_KNOWN_URLS" "$TEMP_SENT_URLS"
  exit 0
fi

# Send posts to Telegram (in chronological order: oldest first)
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
      printf '%s\n' "$URL" >> "$TEMP_SENT_URLS"
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
    printf '%s\n' "$URL" >> "$TEMP_SENT_URLS"
    LAST_SENT_DATE="$POST_DATE"
  fi
done < <(jq -c '.[]' "$TEMP_NEW_POSTS")

if [ "$FAILED_COUNT" -gt 0 ]; then
  echo "❌ Notification run failed before completion. State will not be updated."
  rm -f "$TEMP_NEW_POSTS" "$TEMP_POSTS_FILES" "$TEMP_KNOWN_URLS" "$TEMP_SENT_URLS"
  exit 1
fi

if [ -s "$TEMP_SENT_URLS" ]; then
  cat "$TEMP_SENT_URLS" >> "$STATE_FILE"
  sort -u "$STATE_FILE" > "${STATE_FILE}.sorted"
  mv "${STATE_FILE}.sorted" "$STATE_FILE"

  # Save the last sent post date for future runs (used as primary fetch-since reference)
  if [ -n "$LAST_SENT_DATE" ]; then
    echo "$LAST_SENT_DATE" > "$LAST_SENT_DATE_FILE"
  fi
fi

echo "📊 Posts sent: $SENT_COUNT of $NEW_COUNT"

# Clean up
rm -f "$TEMP_NEW_POSTS" "$TEMP_POSTS_FILES" "$TEMP_KNOWN_URLS" "$TEMP_SENT_URLS"

echo "✅ Process completed"
