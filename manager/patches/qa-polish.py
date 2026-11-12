#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: fixes from the visual/functional audit of 12/11/2026.

The rules live in manager/dist/assets/qa-polish.css and the small behaviors in qa-polish.js. They cover the
high and medium findings that are safe to fix without changing the product structure:

  css - touch targets of the header, the drawer items and the row actions; the tablet breadcrumb/search;
        the mobile tab heights and scroll; inputs at 16 px on phones (no iOS zoom); the notifications/help/command
        palette targets; the instance/key filters; the OAB form in one column; the billing table as cards; the
        credentials table scrollable on tablets; the Atendente IA title/actions wrap at 1024-1279.
  js  - the whole lead card on the board opens the lead page; the mobile drawer traps the keyboard focus while
        it is open and gives it back when it closes.

1. html - links qa-polish.css right before the design-system.css marker (design-system stays the last stylesheet),
          inserts qa-polish.js right before the bundle script, and raises the bundle ?v= to CACHE_VERSION when lower.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: when the markers, the stylesheet and the script are already in index.html, nothing is written.
Order: after design-system.py (uses its marker as the anchor) and after mobile-header-limite.py (so the QA CSS is
the last patch stylesheet before design-system.css).

Usage (from the repository root):
  python3 -I manager/patches/qa-polish.py           # apply
  python3 -I manager/patches/qa-polish.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'qa-polish.css')
JS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'qa-polish.js')
CACHE_VERSION = '71'
SCRIPT_TAG = '<script type="module" crossorigin src="/assets/index-b29a5d7a.js?v='
CSS_TAG = '<link rel="stylesheet" href="/assets/qa-polish.css?v=1" />'
JS_TAG = '<script src="/assets/qa-polish.js?v=1"></script>'
CSS_MARKER = '<!-- whatsai-patch:qa-polish:css -->'
JS_MARKER = '<!-- whatsai-patch:qa-polish:js -->'
DESIGN_MARKER = '<!-- whatsai-patch:design-system:html -->'


class PatchError(Exception):
    pass


def patch_index(html):
    css_done = CSS_TAG in html and CSS_MARKER in html
    js_done = JS_TAG in html and JS_MARKER in html
    if css_done and js_done:
        return html
    if (CSS_TAG in html) != (CSS_MARKER in html):
        raise PatchError('index.html: qa-polish.css linked without its marker')
    if (JS_TAG in html) != (JS_MARKER in html):
        raise PatchError('index.html: qa-polish.js linked without its marker')
    if not css_done:
        if html.count('    ' + DESIGN_MARKER) != 1:
            raise PatchError('index.html: design-system marker expected once (run design-system.py first)')
        block = '    ' + CSS_MARKER + '\n    ' + CSS_TAG + '\n'
        html = html.replace('    ' + DESIGN_MARKER, block + '    ' + DESIGN_MARKER, 1)
    if not js_done:
        anchor = '    ' + SCRIPT_TAG
        if html.count(anchor) != 1:
            raise PatchError('index.html: bundle script tag expected once')
        block = '    ' + JS_MARKER + '\n    ' + JS_TAG + '\n'
        html = html.replace(anchor, block + anchor, 1)
    return html


def bump_index(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag expected once')
    start = pos + len(SCRIPT_TAG)
    end = start
    while end < len(html) and html[end].isdigit():
        end += 1
    current = html[start:end]
    if current and int(current) >= int(CACHE_VERSION):
        return html
    return html[:start] + CACHE_VERSION + html[end:]


def main():
    check = '--check' in sys.argv[1:]
    html = open(INDEX, encoding='utf-8').read()
    missing = []
    if html.count('    ' + DESIGN_MARKER) != 1:
        missing.append('design-system marker (run design-system.py first)')
    if CSS_MARKER not in html or CSS_TAG not in html:
        missing.append('qa-polish.css link')
    if JS_MARKER not in html or JS_TAG not in html:
        missing.append('qa-polish.js script')
    if patch_index(html) != html:
        missing.append('index.html')
    if bump_index(html) != html:
        missing.append('index.html cache version')
    if not os.path.exists(CSS):
        missing.append('qa-polish.css')
    if not os.path.exists(JS):
        missing.append('qa-polish.js')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    new_html = bump_index(patch_index(html))
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    pos = new_html.find(SCRIPT_TAG) + len(SCRIPT_TAG)
    end = pos
    while end < len(new_html) and new_html[end].isdigit():
        end += 1
    print(f'index.html: qa-polish.css and qa-polish.js ?v=1, bundle ?v={new_html[pos:end]}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
