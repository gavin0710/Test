#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

case "${1:-}" in
  collect)
    source_files=(macd-resonance/data/latest.json macd-resonance/data/history-15.json)
    message="data: refresh MACD resonance index bars"
    ;;
  backfill)
    source_files=(macd-resonance/data/history-101.json macd-resonance/data/history-102.json)
    message="data: extend market index daily weekly backfill"
    ;;
  *) echo "Usage: commit-market-update.sh collect|backfill" >&2; exit 2 ;;
esac

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
# Derived JSON must never participate in the source rebase. Another archive
# writer may have published a valid snapshot since this runner checked out.
git restore -- macd-resonance/analysis-data.json
git add "${source_files[@]}"
if ! git diff --cached --quiet; then git commit -m "$message"; fi
git fetch origin master
git rebase origin/master

node macd-resonance/research-success.js --refresh
node macd-resonance/verify-success-analysis.js
git add macd-resonance/analysis-data.json
if ! git diff --cached --quiet; then
  if [ "$(git rev-list --count origin/master..HEAD)" -gt 0 ]; then
    # Amend only a local, unpublished source commit, never an upstream commit.
    git commit --amend --no-edit
  else
    git commit -m "data: refresh MACD success analysis"
  fi
fi
# Source and derived analysis become visible together in this one push.
git push origin HEAD:master
