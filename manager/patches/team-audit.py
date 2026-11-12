#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Equipe" and "Registro de ações" (proposal V).

The server decides everything (src/utils/team-access.ts, src/utils/audit-log.ts); this patch only adds the two owner
pages and their menu entries. The pages are plain DOM, filled by assets/team-admin.js into
<div data-wa-team-page="..."> (same pattern as client-portal.js), so the bundle only gets routes and menu items.

1. routes - /manager/equipe and /manager/registro with the global layout (B5, the sidebar of Chaves and Retenção).
2. nav    - "Equipe" and "Registro de ações" in the workspace sidebar, in both shells (instance list and global
            pages), right after "Retenção (LGPD)".
3. html   - links team-admin.css and loads team-admin.js at ASSET_VERSION; raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after client-portal.py.

Usage (from the repository root):
  python3 -I manager/patches/team-audit.py           # apply
  python3 -I manager/patches/team-audit.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '53'
ASSET_VERSION = '1'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
HTML_ASSETS = (
    '    <link rel="stylesheet" href="/assets/team-admin.css?v=' + ASSET_VERSION + '" />\n'
    '    <script src="/assets/team-admin.js?v=' + ASSET_VERSION + '"></script>\n'
)


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:team-audit:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


ROUTE_ANCHOR = (
    '{path:"/manager/retencao",element:i.jsx(tn,{children:i.jsx(B5,{children:'
    'i.jsx("div",{className:"wa-portal-page wa-portal-global","data-wa-portal-page":"retencao"})})})},'
)
ROUTES_NEW = ROUTE_ANCHOR + ''.join(
    '{path:"/manager/' + path + '",element:i.jsx(tn,{children:i.jsx(B5,{children:'
    'i.jsx("div",{className:"wa-team-page","data-wa-team-page":"' + page + '"})})})},'
    for path, page in (('equipe', 'equipe'), ('registro', 'registro'))
)


def g_routes(s):
    return rep(s, ROUTE_ANCHOR, ROUTES_NEW, 'routes')


UT_NAV_OLD = "          navItem('cal','Retenção (LGPD)','/manager/retencao')]}),"
UT_NAV_NEW = (
    "          navItem('cal','Retenção (LGPD)','/manager/retencao'),\n"
    "          navItem('users','Equipe','/manager/equipe'),\n"
    "          navItem('list','Registro de ações','/manager/registro')]}),"
)
SHELL_NAV_OLD = "['lock','Chaves e credenciais','/manager/chaves'],['cal','Retenção (LGPD)','/manager/retencao']];"
SHELL_NAV_NEW = (
    "['lock','Chaves e credenciais','/manager/chaves'],['cal','Retenção (LGPD)','/manager/retencao'],"
    "['users','Equipe','/manager/equipe'],['list','Registro de ações','/manager/registro']];"
)


def g_nav(s):
    s = rep(s, UT_NAV_OLD, UT_NAV_NEW, 'instance list sidebar')
    return rep(s, SHELL_NAV_OLD, SHELL_NAV_NEW, 'global pages sidebar')


GROUPS = [('routes', g_routes), ('nav', g_nav)]


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
    if HTML_ASSETS not in html:
        if '/assets/team-admin.' in html:
            raise PatchError('index.html: team-admin assets present with another version; edit ASSET_VERSION')
        anchor = '    <script type="module" crossorigin src="/assets/index-b29a5d7a.js'
        if html.count(anchor) != 1:
            raise PatchError('index.html: module script line expected once')
        html = html.replace(anchor, HTML_ASSETS + anchor, 1)
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
    report.append(f'index.html: bundle ?v={CACHE_VERSION}, team-admin ?v={ASSET_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
