#!/usr/bin/env bash
set -euo pipefail

# detect_social_posts.sh
# Centraliza la detección de posts sociales y produce un NDJSON temporal y filtered JSON.

set -euo pipefail

# Verbose
VERBOSE=${VERBOSE:-0}

# Git diff detection like the workflow
NEW_FILES=$(git diff --name-only --diff-filter=A HEAD~1 HEAD | grep -E '^data/posts_.*\.json$' || true)
MODIFIED_FILES=$(git diff --name-only --diff-filter=M HEAD~1 HEAD | grep -E '^data/posts_.*\.json$' || true)
FILES="$NEW_FILES $MODIFIED_FILES"

if [ -z "$FILES" ]; then
  echo "No new social posts detected"
  echo "has_new_posts=false"
  exit 0
fi

echo "Changed social post files: $FILES"

temp_ndjson=$(mktemp)
for file in $FILES; do
  echo "Processing $file"
  jq -c '.[] | select(.stype == 0) | select(.PublishedOn != null and .BlueSkyPost.Description != null and .BlueSkyPost.BskyPost != null)' "$file" >> "$temp_ndjson"
done

# Filter against Telegram
filtered_json=$(mktemp)
chmod +x scripts/notify/filter_posts_against_telegram.sh
VERBOSE=$VERBOSE scripts/notify/filter_posts_against_telegram.sh "$temp_ndjson" "$filtered_json"

# Print summary outputs for workflow
count=$(jq length "$filtered_json" 2>/dev/null || echo 0)
if [ "$count" -gt 0 ]; then
  echo "has_new_posts=true"
  echo "posts_count=$count"
else
  echo "has_new_posts=false"
fi

# Copy filtered file to artifacts location
cp "$filtered_json" ./filtered_posts.json

# Cleanup
rm -f "$temp_ndjson" "$filtered_json"

exit 0
