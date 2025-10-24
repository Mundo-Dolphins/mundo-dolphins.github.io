#!/usr/bin/env bash
set -euo pipefail

# notify_social_posts.sh
# Main script that detects and sends new social posts to Telegram
# Criteria:
# 1. Read only data/posts_1.json (most recent posts chronologically)
# 2. Filter posts by date using cache (.github/notifications/last_post_date.txt)
# 3. If no cache exists, query Telegram to see which URLs are already published
# 4. After sending, update cache with the date of the most recent post sent

CACHE_FILE=".github/notifications/last_post_date.txt"
POSTS_FILE="data/posts_1.json"

# Verify posts file exists
if [ ! -f "$POSTS_FILE" ]; then
  echo "❌ Posts file not found: $POSTS_FILE"
  exit 1
fi

# Create notifications directory if it doesn't exist
mkdir -p .github/notifications

echo "📋 Reading posts from $POSTS_FILE"

# Step 1: Read last sent post date from cache
LAST_DATE=""
if [ -f "$CACHE_FILE" ]; then
  LAST_DATE=$(cat "$CACHE_FILE")
  echo "📅 Last cached date: $LAST_DATE"
else
  echo "⚠️ No cached date found"
fi

# Step 2: Get list of already published URLs from Telegram (fallback if no cache)
# Note: This is a best-effort fallback. For production use, maintaining a persistent
# cache file is the recommended approach as Telegram's getUpdates API has limitations.
KNOWN_URLS=$(mktemp)
if [ -z "$LAST_DATE" ]; then
  echo "📡 Querying Telegram for already published URLs..."
  echo "⚠️ Note: Without cache, relying on Telegram history. First run may send duplicates."
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    # getUpdates provides bot updates, which may not include all channel messages
    # This is a best-effort approach; cache-based filtering is more reliable
    UPDATES=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?limit=100" || echo '{"ok":false}')
    if echo "$UPDATES" | jq -e '.ok' >/dev/null 2>&1; then
      echo "$UPDATES" | jq -r '.result[]?.message?.text // empty' | \
        grep -oE 'https?://[^[:space:]]+' | sort -u > "$KNOWN_URLS"
      FOUND_COUNT=$(wc -l < "$KNOWN_URLS" | tr -d ' ')
      if [ "$FOUND_COUNT" -gt 0 ]; then
        echo "✅ Found $FOUND_COUNT URLs in Telegram history"
      else
        echo "⚠️ No URLs found in Telegram history (may be first run or channel)"
      fi
    else
      echo "⚠️ Could not retrieve messages from Telegram"
    fi
  else
    echo "⚠️ TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured"
  fi
fi

# Step 3: Filter new posts
TEMP_POSTS=$(mktemp)
if [ -n "$LAST_DATE" ]; then
  # Filter by date
  # Note: String comparison with '>' works correctly for ISO 8601 formatted dates
  # because they are lexicographically sortable (YYYY-MM-DDTHH:MM:SSZ)
  jq -c --arg last_date "$LAST_DATE" '
    .[] | 
    select(.stype == 0) |
    select(.PublishedOn != null) |
    select(.BlueSkyPost.Description != null) |
    select(.BlueSkyPost.BskyPost != null) |
    select(.PublishedOn > $last_date)
  ' "$POSTS_FILE" > "$TEMP_POSTS"
else
  # Filter by known URLs
  jq -c '
    .[] | 
    select(.stype == 0) |
    select(.PublishedOn != null) |
    select(.BlueSkyPost.Description != null) |
    select(.BlueSkyPost.BskyPost != null)
  ' "$POSTS_FILE" | while IFS= read -r post; do
    URL=$(echo "$post" | jq -r '.BlueSkyPost.BskyPost' | xargs)
    if ! grep -Fq "$URL" "$KNOWN_URLS" 2>/dev/null; then
      echo "$post"
    fi
  done > "$TEMP_POSTS"
fi

# Count new posts
NEW_COUNT=$(wc -l < "$TEMP_POSTS" | tr -d ' ')
echo "📊 New posts found: $NEW_COUNT"

if [ "$NEW_COUNT" -eq 0 ]; then
  echo "✅ No new posts to send"
  rm -f "$TEMP_POSTS" "$KNOWN_URLS"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "has_new_posts=false" >> "$GITHUB_OUTPUT"
  fi
  exit 0
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "has_new_posts=true" >> "$GITHUB_OUTPUT"
  echo "posts_count=$NEW_COUNT" >> "$GITHUB_OUTPUT"
fi

# Step 4: Send posts to Telegram
echo "📤 Sending posts to Telegram..."

LATEST_DATE=""
SENT_COUNT=0

while IFS= read -r post; do
  DESCRIPTION=$(echo "$post" | jq -r '.BlueSkyPost.Description')
  URL=$(echo "$post" | jq -r '.BlueSkyPost.BskyPost')
  POST_DATE=$(echo "$post" | jq -r '.PublishedOn')
  
  # Build message
  MESSAGE="🐬 ${DESCRIPTION}

🔗 ${URL}"
  
  # Send to Telegram
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    # Use curl's --data-urlencode for proper form-data encoding
    RESPONSE=$(curl -s -X POST \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${MESSAGE}" \
      -d "disable_web_page_preview=false")
    
    if echo "$RESPONSE" | jq -e '.ok' >/dev/null 2>&1; then
      echo "✅ Sent: ${DESCRIPTION:0:50}..."
      SENT_COUNT=$((SENT_COUNT + 1))
      
      # Update latest date
      # Note: String comparison with '>' works correctly for ISO 8601 formatted dates
      # because they are lexicographically sortable (YYYY-MM-DDTHH:MM:SSZ)
      if [ -z "$LATEST_DATE" ] || [[ "$POST_DATE" > "$LATEST_DATE" ]]; then
        LATEST_DATE="$POST_DATE"
      fi
      
      # Small pause between messages
      sleep 2
    else
      echo "❌ Error sending: ${DESCRIPTION:0:50}..."
      echo "Response: $RESPONSE"
    fi
  else
    echo "⚠️ DRY RUN: ${DESCRIPTION:0:50}..."
    SENT_COUNT=$((SENT_COUNT + 1))
    # Note: String comparison with '>' works correctly for ISO 8601 formatted dates
    # because they are lexicographically sortable (YYYY-MM-DDTHH:MM:SSZ)
    if [[ -z \"$LATEST_DATE\" ]] || [[ \"$POST_DATE\" > \"$LATEST_DATE\" ]]; then
      LATEST_DATE="$POST_DATE"
    fi
  fi
done < "$TEMP_POSTS"

echo "📊 Posts sent: $SENT_COUNT of $NEW_COUNT"

# Step 5: Update cache with the date of the last sent post
if [ -n "$LATEST_DATE" ] && [ "$SENT_COUNT" -gt 0 ]; then
  echo "$LATEST_DATE" > "$CACHE_FILE"
  echo "💾 Cache updated with date: $LATEST_DATE"
fi

# Clean up temporary files
rm -f "$TEMP_POSTS" "$KNOWN_URLS"

echo "✅ Process completed"
