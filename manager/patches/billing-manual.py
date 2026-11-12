#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: manual billing and receipts in "Plano e limites" > Cobrança (X).

The panel already has a "Cobrança" tab (cobranca-exportacao.py) that draws four cards with an empty history. This
patch keeps the tab and the React component but marks its panel with `data-wa-billing`, so the new static script
(manager/dist/assets/billing-manual.js) can replace the old cards with the real, manual history: entries, totals,
"Novo lançamento", edit/delete for the administrator, and the printable receipt for paid entries. The CSS
(billing-manual.css) hides the old children and styles the new UI with the var(--m-*) tokens only.

Groups:
  1. bundle - adds `data-wa-billing` to the tab panel (the anchor is the existing wc-panel div).
  2. html   - links billing-manual.css and loads billing-manual.js before the bundle; raises the bundle ?v= to the
              next number. The version is computed from the current index.html, so this patch can be applied after
              any other panel patch without hard-coding a version that may already be in use.

Idempotent: the marker in the bundle and the comment in index.html make re-running a no-op. Every anchor must match
exactly once, otherwise nothing is written.

Usage (from the repository root):
  python3 -I manager/patches/billing-manual.py           # apply
  python3 -I manager/patches/billing-manual.py --check   # exit 1 unless applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
ASSETS = os.path.join(ROOT, 'manager', 'dist', 'assets')
ASSET_VERSION = '1'
MIN_CACHE_VERSION = 78
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
ANCHOR = "className:'wc-panel',role:'tabpanel',id:'wc-panel-cobranca'"
MARKER = '/*whatsai-patch:billing-manual:component*/'
HTML_MARKER = '<!-- whatsai-patch:billing-manual:html -->'
MODULE_ANCHOR = '    <script type="module" crossorigin src="/assets/index-b29a5d7a.js'
CSS_TAG = '<link rel="stylesheet" href="/assets/billing-manual.css?v=' + ASSET_VERSION + '" />'
JS_TAG = '<script src="/assets/billing-manual.js?v=' + ASSET_VERSION + '"></script>'


class PatchError(Exception):
    pass


def patch_bundle(text):
    if MARKER in text:
        return text
    if text.count(ANCHOR) != 1:
        raise PatchError('bundle: Cobrança panel anchor expected once')
    return MARKER + '\n' + text.replace(ANCHOR, ANCHOR + ",'data-wa-billing':''", 1)


def current_bundle_version(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag expected once')
    start = pos + len(SCRIPT_TAG)
    end = start
    while end < len(html) and html[end].isdigit():
        end += 1
    current = html[start:end]
    if not current:
        raise PatchError('index.html: bundle ?v= not found')
    return int(current)


def patch_index(html):
    if HTML_MARKER in html:
        return html
    for name in ('billing-manual.css', 'billing-manual.js'):
        if '/assets/' + name in html:
            raise PatchError(f'index.html: {name} present without the marker; remove it first')
    if html.count(MODULE_ANCHOR) != 1:
        raise PatchError('index.html: module script line expected once')
    version = max(current_bundle_version(html), MIN_CACHE_VERSION) + 1
    pos = html.find(SCRIPT_TAG) + len(SCRIPT_TAG)
    end = pos
    while end < len(html) and html[end].isdigit():
        end += 1
    html = html[:pos] + str(version) + html[end:]
    tags = '    ' + CSS_TAG + '\n    ' + JS_TAG + '\n    ' + HTML_MARKER + '\n'
    return html.replace(MODULE_ANCHOR, tags + MODULE_ANCHOR, 1)


def main():
    check = '--check' in sys.argv[1:]
    for name in ('billing-manual.js', 'billing-manual.css'):
        if not os.path.isfile(os.path.join(ASSETS, name)):
            raise PatchError(f'assets/{name} is missing')
    bundle = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    new_bundle = patch_bundle(bundle)
    new_html = patch_index(html)
    applied = new_bundle == bundle and new_html == html
    if check:
        print('ok: billing-manual applied' if applied else 'missing: bundle or index.html')
        return 0 if applied else 1
    if new_bundle != bundle:
        open(BUNDLE, 'w', encoding='utf-8').write(new_bundle)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    print(f'bundle marked, billing-manual.css/js ?v={ASSET_VERSION}, bundle ?v={current_bundle_version(new_html)}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
