#!/usr/bin/env bash
set -euo pipefail

# notify_social_posts.sh
# Sends new social posts from data/posts_1.json to Telegram
#
# Logic:
# 1. Check cache for last successful send date
# 2. If cache exists: send posts newer than cached date
# 3. If no cache: get posts added in last git commit to avoid spam
# 4. Sort posts chronologically (oldest first) before sending
# 5. Retry on Telegram rate limits (429 errors)
# 6. Update cache with latest post date after successful sends

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
        echo "⏳ Rate limit hit. Waiting ${RETRY_AFTER}s before retry ${retry_count}/${max_retries}..." >&2
        sleep "$RETRY_AFTER"
      else
        echo "❌ Max retries reached after rate limit" >&2
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

# Function to get posts added in last commit
get_posts_from_last_commit() {
  echo "📜 No cache found. Getting posts from last commit to avoid spam..." >&2
  
  # Get the JSON content from the last commit that modified posts_1.json
  LAST_COMMIT_JSON=$(git show HEAD:"$POSTS_FILE" 2>/dev/null || echo "[]")
  CURRENT_JSON=$(cat "$POSTS_FILE")
  
  # Create temp files for comparison
  TEMP_LAST=$(mktemp)
  TEMP_CURRENT=$(mktemp)
  
  # Extract URLs from both versions
  echo "$LAST_COMMIT_JSON" | jq -r '.[] | select(.stype == 0) | select(.BlueSkyPost.BskyPost != null) | .BlueSkyPost.BskyPost' | sort > "$TEMP_LAST"
  echo "$CURRENT_JSON" | jq -r '.[] | select(.stype == 0) | select(.BlueSkyPost.BskyPost != null) | .BlueSkyPost.BskyPost' | sort > "$TEMP_CURRENT"
  
  # Get URLs that are in current but not in last commit (newly added)
  NEW_URLS=$(comm -13 "$TEMP_LAST" "$TEMP_CURRENT")
  
  rm -f "$TEMP_LAST" "$TEMP_CURRENT"
  
  if [ -z "$NEW_URLS" ]; then
    echo "[]"
    return
  fi
  
  # Get full post objects for new URLs
  echo "$CURRENT_JSON" | jq -c --arg urls "$NEW_URLS" '
    [ .[] | 
      select(.stype == 0) |
      select(.PublishedOn != null) |
      select(.BlueSkyPost.Description != null) |
      select(.BlueSkyPost.BskyPost != null) |
      select(
        (.BlueSkyPost.BskyPost as $url) | 
        ($urls | split("\n") | any(. == $url))
      )
    ]
  '
}

# Step 1: Determine which posts to send
TEMP_POSTS=$(mktemp)

if [ -f "$CACHE_FILE" ] && [ -s "$CACHE_FILE" ]; then
  # Cache exists: filter by date
  LAST_DATE=$(cat "$CACHE_FILE")
  echo "📅 Last successful send: $LAST_DATE"
  echo "🔍 Filtering posts newer than $LAST_DATE..."
  
  jq -c --arg last_date "$LAST_DATE" '
    [ .[] | 
      select(.stype == 0) |
      select(.PublishedOn != null) |
      select(.BlueSkyPost.Description != null) |
      select(.BlueSkyPost.BskyPost != null) |
      select(.PublishedOn > $last_date)
    ]
  ' "$POSTS_FILE" > "$TEMP_POSTS"
else
  # No cache: get posts from last commit
  get_posts_from_last_commit > "$TEMP_POSTS"
fi

# Step 2: Sort posts chronologically (oldest first)
TEMP_SORTED=$(mktemp)
jq 'sort_by(.PublishedOn)' "$TEMP_POSTS" > "$TEMP_SORTED"
mv "$TEMP_SORTED" "$TEMP_POSTS"

# Count posts to send
NEW_COUNT=$(jq 'length' "$TEMP_POSTS")
echo "📊 Posts to send: $NEW_COUNT"

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

# Step 3: Send posts to Telegram (in chronological order)
echo "📤 Sending $NEW_COUNT posts to Telegram..."

LATEST_DATE=""
SENT_COUNT=0

jq -c '.[]' "$TEMP_POSTS" | while IFS= read -r post; do
  DESCRIPTION=$(echo "$post" | jq -r '.BlueSkyPost.Description')
  URL=$(echo "$post" | jq -r '.BlueSkyPost.BskyPost')
  POST_DATE=$(echo "$post" | jq -r '.PublishedOn')
  
  # Build message
  MESSAGE="🐬 ${DESCRIPTION}

🔗 ${URL}"
  
  # Send to Telegram (or dry run)
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    SEND_RESULT=$(send_to_telegram "$MESSAGE")
    
    if [ "$SEND_RESULT" = "success" ]; then
      echo "✅ Sent: ${DESCRIPTION:0:50}... (${POST_DATE})"
      SENT_COUNT=$((SENT_COUNT + 1))
      LATEST_DATE="$POST_DATE"
      
      # Small pause between messages
      sleep 2
    else
      echo "❌ Error sending: ${DESCRIPTION:0:50}..."
      echo "Response: $SEND_RESULT"
      # Don't update cache if send failed
    fi
  else
    echo "⚠️ DRY RUN: ${DESCRIPTION:0:50}... (${POST_DATE})"
    SENT_COUNT=$((SENT_COUNT + 1))
    LATEST_DATE="$POST_DATE"
  fi
done

echo "📊 Posts sent: $SENT_COUNT of $NEW_COUNT"

# Step 4: Update cache with latest post date (only if we sent something)
if [ -n "$LATEST_DATE" ] && [ "$SENT_COUNT" -gt 0 ]; then
  echo "$LATEST_DATE" > "$CACHE_FILE"
  echo "💾 Cache updated with date: $LATEST_DATE"
fi

# Clean up
rm -f "$TEMP_POSTS"

echo "✅ Process completed"
