# /usr/bin/env bash
# set -euo pipefail

# send_social_to_telegram.sh
# Usage: send_social_to_telegram.sh filtered_posts.json
# Supports DRY_RUN=1 and VERBOSE=1

ARTICLES_FILE="${1:-filtered_posts.json}"
DRY_RUN=${DRY_RUN:-0}
VERBOSE=${VERBOSE:-0}

if [ "$DRY_RUN" != "1" ]; then
  if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
    echo "❌ TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set (or set DRY_RUN=1 for testing)"
    exit 1
  fi
else
  echo "DRY_RUN=1: skipping credential checks"
fi

if [ ! -f "$ARTICLES_FILE" ]; then
  echo "❌ Articles file '$ARTICLES_FILE' not found"
  exit 1
fi

TOTAL=$(jq length "$ARTICLES_FILE")
if [ "$TOTAL" -le 0 ]; then
  echo "No posts to send"
  exit 0
fi

for i in $(seq 0 $((TOTAL - 1))); do
  post=$(jq -r ".[$i]" "$ARTICLES_FILE")
  title=$(echo "$post" | jq -r '.title')
  url=$(echo "$post" | jq -r '.BlueSkyPost.BskyPost // .link // .BskyPost')
  text=$(echo "$post" | jq -r '.BlueSkyPost.Description // empty')

  # Use HTML pre block
  esc=$(echo "$text" | sed 's/&/\&amp;/g' | sed 's/</\&lt;/g' | sed 's/>/\&gt;/g')
  body="<pre>${esc}</pre>%0A%0A🔗 ${url}"

  echo "Sending post $((i+1))/$TOTAL: $title -> $url"

  if [ "$DRY_RUN" = "1" ]; then
    if [ "$VERBOSE" = "1" ]; then
      echo "--- DRY_RUN BODY ---"
      echo "$body"
      echo "--- END BODY ---"
    fi
    continue
  fi

  response=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    -d text="$body" \
    -d parse_mode="HTML")

  ok=$(echo "$response" | jq -r '.ok')
  if [ "$ok" = "true" ]; then
    echo "✅ Sent: $url"
    if [ "$VERBOSE" = "1" ]; then
      echo "$response" | sed -n '1,200p'
    fi
  else
    echo "❌ Failed to send: $url"
    echo "$response"
  fi

  sleep 1

done

exit 0
#!/usr/bin/env bash
set -euo pipefail

# send_social_to_telegram.sh
# Usage: send_social_to_telegram.sh filtered_posts.json
# Supports DRY_RUN=1 and VERBOSE=1

ARTICLES_FILE="${1:-filtered_posts.json}"
DRY_RUN=${DRY_RUN:-0}
VERBOSE=${VERBOSE:-0}

if [ "$DRY_RUN" != "1" ]; then
  if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
    echo "❌ TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set (or set DRY_RUN=1 for testing)"
    exit 1
fi

if [ ! -f "$ARTICLES_FILE" ]; then
  echo "❌ Articles file '$ARTICLES_FILE' not found"
  exit 1
fi

TOTAL=$(jq length "$ARTICLES_FILE")
if [ "$TOTAL" -le 0 ]; then
  echo "No posts to send"
  exit 0
fi

for i in $(seq 0 $((TOTAL - 1))); do
  post=$(jq -r ".[$i]" "$ARTICLES_FILE")
  #!/usr/bin/env bash
  set -euo pipefail

  # send_social_to_telegram.sh
  # Usage: send_social_to_telegram.sh filtered_posts.json
  # Supports DRY_RUN=1 and VERBOSE=1

  ARTICLES_FILE="${1:-filtered_posts.json}"
  DRY_RUN=${DRY_RUN:-0}
  VERBOSE=${VERBOSE:-0}

  if [ "$DRY_RUN" != "1" ]; then
    if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
      echo "❌ TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set (or set DRY_RUN=1 for testing)"
      exit 1
    fi
  else
    echo "DRY_RUN=1: skipping credential checks"
  fi

  if [ ! -f "$ARTICLES_FILE" ]; then
    echo "❌ Articles file '$ARTICLES_FILE' not found"
    exit 1
  fi

  TOTAL=$(jq length "$ARTICLES_FILE")
  if [ "$TOTAL" -le 0 ]; then
    echo "No posts to send"
    exit 0
  fi

  for i in $(seq 0 $((TOTAL - 1))); do
    post=$(jq -r ".[$i]" "$ARTICLES_FILE")
    title=$(echo "$post" | jq -r '.title')
    url=$(echo "$post" | jq -r '.BlueSkyPost.BskyPost // .link // .BskyPost')
    text=$(echo "$post" | jq -r '.BlueSkyPost.Description // empty')

    # Use HTML pre block
    esc=$(echo "$text" | sed 's/&/\&amp;/g' | sed 's/</\&lt;/g' | sed 's/>/\&gt;/g')
    body="<pre>${esc}</pre>%0A%0A🔗 ${url}"

    echo "Sending post $((i+1))/$TOTAL: $title -> $url"

    if [ "$DRY_RUN" = "1" ]; then
      if [ "$VERBOSE" = "1" ]; then
        echo "--- DRY_RUN BODY ---"
        echo "$body"
        echo "--- END BODY ---"
      fi
      continue
    fi

    response=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d chat_id="${TELEGRAM_CHAT_ID}" \
      -d text="$body" \
      -d parse_mode="HTML")

    ok=$(echo "$response" | jq -r '.ok')
    if [ "$ok" = "true" ]; then
      echo "✅ Sent: $url"
      if [ "$VERBOSE" = "1" ]; then
        echo "$response" | sed -n '1,200p'
      fi
    else
      echo "❌ Failed to send: $url"
      echo "$response"
    fi

    sleep 1

  done

  exit 0
done
