#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: one visual system for every screen (proposal L).

The panel mixed the Evolution original sizes with the ones of the newer pages: page titles of 20 or 24px, buttons
with 8 different heights, 3 radii, 3 card radii and content columns starting at x=308, 325, 397 or 465.

1. html - links /assets/design-system.css as the last stylesheet (after every existing stylesheet and right before
          the bundle module script) and raises the bundle ?v= to CACHE_VERSION when it is lower.

The rules themselves live in manager/dist/assets/design-system.css (written by hand): tokens for radius/control/
content, page titles 20/28, a 1040px content column, 32/28px controls under @media (pointer: fine), 32/28px fields,
8px cards and 22px/4px chips. Conversas, Agenda, Planilha and Instâncias keep the full width.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: when the marker and the stylesheet are already in index.html, nothing is written.
Order: after every other stylesheet patch; the link goes right before the bundle module script, so it stays last
even when a page adds its own stylesheet later in the head.

Usage (from the repository root):
  python3 -I manager/patches/design-system.py           # apply
  python3 -I manager/patches/design-system.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'design-system.css')
CACHE_VERSION = '62'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_VERSION = '1'
CSS_TAG = '<link rel="stylesheet" href="/assets/design-system.css?v=' + CSS_VERSION + '" />'
HTML_MARKER = '<!-- whatsai-patch:design-system:html -->'


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
    if CSS_TAG not in html:
        if '/assets/design-system.css' in html:
            raise PatchError('index.html: design-system.css present with another version; edit CSS_VERSION')
        anchor = '    <script type="module" crossorigin src="/assets/index-b29a5d7a.js'
        if html.count(anchor) != 1:
            raise PatchError('index.html: bundle module script line expected once')
        html = html.replace(anchor, '    ' + HTML_MARKER + '\n    ' + CSS_TAG + '\n' + anchor, 1)
    return html


def main():
    check = '--check' in sys.argv[1:]
    html = open(INDEX, encoding='utf-8').read()
    missing = []
    if HTML_MARKER not in html or CSS_TAG not in html:
        missing.append('html')
    if patch_index(html) != html:
        missing.append('index.html')
    if not os.path.exists(CSS):
        missing.append('design-system.css')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    new_html = patch_index(html)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    pos = new_html.find(SCRIPT_TAG) + len(SCRIPT_TAG)
    end = pos
    while end < len(new_html) and new_html[end].isdigit():
        end += 1
    print(f'index.html: bundle ?v={new_html[pos:end]}, design-system.css ?v={CSS_VERSION}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
