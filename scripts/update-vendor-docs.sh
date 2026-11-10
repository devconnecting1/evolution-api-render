#!/usr/bin/env bash
# Atualiza a documentação oficial (formato llms.txt) de Neon, Render e Vercel em docs/vendors/.
# Uso: bash scripts/update-vendor-docs.sh
set -euo pipefail
cd "$(dirname "$0")/.."
declare -A SRC=(
  [neon]="https://neon.com"
  [render]="https://render.com/docs"
  [vercel]="https://vercel.com/docs"
)
for name in "${!SRC[@]}"; do
  base="${SRC[$name]}"
  mkdir -p "docs/vendors/$name"
  for f in llms.txt llms-full.txt; do
    tmp="$(mktemp)"
    curl -fsSL --max-time 300 -o "$tmp" "$base/$f"
    mv "$tmp" "docs/vendors/$name/$f"
  done
  echo "$name: $(du -h "docs/vendors/$name/llms-full.txt" | cut -f1)"
done
date -u +"%Y-%m-%dT%H:%M:%SZ" > docs/vendors/FETCHED_AT
