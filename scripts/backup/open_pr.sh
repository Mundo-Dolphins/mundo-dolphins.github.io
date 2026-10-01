#!/usr/bin/env bash
# Opens or refreshes the backup pull request with the changes in data/.
#
# The branch is recreated from the checked-out main on every run, so the PR
# never conflicts with the Raspberry Pi's PRs. When there is nothing to add
# (the Pi already did it), an open backup PR is closed.
#
# Usage: open_pr.sh <branch> <title> <commit message>
# Requires GH_TOKEN with permission to push and to open pull requests.
set -euo pipefail

branch="$1"
title="$2"
message="$3"

open_pr="$(gh pr list --head "$branch" --state open --json number --jq '.[0].number // empty')"

if git diff --quiet -- data && [ -z "$(git ls-files --others --exclude-standard -- data)" ]; then
  echo "No changes in data/"
  if [ -n "$open_pr" ]; then
    gh pr close "$open_pr" --delete-branch \
      --comment "Closing: main already has these items (added by the Raspberry Pi)."
  fi
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git switch -C "$branch"
git add data
git commit -m "$message"
git push --force origin "$branch"

if [ -z "$open_pr" ]; then
  gh pr create --base main --head "$branch" --title "$title" --label automerge \
    --body "Automated pull request from the GitHub Actions backup (\`scripts/backup\`). It only adds items that the Raspberry Pi has not added after the grace period."
else
  echo "Updated pull request #$open_pr"
fi
