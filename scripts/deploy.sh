#!/usr/bin/env bash
# Deploy the Vite build to the saveshare repo root (GH Pages serves master root)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Building..."
npm run build

echo "→ Copying dist to repo root for GH Pages..."
rm -rf assets
cp -r dist/assets ./assets 2>/dev/null || true
cp dist/index.html ./index.html

echo "→ Committing and pushing..."
git add -A
git commit -m "deploy: v3 redesign Phaser build $(date +%Y-%m-%d)" || echo "Nothing to commit"
git push origin master

echo "✅ Deployed. Give GH Pages ~1-2 min to rebuild."
