#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: no usage/plan chip in the header on phones.

Before: below 640 px the header chip (dot + "12 / 2.000") kept showing next to Buscar, Ajuda and the bell, and the
phone top bar was always on the edge of overflowing. The desktop and the "Plano e limites" page are the place for
the usage/plan information; on the phone the chip is gone and the header breathes.

1. html - links mobile-header-limite.css right before the design-system.css link, so design-system.css stays the
          last stylesheet, and raises the bundle ?v= to CACHE_VERSION when it is lower.

The rule itself lives in manager/dist/assets/mobile-header-limite.css (written by hand):
  @media (max-width: 640px) { [data-wa-header] .wa-ut-usage { display: none; } }
It only hides the chip; the chip keeps its markup, its popover and its place on the desktop, and the usage numbers
keep being on "Plano e limites". The client portal already hid the same chip with the same selector in
client-portal.css, so this only changes the internal panel.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: when the marker and the stylesheet are already in index.html, nothing is written.
Order: after design-system.py (uses its link marker as the anchor) and usage-limits.py (which adds the chip).

Usage (from the repository root):
  python3 -I manager/patches/mobile-header-limite.py           # apply
  python3 -I manager/patches/mobile-header-limite.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'mobile-header-limite.css')
CACHE_VERSION = '70'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_VERSION = '1'
CSS_TAG = '<link rel="stylesheet" href="/assets/mobile-header-limite.css?v=' + CSS_VERSION + '" />'
HTML_MARKER = '<!-- whatsai-patch:mobile-header-limite:html -->'
DESIGN_MARKER = '<!-- whatsai-patch:design-system:html -->'
USAGE_MARKER = '/*whatsai-patch:usage-limits:component*/'


class PatchError(Exception):
    pass


def patch_index(html):
    if CSS_TAG in html:
        if HTML_MARKER not in html:
            raise PatchError('index.html: mobile-header-limite.css linked without its marker')
        return html
    if HTML_MARKER in html:
        raise PatchError('index.html: mobile-header-limite marker without the stylesheet')
    if html.count('    ' + DESIGN_MARKER) != 1:
        raise PatchError('index.html: design-system marker expected once (run design-system.py first)')
    block = '    ' + HTML_MARKER + '\n    ' + CSS_TAG + '\n'
    return html.replace('    ' + DESIGN_MARKER, block + '    ' + DESIGN_MARKER, 1)


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
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    missing = []
    if USAGE_MARKER not in s:
        missing.append('usage-limits component (run usage-limits.py first)')
    if HTML_MARKER not in html or CSS_TAG not in html:
        missing.append('html')
    if patch_index(html) != html:
        missing.append('index.html')
    if bump_index(html) != html:
        missing.append('index.html cache version')
    if not os.path.exists(CSS):
        missing.append('mobile-header-limite.css')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    if USAGE_MARKER not in s:
        raise PatchError('run usage-limits.py first: the header chip marker is missing')
    new_html = bump_index(patch_index(html))
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    pos = new_html.find(SCRIPT_TAG) + len(SCRIPT_TAG)
    end = pos
    while end < len(new_html) and new_html[end].isdigit():
        end += 1
    print(f'index.html: mobile-header-limite.css ?v={CSS_VERSION}, bundle ?v={new_html[pos:end]}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
