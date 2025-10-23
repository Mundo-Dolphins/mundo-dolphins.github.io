#!/usr/bin/env bash
set -euo pipefail

echo "🔍 Checking for new articles..."

# Support running locally: if GITHUB_OUTPUT is not set (not in Actions), write outputs to a local file
if [ -z "${GITHUB_OUTPUT:-}" ]; then
  GITHUB_OUTPUT=$(pwd)/.github_output
  echo "(local) writing outputs to $GITHUB_OUTPUT"
fi

# Detect two types of content:
# 1. Markdown articles in content/noticias/ (added/modified .md files)
# 2. Podcast episodes in data/season_*.json files (episodes are added to JSON, not as separate .md files)
NEW_MARKDOWN=$(git diff --name-only --diff-filter=AM HEAD~1 HEAD | grep -E '^content/noticias/.*\.md$' || true)
NEW_SEASON_FILES=$(git diff --name-only --diff-filter=AM HEAD~1 HEAD | grep -E '^data/season_.*\.json$' || true)

echo "🔍 Files detected by git diff:"
git diff --name-only --diff-filter=AM HEAD~1 HEAD || echo "No files detected by git diff"

echo "🔍 Filtered markdown files (noticias):"
echo "$NEW_MARKDOWN" || echo "No markdown files found"
echo "🔍 Filtered season JSON files (podcasts):"
echo "$NEW_SEASON_FILES" || echo "No season JSON files found"

if [ -z "$NEW_MARKDOWN" ] && [ -z "$NEW_SEASON_FILES" ]; then
  echo "ℹ️ No new articles or podcast episodes detected"
  echo "has_new_articles=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

ARTICLES_JSON="[]"

# Install yq for robust YAML parsing if missing
if ! command -v yq >/dev/null 2>&1; then
  sudo wget -qO /usr/local/bin/yq https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64
  sudo chmod +x /usr/local/bin/yq
fi

# Process markdown files (noticias)
if [ -n "$NEW_MARKDOWN" ]; then
  echo "🆕 New markdown articles detected:"
  echo "$NEW_MARKDOWN"

  for file in $NEW_MARKDOWN; do
    if [ -f "$file" ]; then
      echo "📄 Processing: $file"
      FRONTMATTER=$(sed -n '/^---$/,/^---$/p' "$file" | sed '1d;$d')
      TITLE=$(echo "$FRONTMATTER" | yq '.title' 2>/dev/null | sed 's/^null$//' || echo "New Article")
      DATE=$(echo "$FRONTMATTER" | yq '.date' 2>/dev/null | sed 's/^null$//' || echo "")
      AUTHOR=$(echo "$FRONTMATTER" | yq '.author' 2>/dev/null | sed 's/^null$//' || echo "Mundo Dolphins")

      FILENAME=$(basename "$file" .md)
      SECTION="noticias"
      URL="https://mundodolphins.es/${SECTION}/${FILENAME}/"

      ARTICLE_JSON=$(jq -n \
        --arg title "$TITLE" \
        --arg url "$URL" \
        --arg author "$AUTHOR" \
        --arg date "$DATE" \
        --arg section "$SECTION" \
        '{title: $title, url: $url, author: $author, date: $date, section: $section}')

      ARTICLES_JSON=$(echo "$ARTICLES_JSON" | jq ". + [$ARTICLE_JSON]")
      echo "✅ Article processed: $TITLE"
      echo "🔗 URL: $URL"
    else
      echo "⚠️ File not found: $file"
    fi
  done
fi

# Process podcast episodes from season JSON files
if [ -n "$NEW_SEASON_FILES" ]; then
  echo "🆕 New podcast episodes detected in season files:"
  echo "$NEW_SEASON_FILES"

  for file in $NEW_SEASON_FILES; do
    if [ -f "$file" ]; then
      echo "📄 Processing: $file"
      CURRENT_EPISODES=$(jq -c '.[]' "$file" 2>/dev/null || echo "")
      PREVIOUS_EPISODES=$(git show HEAD~1:"$file" 2>/dev/null | jq -c '.[]' 2>/dev/null || echo "")
      TEMP_PREV=$(mktemp)
      echo "$PREVIOUS_EPISODES" > "$TEMP_PREV"

      while IFS= read -r episode; do
        if [ -n "$episode" ]; then
          TITLE=$(echo "$episode" | jq -r '.title')
          DATE=$(echo "$episode" | jq -r '.dateAndTime')
          LINK=$(echo "$episode" | jq -r '.link')

          EPISODE_ID="${TITLE}|${DATE}|${LINK}"
          FOUND=""
          while IFS= read -r prev_episode; do
            if [ -n "$prev_episode" ]; then
              PREV_TITLE=$(echo "$prev_episode" | jq -r '.title')
              PREV_DATE=$(echo "$prev_episode" | jq -r '.dateAndTime')
              PREV_LINK=$(echo "$prev_episode" | jq -r '.link')
              PREV_ID="${PREV_TITLE}|${PREV_DATE}|${PREV_LINK}"
              if [ "$EPISODE_ID" = "$PREV_ID" ]; then
                FOUND="yes"
                break
              fi
            fi
          done < "$TEMP_PREV"

          if [ -z "$FOUND" ]; then
            echo "🎙️ New podcast episode found: $TITLE"
            # generate slug via python for robust unicode handling
            SLUG=$(printf '%s' "$TITLE" | python3 -c 'import sys,unicodedata,re; t=sys.stdin.read(); s=unicodedata.normalize("NFKD", t); s=s.encode("ascii","ignore").decode("ascii"); s=re.sub(r"[^a-zA-Z0-9]+","-", s).strip("-").lower(); print(s)')
            PODCAST_URL="https://mundodolphins.es/podcast/${SLUG}/"

            ARTICLE_JSON=$(jq -n \
              --arg title "$TITLE" \
              --arg url "$PODCAST_URL" \
              --arg author "Mundo Dolphins" \
              --arg date "$DATE" \
              --arg section "podcast" \
              '{title: $title, url: $url, author: $author, date: $date, section: $section}')

            ARTICLES_JSON=$(echo "$ARTICLES_JSON" | jq ". + [$ARTICLE_JSON]")
            echo "✅ Podcast episode processed: $TITLE"
            echo "🔗 URL: $PODCAST_URL"
          fi
        fi
      done < <(echo "$CURRENT_EPISODES")

      rm -f "$TEMP_PREV"
    else
      echo "⚠️ File not found: $file"
    fi
  done
fi

ARTICLE_COUNT=$(echo "$ARTICLES_JSON" | jq length)
if [ "$ARTICLE_COUNT" -eq 0 ]; then
  echo "ℹ️ No new content detected after processing"
  echo "has_new_articles=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "has_new_articles=true" >> "$GITHUB_OUTPUT"
echo "articles_count=$ARTICLE_COUNT" >> "$GITHUB_OUTPUT"
echo "$ARTICLES_JSON" > articles.json
echo "📊 Articles JSON content:"
cat articles.json
