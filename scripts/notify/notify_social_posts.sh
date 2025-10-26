#!/usr/bin/env bash
set -euo pipefail

# notify_social_posts.sh
# Main script that detects and sends new social posts to Telegram
# Criteria:
# 1. Read only data/posts_1.json (most recent posts chronologically)
# 2. Filter posts using cache of last 20 sent URLs (.github/notifications/sent_urls_cache.txt)
# 3. If no cache exists, filter by date using last_post_date.txt from previous successful run
# 4. After sending, update cache with sent URLs (keep last 20)

DATE_CACHE_FILE=".github/notifications/last_post_date.txt"
URL_CACHE_FILE=".github/notifications/sent_urls_cache.txt"
POSTS_FILE="data/posts_1.json"
MAX_CACHE_URLS=20

# Verify posts file exists
if [ ! -f "$POSTS_FILE" ]; then
  echo "❌ Posts file not found: $POSTS_FILE"
  exit 1
fi

# Create notifications directory if it doesn't exist
mkdir -p .github/notifications

echo "📋 Reading posts from $POSTS_FILE"

# Step 1: Determine filtering method
FILTER_METHOD=""
LAST_DATE=""

if [ -f "$URL_CACHE_FILE" ] && [ -s "$URL_CACHE_FILE" ]; then
  FILTER_METHOD="url_cache"
  CACHE_COUNT=$(wc -l < "$URL_CACHE_FILE" | tr -d ' ')
  echo "📦 URL cache found with $CACHE_COUNT entries"
elif [ -f "$DATE_CACHE_FILE" ] && [ -s "$DATE_CACHE_FILE" ]; then
  FILTER_METHOD="date_cache"
  LAST_DATE=$(cat "$DATE_CACHE_FILE")
  echo "📅 Date cache found: $LAST_DATE"
else
  echo "⚠️ No cache found. This appears to be the first run."
  echo "⚠️ Will process all posts in $POSTS_FILE"
  FILTER_METHOD="none"
fi


# Step 2: Filter new posts based on cache method
TEMP_POSTS=$(mktemp)

if [ "$FILTER_METHOD" = "url_cache" ]; then
  echo "🔍 Filtering by URL cache..."
  jq -c '
    .[] | 
    select(.stype == 0) |
    select(.PublishedOn != null) |
    select(.BlueSkyPost.Description != null) |
    select(.BlueSkyPost.BskyPost != null)
  ' "$POSTS_FILE" | while IFS= read -r post; do
    URL=$(echo "$post" | jq -r '.BlueSkyPost.BskyPost' | xargs)
    # Check if URL is NOT in cache
    if ! grep -Fxq "$URL" "$URL_CACHE_FILE" 2>/dev/null; then
      echo "$post"
    fi
  done > "$TEMP_POSTS"
  
elif [ "$FILTER_METHOD" = "date_cache" ]; then
  echo "🔍 Filtering by date cache..."
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
  echo "🔍 No cache - processing all posts..."
  jq -c '
    .[] | 
    select(.stype == 0) |
    select(.PublishedOn != null) |
    select(.BlueSkyPost.Description != null) |
    select(.BlueSkyPost.BskyPost != null)
  ' "$POSTS_FILE" > "$TEMP_POSTS"
fi


# Step 3: Sort posts by date (oldest first) for chronological sending
TEMP_SORTED=$(mktemp)
jq -s 'sort_by(.PublishedOn)' "$TEMP_POSTS" | jq -c '.[]' > "$TEMP_SORTED"
mv "$TEMP_SORTED" "$TEMP_POSTS"

# Count new posts
NEW_COUNT=$(wc -l < "$TEMP_POSTS" | tr -d ' ')
echo "📊 New posts found: $NEW_COUNT"

if [ "$NEW_COUNT" -eq 0 ]; then
  echo "✅ No new posts to send"
  rm -f "$TEMP_POSTS"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "has_new_posts=false" >> "$GITHUB_OUTPUT"
  fi
  exit 0
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "has_new_posts=true" >> "$GITHUB_OUTPUT"
  echo "posts_count=$NEW_COUNT" >> "$GITHUB_OUTPUT"
fi

# Function to send message to Telegram with retry logic for rate limits
send_to_telegram() {
  local message="$1"
  local max_retries=3
  local retry_count=0
  
  while [ $retry_count -lt $max_retries ]; do
    RESPONSE=$(curl -s -X POST \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${message}" \
      -d "disable_web_page_preview=false")
    
    # Check if request was successful
    if echo "$RESPONSE" | jq -e '.ok' >/dev/null 2>&1; then
      echo "success"
      return 0
    fi
    
    # Check if it's a rate limit error (429)
    ERROR_CODE=$(echo "$RESPONSE" | jq -r '.error_code // empty')
    if [ "$ERROR_CODE" = "429" ]; then
      RETRY_AFTER=$(echo "$RESPONSE" | jq -r '.parameters.retry_after // 10')
      retry_count=$((retry_count + 1))
      
      if [ $retry_count -lt $max_retries ]; then
        echo "⏳ Rate limit hit. Waiting ${RETRY_AFTER}s before retry ${retry_count}/${max_retries}..."
        sleep "$RETRY_AFTER"
      else
        echo "❌ Max retries reached after rate limit"
        echo "$RESPONSE"
        return 1
      fi
    else
      # Other error, don't retry
      echo "$RESPONSE"
      return 1
    fi
  done
  
  return 1
}

# Step 4: Send posts to Telegram (in chronological order)
echo "📤 Sending posts to Telegram..."

LATEST_DATE=""
SENT_COUNT=0
SENT_URLS=$(mktemp)

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
      echo "✅ Sent: ${DESCRIPTION:0:50}..."
      SENT_COUNT=$((SENT_COUNT + 1))
      
      # Save URL to sent list
      echo "$URL" >> "$SENT_URLS"
      
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
      echo "Response: $SEND_RESULT"
    fi
  else
    echo "⚠️ DRY RUN: ${DESCRIPTION:0:50}..."
    SENT_COUNT=$((SENT_COUNT + 1))
    
    # Save URL to sent list (dry run)
    echo "$URL" >> "$SENT_URLS"
    
    # Note: String comparison with '>' works correctly for ISO 8601 formatted dates
    # because they are lexicographically sortable (YYYY-MM-DDTHH:MM:SSZ)
    if [ -z "$LATEST_DATE" ] || [[ "$POST_DATE" > "$LATEST_DATE" ]]; then
      LATEST_DATE="$POST_DATE"
    fi
  fi
done < "$TEMP_POSTS"

echo "📊 Posts sent: $SENT_COUNT of $NEW_COUNT"

# Step 5: Update caches
if [ "$SENT_COUNT" -gt 0 ]; then
  # Update date cache with the date of the last sent post
  if [ -n "$LATEST_DATE" ]; then
    echo "$LATEST_DATE" > "$DATE_CACHE_FILE"
    echo "💾 Date cache updated: $LATEST_DATE"
  fi
  
  # Update URL cache (keep last 20 URLs)
  if [ -f "$URL_CACHE_FILE" ]; then
    # Merge old cache with new URLs, keep last MAX_CACHE_URLS unique entries
    cat "$URL_CACHE_FILE" "$SENT_URLS" | tail -n "$MAX_CACHE_URLS" > "${URL_CACHE_FILE}.tmp"
    mv "${URL_CACHE_FILE}.tmp" "$URL_CACHE_FILE"
  else
    # Create new cache with sent URLs (up to MAX_CACHE_URLS)
    tail -n "$MAX_CACHE_URLS" "$SENT_URLS" > "$URL_CACHE_FILE"
  fi
  
  CACHE_SIZE=$(wc -l < "$URL_CACHE_FILE" | tr -d ' ')
  echo "💾 URL cache updated: $CACHE_SIZE entries"
fi

# Clean up temporary files
rm -f "$TEMP_POSTS" "$SENT_URLS"

echo "✅ Process completed"
