#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: Cobrança, recibos and data export in "Plano e limites" (proposal X).

The UI lives in two static assets, not in the bundle: manager/dist/assets/billing.js renders the "Cobrança" card
(and, for the administrator, "Exportar dados da instância") into the page that the bundle draws (main.wu-page), and
billing.css styles it, the dialogs and the printable receipt. This script only wires them into index.html:

1. html - links /assets/billing.css and loads /assets/billing.js (before the bundle) and raises the bundle ?v= to
          CACHE_VERSION, so browsers with the old panel cached pick up the new index.

API: GET/POST/PATCH/DELETE /billing/:instance and GET /billing/:instance/export.zip (src/api/routes/billing.router.ts).

Re-running is safe. Order: after first-run.py.

Usage (from the repository root):
  python3 -I manager/patches/billing-ui.py           # apply
  python3 -I manager/patches/billing-ui.py --check   # exit 1 unless applied
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
ASSETS = os.path.join(ROOT, 'manager', 'dist', 'assets')
CACHE_VERSION = '52'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
ASSET_VERSION = '1'
CSS_TAG = '<link rel="stylesheet" href="/assets/billing.css?v=' + ASSET_VERSION + '" />'
JS_TAG = '<script src="/assets/billing.js?v=' + ASSET_VERSION + '"></script>'


class PatchError(Exception):
    pass


def patch_index(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag expected once')
    start = pos + len(SCRIPT_TAG)
    end = start
    while end < len(html) and html[end].isdigit():
        end += 1
    current = html[start:end]
    if not current or int(current) < int(CACHE_VERSION):
        html = html[:start] + CACHE_VERSION + html[end:]
    for tag, name in ((CSS_TAG, 'billing.css'), (JS_TAG, 'billing.js')):
        if tag in html:
            continue
        if '/assets/' + name in html:
            raise PatchError(f'index.html: {name} present with another version; edit ASSET_VERSION')
        anchor = '    <script type="module" crossorigin src="/assets/index-b29a5d7a.js'
        if html.count(anchor) != 1:
            raise PatchError('index.html: module script line expected once')
        html = html.replace(anchor, '    ' + tag + '\n' + anchor, 1)
    return html


def main():
    check = '--check' in sys.argv[1:]
    for name in ('billing.js', 'billing.css'):
        if not os.path.isfile(os.path.join(ASSETS, name)):
            raise PatchError(f'assets/{name} is missing')
    html = open(INDEX, encoding='utf-8').read()
    new_html = patch_index(html)
    if check:
        print('ok: billing-ui applied' if new_html == html else 'missing: index.html')
        return 0 if new_html == html else 1
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    print(f'index.html: billing.css and billing.js ?v={ASSET_VERSION}, bundle ?v={CACHE_VERSION}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
