#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: one header and one width for every page (proposal G).

1. navseg - the sidebar marked an item active when its path was a substring of the address: "chat" matched
            ".../chatwoot", so the Chatwoot page highlighted "Conversas" too. Now the path must be a whole segment.
2. html   - links /assets/page-frame.css (workspace pages with the same 20 px title and width as the instance pages,
            no "Painel WhatsAI" label, no breadcrumb repeated inside Observabilidade) and raises the bundle ?v=.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after first-run.py.

Usage (from the repository root):
  python3 -I manager/patches/page-frame.py           # apply
  python3 -I manager/patches/page-frame.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '52'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_VERSION = '1'
CSS_TAG = '<link rel="stylesheet" href="/assets/page-frame.css?v=' + CSS_VERSION + '" />'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:page-frame:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


def g_navseg(s):
    s = rep(s, 'isActive:"path"in d?r.includes(d.path):!1', 'isActive:"path"in d?("/"+r+"/").includes("/"+d.path+"/"):!1',
            'sidebar child active')
    return rep(s, 'isActive:"path"in u&&u.path?r.includes(u.path):!1', 'isActive:"path"in u&&u.path?("/"+r+"/").includes("/"+u.path+"/"):!1',
               'sidebar item active')


GROUPS = [('navseg', g_navseg)]


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
        if '/assets/page-frame.css' in html:
            raise PatchError('index.html: page-frame.css present with another version; edit CSS_VERSION')
        anchor = '    <script src="/assets/client-portal.js'
        if html.count(anchor) != 1:
            raise PatchError('index.html: client-portal.js script line expected once')
        html = html.replace(anchor, '    ' + CSS_TAG + '\n' + anchor, 1)
    return html


def main():
    check = '--check' in sys.argv[1:]
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    missing = [name for name, _ in GROUPS if marker(name) not in s]
    if patch_index(html) != html:
        missing.append('index.html')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = patch_index(html)
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: bundle ?v={CACHE_VERSION}, page-frame.css ?v={CSS_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
