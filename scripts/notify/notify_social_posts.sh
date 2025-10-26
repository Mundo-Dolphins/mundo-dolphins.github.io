#!/usr/bin/env bash#!/usr/bin/env bash

set -euo pipefailset -euo pipefail



# notify_social_posts.sh# notify_social_posts.sh

# Sends new social posts from data/posts_1.json to Telegram# Main script that detects and sends new social posts to Telegram

## Criteria:

# Logic:# 1. Read only data/posts_1.json (most recent posts chronologically)

# 1. Check cache for last successful send date# 2. Filter posts using cache of last 20 sent URLs (.github/notifications/sent_urls_cache.txt)

# 2. If cache exists: send posts newer than cached date# 3. If no cache exists, filter by date using last_post_date.txt from previous successful run

# 3. If no cache: get posts added in last git commit to avoid spam# 4. After sending, update cache with sent URLs (keep last 20)

# 4. Sort posts chronologically (oldest first) before sending

# 5. Retry on Telegram rate limits (429 errors)DATE_CACHE_FILE=".github/notifications/last_post_date.txt"

# 6. Update cache with latest post date after successful sendsURL_CACHE_FILE=".github/notifications/sent_urls_cache.txt"

POSTS_FILE="data/posts_1.json"

CACHE_FILE=".github/notifications/last_post_date.txt"MAX_CACHE_URLS=20

POSTS_FILE="data/posts_1.json"

# Verify posts file exists

# Verify posts file existsif [ ! -f "$POSTS_FILE" ]; then

if [ ! -f "$POSTS_FILE" ]; then  echo "❌ Posts file not found: $POSTS_FILE"

  echo "❌ Posts file not found: $POSTS_FILE"  exit 1

  exit 1fi

fi

# Create notifications directory if it doesn't exist

# Create notifications directory if it doesn't existmkdir -p .github/notifications

mkdir -p .github/notifications

echo "📋 Reading posts from $POSTS_FILE"

echo "📋 Reading posts from $POSTS_FILE"

# Step 1: Determine filtering method

# Function to send message to Telegram with retry logic for rate limitsFILTER_METHOD=""

send_to_telegram() {LAST_DATE=""

  local message="$1"

  local max_retries=3if [ -f "$URL_CACHE_FILE" ] && [ -s "$URL_CACHE_FILE" ]; then

  local retry_count=0  FILTER_METHOD="url_cache"

    CACHE_COUNT=$(wc -l < "$URL_CACHE_FILE" | tr -d ' ')

  while [ $retry_count -lt $max_retries ]; do  echo "📦 URL cache found with $CACHE_COUNT entries"

    RESPONSE=$(curl -s -X POST \elif [ -f "$DATE_CACHE_FILE" ] && [ -s "$DATE_CACHE_FILE" ]; then

      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \  FILTER_METHOD="date_cache"

      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \  LAST_DATE=$(cat "$DATE_CACHE_FILE")

      --data-urlencode "text=${message}" \  echo "📅 Date cache found: $LAST_DATE"

      -d "disable_web_page_preview=false")else

      echo "⚠️ No cache found. This appears to be the first run."

    # Check if request was successful  echo "⚠️ Will process all posts in $POSTS_FILE"

    if echo "$RESPONSE" | jq -e '.ok' >/dev/null 2>&1; then  FILTER_METHOD="none"

      echo "success"fi

      return 0

    fi

    # Step 2: Filter new posts based on cache method

    # Check if it's a rate limit error (429)TEMP_POSTS=$(mktemp)

    ERROR_CODE=$(echo "$RESPONSE" | jq -r '.error_code // empty')

    if [ "$ERROR_CODE" = "429" ]; thenif [ "$FILTER_METHOD" = "url_cache" ]; then

      RETRY_AFTER=$(echo "$RESPONSE" | jq -r '.parameters.retry_after // 10')  echo "🔍 Filtering by URL cache..."

      retry_count=$((retry_count + 1))  jq -c '

          .[] | 

      if [ $retry_count -lt $max_retries ]; then    select(.stype == 0) |

        echo "⏳ Rate limit hit. Waiting ${RETRY_AFTER}s before retry ${retry_count}/${max_retries}..." >&2    select(.PublishedOn != null) |

        sleep "$RETRY_AFTER"    select(.BlueSkyPost.Description != null) |

      else    select(.BlueSkyPost.BskyPost != null)

        echo "❌ Max retries reached after rate limit" >&2  ' "$POSTS_FILE" | while IFS= read -r post; do

        echo "$RESPONSE"    URL=$(echo "$post" | jq -r '.BlueSkyPost.BskyPost' | xargs)

        return 1    # Check if URL is NOT in cache

      fi    if ! grep -Fxq "$URL" "$URL_CACHE_FILE" 2>/dev/null; then

    else      echo "$post"

      # Other error, don't retry    fi

      echo "$RESPONSE"  done > "$TEMP_POSTS"

      return 1  

    fielif [ "$FILTER_METHOD" = "date_cache" ]; then

  done  echo "🔍 Filtering by date cache..."

    # Note: String comparison with '>' works correctly for ISO 8601 formatted dates

  return 1  # because they are lexicographically sortable (YYYY-MM-DDTHH:MM:SSZ)

}  jq -c --arg last_date "$LAST_DATE" '

    .[] | 

# Function to get posts added in last commit    select(.stype == 0) |

get_posts_from_last_commit() {    select(.PublishedOn != null) |

  echo "📜 No cache found. Getting posts from last commit to avoid spam..." >&2    select(.BlueSkyPost.Description != null) |

      select(.BlueSkyPost.BskyPost != null) |

  # Get the JSON content from the last commit that modified posts_1.json    select(.PublishedOn > $last_date)

  LAST_COMMIT_JSON=$(git show HEAD:"$POSTS_FILE" 2>/dev/null || echo "[]")  ' "$POSTS_FILE" > "$TEMP_POSTS"

  CURRENT_JSON=$(cat "$POSTS_FILE")  

  else

  # Create temp files for comparison  echo "🔍 No cache - processing all posts..."

  TEMP_LAST=$(mktemp)  jq -c '

  TEMP_CURRENT=$(mktemp)    .[] | 

      select(.stype == 0) |

  # Extract URLs from both versions    select(.PublishedOn != null) |

  echo "$LAST_COMMIT_JSON" | jq -r '.[] | select(.stype == 0) | select(.BlueSkyPost.BskyPost != null) | .BlueSkyPost.BskyPost' | sort > "$TEMP_LAST"    select(.BlueSkyPost.Description != null) |

  echo "$CURRENT_JSON" | jq -r '.[] | select(.stype == 0) | select(.BlueSkyPost.BskyPost != null) | .BlueSkyPost.BskyPost' | sort > "$TEMP_CURRENT"    select(.BlueSkyPost.BskyPost != null)

    ' "$POSTS_FILE" > "$TEMP_POSTS"

  # Get URLs that are in current but not in last commit (newly added)fi

  NEW_URLS=$(comm -13 "$TEMP_LAST" "$TEMP_CURRENT")

  

  rm -f "$TEMP_LAST" "$TEMP_CURRENT"# Step 3: Sort posts by date (oldest first) for chronological sending

  TEMP_SORTED=$(mktemp)

  if [ -z "$NEW_URLS" ]; thenjq -s 'sort_by(.PublishedOn)' "$TEMP_POSTS" | jq -c '.[]' > "$TEMP_SORTED"

    echo "[]"mv "$TEMP_SORTED" "$TEMP_POSTS"

    return

  fi# Count new posts

  NEW_COUNT=$(wc -l < "$TEMP_POSTS" | tr -d ' ')

  # Get full post objects for new URLsecho "📊 New posts found: $NEW_COUNT"

  echo "$CURRENT_JSON" | jq -c --arg urls "$NEW_URLS" '

    [ .[] | if [ "$NEW_COUNT" -eq 0 ]; then

      select(.stype == 0) |  echo "✅ No new posts to send"

      select(.PublishedOn != null) |  rm -f "$TEMP_POSTS"

      select(.BlueSkyPost.Description != null) |  if [ -n "${GITHUB_OUTPUT:-}" ]; then

      select(.BlueSkyPost.BskyPost != null) |    echo "has_new_posts=false" >> "$GITHUB_OUTPUT"

      select(  fi

        (.BlueSkyPost.BskyPost as $url) |   exit 0

        ($urls | split("\n") | any(. == $url))fi

      )

    ]if [ -n "${GITHUB_OUTPUT:-}" ]; then

  '  echo "has_new_posts=true" >> "$GITHUB_OUTPUT"

}  echo "posts_count=$NEW_COUNT" >> "$GITHUB_OUTPUT"

fi

# Step 1: Determine which posts to send

TEMP_POSTS=$(mktemp)# Function to send message to Telegram with retry logic for rate limits

send_to_telegram() {

if [ -f "$CACHE_FILE" ] && [ -s "$CACHE_FILE" ]; then  local message="$1"

  # Cache exists: filter by date  local max_retries=3

  LAST_DATE=$(cat "$CACHE_FILE")  local retry_count=0

  echo "📅 Last successful send: $LAST_DATE"  

  echo "🔍 Filtering posts newer than $LAST_DATE..."  while [ $retry_count -lt $max_retries ]; do

      RESPONSE=$(curl -s -X POST \

  jq -c --arg last_date "$LAST_DATE" '      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \

    [ .[] |       --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \

      select(.stype == 0) |      --data-urlencode "text=${message}" \

      select(.PublishedOn != null) |      -d "disable_web_page_preview=false")

      select(.BlueSkyPost.Description != null) |    

      select(.BlueSkyPost.BskyPost != null) |    # Check if request was successful

      select(.PublishedOn > $last_date)    if echo "$RESPONSE" | jq -e '.ok' >/dev/null 2>&1; then

    ]      echo "success"

  ' "$POSTS_FILE" > "$TEMP_POSTS"      return 0

else    fi

  # No cache: get posts from last commit    

  get_posts_from_last_commit > "$TEMP_POSTS"    # Check if it's a rate limit error (429)

fi    ERROR_CODE=$(echo "$RESPONSE" | jq -r '.error_code // empty')

    if [ "$ERROR_CODE" = "429" ]; then

# Step 2: Sort posts chronologically (oldest first)      RETRY_AFTER=$(echo "$RESPONSE" | jq -r '.parameters.retry_after // 10')

TEMP_SORTED=$(mktemp)      retry_count=$((retry_count + 1))

jq 'sort_by(.PublishedOn)' "$TEMP_POSTS" > "$TEMP_SORTED"      

mv "$TEMP_SORTED" "$TEMP_POSTS"      if [ $retry_count -lt $max_retries ]; then

        echo "⏳ Rate limit hit. Waiting ${RETRY_AFTER}s before retry ${retry_count}/${max_retries}..."

# Count posts to send        sleep "$RETRY_AFTER"

NEW_COUNT=$(jq 'length' "$TEMP_POSTS")      else

echo "📊 Posts to send: $NEW_COUNT"        echo "❌ Max retries reached after rate limit"

        echo "$RESPONSE"

if [ "$NEW_COUNT" -eq 0 ]; then        return 1

  echo "✅ No new posts to send"      fi

  rm -f "$TEMP_POSTS"    else

  if [ -n "${GITHUB_OUTPUT:-}" ]; then      # Other error, don't retry

    echo "has_new_posts=false" >> "$GITHUB_OUTPUT"      echo "$RESPONSE"

  fi      return 1

  exit 0    fi

fi  done

  

if [ -n "${GITHUB_OUTPUT:-}" ]; then  return 1

  echo "has_new_posts=true" >> "$GITHUB_OUTPUT"}

  echo "posts_count=$NEW_COUNT" >> "$GITHUB_OUTPUT"

fi# Step 4: Send posts to Telegram (in chronological order)

echo "📤 Sending posts to Telegram..."

# Step 3: Send posts to Telegram (in chronological order)

echo "📤 Sending $NEW_COUNT posts to Telegram..."LATEST_DATE=""

SENT_COUNT=0

LATEST_DATE=""SENT_URLS=$(mktemp)

SENT_COUNT=0

while IFS= read -r post; do

jq -c '.[]' "$TEMP_POSTS" | while IFS= read -r post; do  DESCRIPTION=$(echo "$post" | jq -r '.BlueSkyPost.Description')

  DESCRIPTION=$(echo "$post" | jq -r '.BlueSkyPost.Description')  URL=$(echo "$post" | jq -r '.BlueSkyPost.BskyPost')

  URL=$(echo "$post" | jq -r '.BlueSkyPost.BskyPost')  POST_DATE=$(echo "$post" | jq -r '.PublishedOn')

  POST_DATE=$(echo "$post" | jq -r '.PublishedOn')  

    # Build message

  # Build message  MESSAGE="🐬 ${DESCRIPTION}

  MESSAGE="🐬 ${DESCRIPTION}

🔗 ${URL}"

🔗 ${URL}"  

    # Send to Telegram

  # Send to Telegram (or dry run)  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then

  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then    SEND_RESULT=$(send_to_telegram "$MESSAGE")

    SEND_RESULT=$(send_to_telegram "$MESSAGE")    

        if [ "$SEND_RESULT" = "success" ]; then

    if [ "$SEND_RESULT" = "success" ]; then      echo "✅ Sent: ${DESCRIPTION:0:50}..."

      echo "✅ Sent: ${DESCRIPTION:0:50}... (${POST_DATE})"      SENT_COUNT=$((SENT_COUNT + 1))

      SENT_COUNT=$((SENT_COUNT + 1))      

      LATEST_DATE="$POST_DATE"      # Save URL to sent list

            echo "$URL" >> "$SENT_URLS"

      # Small pause between messages      

      sleep 2      # Update latest date

    else      # Note: String comparison with '>' works correctly for ISO 8601 formatted dates

      echo "❌ Error sending: ${DESCRIPTION:0:50}..."      # because they are lexicographically sortable (YYYY-MM-DDTHH:MM:SSZ)

      echo "Response: $SEND_RESULT"      if [ -z "$LATEST_DATE" ] || [[ "$POST_DATE" > "$LATEST_DATE" ]]; then

      # Don't update cache if send failed        LATEST_DATE="$POST_DATE"

    fi      fi

  else      

    echo "⚠️ DRY RUN: ${DESCRIPTION:0:50}... (${POST_DATE})"      # Small pause between messages

    SENT_COUNT=$((SENT_COUNT + 1))      sleep 2

    LATEST_DATE="$POST_DATE"    else

  fi      echo "❌ Error sending: ${DESCRIPTION:0:50}..."

done      echo "Response: $SEND_RESULT"

    fi

echo "📊 Posts sent: $SENT_COUNT of $NEW_COUNT"  else

    echo "⚠️ DRY RUN: ${DESCRIPTION:0:50}..."

# Step 4: Update cache with latest post date (only if we sent something)    SENT_COUNT=$((SENT_COUNT + 1))

if [ -n "$LATEST_DATE" ] && [ "$SENT_COUNT" -gt 0 ]; then    

  echo "$LATEST_DATE" > "$CACHE_FILE"    # Save URL to sent list (dry run)

  echo "💾 Cache updated with date: $LATEST_DATE"    echo "$URL" >> "$SENT_URLS"

fi    

    # Note: String comparison with '>' works correctly for ISO 8601 formatted dates

# Clean up    # because they are lexicographically sortable (YYYY-MM-DDTHH:MM:SSZ)

rm -f "$TEMP_POSTS"    if [ -z "$LATEST_DATE" ] || [[ "$POST_DATE" > "$LATEST_DATE" ]]; then

      LATEST_DATE="$POST_DATE"

echo "✅ Process completed"    fi

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
