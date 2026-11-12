#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Equipe" and "Registro de ações" (proposal V).

The server decides everything (src/utils/team-access.ts, src/utils/audit-log.ts); this patch only adds the two owner
pages and their menu entries. The pages are plain DOM, filled by assets/team-admin.js into
<div data-wa-team-page="..."> (same pattern as client-portal.js), so the bundle only gets routes and menu items.

Groups:
  1. routes - /manager/equipe and /manager/registro with the global layout (B5, the sidebar of Chaves and Retenção).
  2. nav    - "Equipe" and "Registro de ações" in the workspace sidebar, in both shells (instance list and global
              pages), right after "Retenção (LGPD)". team-admin.css hides them for the "equipe"/"leitura" roles.
  3. html   - links team-admin.css and loads team-admin.js; raises the bundle ?v= to the next number. The version is
              computed from the current index.html, so this patch can be applied after any other panel patch
              without hard-coding a version that may already be in use.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: the markers in the bundle and in index.html make it a no-op.

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
ASSETS = os.path.join(ROOT, 'manager', 'dist', 'assets')
ASSET_VERSION = '1'
# 79 is the version billing-manual.py leaves in index.html on the branch this patch was written on; any later patch
# only raises it, and this one always goes one above the current value.
MIN_CACHE_VERSION = 79
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
MODULE_ANCHOR = '    <script type="module" crossorigin src="/assets/index-b29a5d7a.js'
HTML_MARKER = '<!-- whatsai-patch:team-audit:html -->'
CSS_TAG = '<link rel="stylesheet" href="/assets/team-admin.css?v=' + ASSET_VERSION + '" />'
JS_TAG = '<script src="/assets/team-admin.js?v=' + ASSET_VERSION + '"></script>'

ROUTE_ANCHOR = (
    '{path:"/manager/retencao",element:i.jsx(tn,{children:i.jsx(B5,{children:'
    'i.jsx("div",{className:"wa-portal-page wa-portal-global","data-wa-portal-page":"retencao"})})})},'
)
ROUTES_NEW = ROUTE_ANCHOR + ''.join(
    '{path:"/manager/' + path + '",element:i.jsx(tn,{children:i.jsx(B5,{children:'
    'i.jsx("div",{className:"wa-team-page","data-wa-team-page":"' + page + '"})})})},'
    for path, page in (('equipe', 'equipe'), ('registro', 'registro'))
)

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


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:team-audit:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


def g_routes(s):
    return rep(s, ROUTE_ANCHOR, ROUTES_NEW, 'routes')


def g_nav(s):
    s = rep(s, UT_NAV_OLD, UT_NAV_NEW, 'instance list sidebar')
    return rep(s, SHELL_NAV_OLD, SHELL_NAV_NEW, 'global pages sidebar')


GROUPS = [('routes', g_routes), ('nav', g_nav)]


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
    for name in ('team-admin.css', 'team-admin.js'):
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
    for name in ('team-admin.js', 'team-admin.css'):
        if not os.path.isfile(os.path.join(ASSETS, name)):
            raise PatchError(f'assets/{name} is missing')
    bundle = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    missing = [name for name, _ in GROUPS if marker(name) not in bundle]
    if HTML_MARKER not in html:
        missing.append('index.html')
    if check:
        print('ok: team-audit applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    report = []
    new_bundle = bundle
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        new_bundle = marker(name) + fn(new_bundle)
        report.append(f'{name}: applied')
    new_html = patch_index(html)
    if new_bundle != bundle:
        open(BUNDLE, 'w', encoding='utf-8').write(new_bundle)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: bundle ?v={current_bundle_version(new_html)}, team-admin ?v={ASSET_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
