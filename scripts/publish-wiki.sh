#!/usr/bin/env bash
# Publish docs/wiki/*.md to the repository's GitHub wiki.
#
# The wiki is a separate git repository (<repo>.wiki.git). GitHub creates it when
# the first page is saved in the web UI, so enable the wiki (Settings → Features →
# Wikis) and save any page once before the first run.
#
# Usage: scripts/publish-wiki.sh [owner/repo]   (default: saketnayak/trading-command-center)
set -euo pipefail

REPO="${1:-saketnayak/trading-command-center}"
SRC="$(cd "$(dirname "$0")/.." && pwd)/docs/wiki"
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT

git clone --depth 1 "https://github.com/${REPO}.wiki.git" "$WORK/wiki"

for f in "$SRC"/*.md; do
  name="$(basename "$f")"
  [ "$name" = "README.md" ] && continue  # instructions for this folder, not a wiki page
  # Wiki links have no .md suffix: (Getting-Started.md) → (Getting-Started), keeping #anchors.
  sed -E 's/\]\(([A-Za-z0-9_-]+)\.md(#[^)]*)?\)/](\1\2)/g' "$f" > "$WORK/wiki/$name"
done

cd "$WORK/wiki"
git add -A
if git diff --cached --quiet; then
  echo "The wiki is already up to date."
  exit 0
fi
git commit -m "Update wiki from docs/wiki ($(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo local))"
git push
echo "Published to https://github.com/${REPO}/wiki"
