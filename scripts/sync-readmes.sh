#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p manager/dist/readmes
cp README-WHATSAI.md manager/dist/readmes/
if [ -d readmes ]; then cp readmes/*.md manager/dist/readmes/ 2>/dev/null || true; fi

python3 - <<'PY'
import glob, json, os, re

items = []
for path in sorted(glob.glob('manager/dist/readmes/*.md')):
    text = open(path, encoding='utf-8').read()
    m = re.search(r'^#\s+(.+)$', text, re.M)
    title = m.group(1).strip() if m else os.path.basename(path)
    if os.path.basename(path) == 'RESUMO.md':
        title = 'Resumo operacional — WhatsAI'
    items.append({'file': os.path.basename(path), 'title': title})

with open('manager/dist/readmes/index.json', 'w', encoding='utf-8') as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print('readmes:', ', '.join(i['file'] for i in items))
PY
