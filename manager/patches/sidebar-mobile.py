#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: the instance drawer opens full screen on phones and tablets.

Before: below 1024 px the drawer of the instance pages started 60 px below the top edge (responsive.css kept the
header close button reachable) and the top block with the WhatsAI wordmark was hidden (instance-shell.css). Next to
the drawer of the workspace pages, which opens from the very top with the wordmark, the instance drawer looked cut at
the top. It also clipped the menu when it was taller than the screen.

Now, below 1024 px, the instance drawer:
  - covers the whole screen from the top edge (top: 0) and scrolls inside;
  - shows the same top block as the workspace drawer (WhatsAI wordmark; the collapse button stays hidden);
  - closes when the user taps outside, because the scrim now covers the whole screen.
Above 1023 px nothing changes.

1. html - links sidebar-mobile.css right before the design-system.css link, so design-system.css stays the last
          stylesheet, and raises the bundle ?v= to CACHE_VERSION when it is lower.

The rule itself lives in manager/dist/assets/sidebar-mobile.css (written by hand).

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: when the marker and the stylesheet are already in index.html, nothing is written.
Order: after design-system.py (uses its link marker as the anchor) and instance-shell.py (whose drawer is styled).

Usage (from the repository root):
  python3 -I manager/patches/sidebar-mobile.py           # apply
  python3 -I manager/patches/sidebar-mobile.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'sidebar-mobile.css')
CACHE_VERSION = '72'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_VERSION = '1'
CSS_TAG = '<link rel="stylesheet" href="/assets/sidebar-mobile.css?v=' + CSS_VERSION + '" />'
HTML_MARKER = '<!-- whatsai-patch:sidebar-mobile:html -->'
DESIGN_MARKER = '<!-- whatsai-patch:design-system:html -->'
INSTANCE_MARKER = '/*whatsai-patch:instance-shell:shell*/'
SIDEBAR_ANCHOR = 'id:"wa-sidebar"'


class PatchError(Exception):
    pass


def patch_index(html):
    if CSS_TAG in html:
        if HTML_MARKER not in html:
            raise PatchError('index.html: sidebar-mobile.css linked without its marker')
        return html
    if HTML_MARKER in html:
        raise PatchError('index.html: sidebar-mobile marker without the stylesheet')
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
    if INSTANCE_MARKER not in s or SIDEBAR_ANCHOR not in s:
        missing.append('instance shell (run instance-shell.py first)')
    if HTML_MARKER not in html or CSS_TAG not in html:
        missing.append('html')
    if patch_index(html) != html:
        missing.append('index.html')
    if bump_index(html) != html:
        missing.append('index.html cache version')
    if not os.path.exists(CSS):
        missing.append('sidebar-mobile.css')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    if INSTANCE_MARKER not in s or SIDEBAR_ANCHOR not in s:
        raise PatchError('run instance-shell.py first: the instance drawer is not in the bundle')
    new_html = bump_index(patch_index(html))
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    pos = new_html.find(SCRIPT_TAG) + len(SCRIPT_TAG)
    end = pos
    while end < len(new_html) and new_html[end].isdigit():
        end += 1
    print(f'index.html: sidebar-mobile.css ?v={CSS_VERSION}, bundle ?v={new_html[pos:end]}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
