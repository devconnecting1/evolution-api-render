#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager bundle: provider cards of "Observabilidade" in 2 columns.

Same method as the other scripts in manager/patches: exact string replacements on the minified bundle.
The provider grid went from 3 columns on large screens (lg:grid-cols-3) to at most 2 (md:grid-cols-2), so the
cards are wider and read as a 2x2 grid; on phones they stay in a single column.
Applying also bumps the bundle ?v= in index.html to CACHE_VERSION (only raised, never lowered).

The anchor must match exactly once, otherwise the script stops without writing anything. Re-running is safe.
Order: run after observability-ui.py and observability-alerts.py.

Usage (from the repository root):
  python3 -I manager/patches/observability-grid.py           # apply
  python3 -I manager/patches/observability-grid.py --check   # exit 1 unless applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CACHE_VERSION = '13'
MARKER = '/*whatsai-patch:observability-grid:v1*/'
REQUIRED = ('/*whatsai-patch:observability-ui:v1*/',)

OLD = "i.jsx('div',{className:'grid gap-6 md:grid-cols-2 lg:grid-cols-3',children:providers.map("
NEW = "i.jsx('div',{className:'grid gap-6 md:grid-cols-2',children:providers.map("


class PatchError(Exception):
    pass


def bump_cache(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag not found exactly once')
    end = pos + len(SCRIPT_TAG)
    while end < len(html) and html[end].isdigit():
        end += 1
    current = html[pos + len(SCRIPT_TAG):end]
    if not current.isdigit():
        raise PatchError(f'index.html: unexpected bundle version ?v={current}')
    if int(current) >= int(CACHE_VERSION):
        return html
    return html[:pos + len(SCRIPT_TAG)] + CACHE_VERSION + html[end:]


def main():
    check = '--check' in sys.argv[1:]
    with open(BUNDLE, encoding='utf-8') as f:
        bundle = f.read()
    with open(INDEX, encoding='utf-8') as f:
        html = f.read()

    applied = MARKER in bundle
    cache_ok = bump_cache(html) == html

    if check:
        ok = applied and cache_ok
        print('ok: all groups applied' if ok else 'missing: grid' if not applied else 'missing: index.html cache version')
        return 0 if ok else 1

    for required in REQUIRED:
        if required not in bundle:
            raise PatchError(f'run the patch that adds {required} first')

    if not applied:
        if bundle.count(OLD) != 1:
            raise PatchError(f'grid: expected 1 match, got {bundle.count(OLD)}')
        bundle = MARKER + bundle.replace(OLD, NEW)
        with open(BUNDLE, 'w', encoding='utf-8') as f:
            f.write(bundle)
        print('grid: applied')
    else:
        print('grid: already applied')

    new_html = bump_cache(html)
    if new_html != html:
        with open(INDEX, 'w', encoding='utf-8') as f:
            f.write(new_html)
    print(f'index.html: bundle ?v={CACHE_VERSION}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'error: {error}', file=sys.stderr)
        sys.exit(2)
