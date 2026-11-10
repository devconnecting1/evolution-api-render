#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Acesso do cliente".

The client logs in with his own code (`wac_...`, created by the administrator) and sees only the modules chosen for
him; the server enforces the same list on every request (src/utils/client-access.ts), so this patch only shapes
the panel. Logic and pages live in a plain script, assets/client-portal.js (window.WaPortal), like readme-tab.js.

1. nav    - the instance menu gets two items: "Conexão" (client only: WhatsApp state and QR code) and "Acesso do
            cliente" (administrator only: modules, code, revoke). The whole list goes through WaPortal.nav, which
            keeps, for a client, only his modules.
2. routes - /manager/instance/:instanceId/conexao and /acesso-cliente: the usual layout with an empty
            <div data-wa-portal-page> that client-portal.js fills.
3. html   - links client-portal.css?v=1 and loads client-portal.js?v=1 (classic script, before the bundle, so
            window.WaPortal exists when the menu renders); raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.

Usage (from the repository root):
  python3 -I manager/patches/client-portal.py           # apply
  python3 -I manager/patches/client-portal.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '36'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
HTML_ASSETS = (
    '    <link rel="stylesheet" href="/assets/client-portal.css?v=1" />\n'
    '    <script src="/assets/client-portal.js?v=1"></script>\n'
)


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:client-portal:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:client-portal:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


ICONS = (
    'const WaPortalIcons=(()=>{const s=(d)=>(p)=>i.jsx("svg",{xmlns:"http://www.w3.org/2000/svg",width:p?.size||15,'
    'height:p?.size||15,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",'
    'strokeLinejoin:"round","aria-hidden":"true",children:d.map((x,k)=>i.jsx("path",{d:x},k))});'
    'return {Phone:s(["M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z","M11 18h2"]),'
    'Key:s(["M21 2l-9.6 9.6","M15.5 7.5l3 3L22 7l-3-3","M13 15.5a5.5 5.5 0 1 1-11 0a5.5 5.5 0 1 1 11 0"])};})();'
)

NAV_OLD = (
    '{id:"observability",title:"Observabilidade",icon:pB,path:"observability",divider:!0},'
    '{id:"readme",title:"Manual",icon:sB,link:"/readme",divider:!0}],[e])'
)
NAV_NEW = (
    '{id:"conexao",title:"Conexão",icon:WaPortalIcons.Phone,path:"conexao"},'
    '{id:"acesso-cliente",title:"Acesso do cliente",icon:WaPortalIcons.Key,path:"acesso-cliente"},'
    '{id:"observability",title:"Observabilidade",icon:pB,path:"observability",divider:!0},'
    '{id:"readme",title:"Manual",icon:sB,link:"/readme",divider:!0}].filter(x=>!window.WaPortal||window.WaPortal.nav(x)),[e])'
)

ROUTE_ANCHOR = '{path:"/manager/instance/:instanceId/leads",element:i.jsx(tn,{children:i.jsx(un,{children:i.jsx(WaLeads.Page,{})})})},'
ROUTES_NEW = ROUTE_ANCHOR + ''.join(
    '{path:"/manager/instance/:instanceId/' + page + '",element:i.jsx(tn,{children:i.jsx(un,{children:'
    'i.jsx("div",{className:"wa-portal-page","data-wa-portal-page":"' + page + '"})})})},'
    for page in ('conexao', 'acesso-cliente')
)

SIDEBAR_FN = 'function j5(){'


def g_nav(s):
    s = rep(s, SIDEBAR_FN, ICONS + SIDEBAR_FN, 'nav icons')
    return rep(s, NAV_OLD, NAV_NEW, 'nav items')


def g_routes(s):
    return rep(s, ROUTE_ANCHOR, ROUTES_NEW, 'routes')


GROUPS = [('nav', g_nav), ('routes', g_routes)]


def patch_html(html):
    tag = '    <script type="module" crossorigin src="/assets/index-b29a5d7a.js'
    if html.count(tag) != 1:
        raise PatchError('index.html: bundle script tag expected once')
    out = html.replace(tag, HTML_ASSETS + tag, 1)
    return out.replace('</head>', '    ' + html_marker('html') + '\n  </head>', 1)


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
    missing = [name for name, _ in GROUPS if marker(name) not in s]
    if html_marker('html') not in html:
        missing.append('html')
    if bump_index(html) != html:
        missing.append('index.html cache version')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    for asset in ('client-portal.js', 'client-portal.css'):
        if not os.path.isfile(os.path.join(ROOT, 'manager', 'dist', 'assets', asset)):
            raise PatchError(f'manager/dist/assets/{asset} is missing')
    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = patch_html(html) if 'html' in missing else html
    new_html = bump_index(new_html)
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: client-portal.js/css ?v=1, bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
