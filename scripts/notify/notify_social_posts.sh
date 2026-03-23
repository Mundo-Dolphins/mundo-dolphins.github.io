#!/usr/bin/env bash
set -euo pipefail

# notify_social_posts.sh
# Sends only Bluesky posts that have not been notified yet.
# The notified state is persisted by the workflow and only saved on successful runs.

echo "📋 Checking for social posts pending notification..."

# Source common Telegram send function with retry logic
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/telegram_send.sh"

# Calculate fallback cutoff date (15 minutes ago) for use if primary filters unavailable
# Fallback is used when cache is missing AND last successful run date is unavailable
FALLBACK_CUTOFF=$(date -u -d '15 minutes ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-15M '+%Y-%m-%dT%H:%M:%SZ')

TEMP_NEW_POSTS=$(mktemp)
TEMP_POSTS_FILES=$(mktemp)
TEMP_KNOWN_URLS=$(mktemp)
TEMP_SENT_URLS=$(mktemp)

STATE_DIR="${SOCIAL_NOTIFY_STATE_DIR:-.cache/notify-social}"
STATE_FILE="${STATE_DIR}/sent-post-urls.txt"

mkdir -p "$STATE_DIR"
touch "$STATE_FILE"

sort -u "$STATE_FILE" > "${STATE_FILE}.sorted"
mv "${STATE_FILE}.sorted" "$STATE_FILE"
cp "$STATE_FILE" "$TEMP_KNOWN_URLS"

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
    # No previous state: use date-based filtering
    if [ -n "${LAST_SUCCESSFUL_RUN_DATE:-}" ]; then
      # Use the last successful workflow run date
      cutoff_date="$LAST_SUCCESSFUL_RUN_DATE"
      echo "   Using last successful run date: $cutoff_date"
    else
      # Fallback: use 15-minute window as safeguard
      cutoff_date="$FALLBACK_CUTOFF"
      echo "   ⚠️ No workflow history found. Using 15-minute fallback window: $cutoff_date"
    fi

    # Filter posts published after cutoff
    printf '%s' "$current_json" | jq -c --arg cutoff "$cutoff_date" '
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
fi

echo "📊 Posts sent: $SENT_COUNT of $NEW_COUNT"

# Clean up
rm -f "$TEMP_NEW_POSTS" "$TEMP_POSTS_FILES" "$TEMP_KNOWN_URLS" "$TEMP_SENT_URLS"

echo "✅ Process completed"
