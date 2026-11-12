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
3. retencao - /manager/retencao (global layout, administrator) with <div data-wa-portal-page="retencao">, and the item
            "Retenção (LGPD)" in the sidebar of the instance list: one message retention deadline for every instance.
4. contatos - "Contatos da IA" in the instance menu, right under Conversas, and its route
            /manager/instance/:instanceId/contatos-ia: the AI sessions of the instance as a Twenty-like list (search,
            views, bulk pause/resume). It replaces the old "Sessões" dialog hidden in the bot settings; a client with
            the Conversas module sees it too (the server already allows fetchSessions/changeStatus for that module).
5. html   - links client-portal.css and loads client-portal.js (classic script, before the bundle, so
            window.WaPortal exists when the menu renders) at ASSET_VERSION; raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.

Usage (from the repository root):
  python3 -I manager/patches/client-portal.py           # apply
  python3 -I manager/patches/client-portal.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '42'
ASSET_VERSION = '9'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
HTML_ASSETS = (
    '    <link rel="stylesheet" href="/assets/client-portal.css?v=' + ASSET_VERSION + '" />\n'
    '    <script src="/assets/client-portal.js?v=' + ASSET_VERSION + '"></script>\n'
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


RET_ROUTE_ANCHOR = '{path:"/manager/chaves",element:i.jsx(tn,{children:i.jsx(B5,{children:i.jsx(WaVault.Page,{})})})},'
RET_ROUTE_NEW = RET_ROUTE_ANCHOR + (
    '{path:"/manager/retencao",element:i.jsx(tn,{children:i.jsx(B5,{children:'
    'i.jsx("div",{className:"wa-portal-page wa-portal-global","data-wa-portal-page":"retencao"})})})},'
)
RET_NAV_OLD = "          navItem('lock','Chaves e credenciais','/manager/chaves')]}),"
RET_NAV_NEW = (
    "          navItem('lock','Chaves e credenciais','/manager/chaves'),\n"
    "          navItem('cal','Retenção (LGPD)','/manager/retencao')]}),"
)


def g_retencao(s):
    s = rep(s, RET_ROUTE_ANCHOR, RET_ROUTE_NEW, 'retencao route')
    return rep(s, RET_NAV_OLD, RET_NAV_NEW, 'retencao nav')


CI_ICON_OLD = 'return {Phone:s('
CI_ICON_NEW = (
    'return {Bot:s(["M12 8V4H8","M4 8h16v12H4z","M2 14h2","M20 14h2","M15 13v2","M9 13v2"]),Phone:s('
)
CI_NAV_OLD = '{id:"chat",title:e("sidebar.chat"),icon:Bl,path:"chat"},'
CI_NAV_NEW = CI_NAV_OLD + '{id:"contatos-ia",title:"Contatos da IA",icon:WaPortalIcons.Bot,path:"contatos-ia"},'
CI_ROUTE_ANCHOR = ROUTE_ANCHOR
CI_ROUTE_NEW = CI_ROUTE_ANCHOR + (
    '{path:"/manager/instance/:instanceId/contatos-ia",element:i.jsx(tn,{children:i.jsx(un,{children:'
    'i.jsx("div",{className:"wa-portal-page","data-wa-portal-page":"contatos-ia"})})})},'
)


def g_contatos(s):
    s = rep(s, CI_ICON_OLD, CI_ICON_NEW, 'contatos icon')
    s = rep(s, CI_NAV_OLD, CI_NAV_NEW, 'contatos nav')
    return rep(s, CI_ROUTE_ANCHOR, CI_ROUTE_NEW, 'contatos route')


GROUPS = [('nav', g_nav), ('routes', g_routes), ('retencao', g_retencao), ('contatos', g_contatos)]
ASSET_RE = re.compile(r'(/assets/client-portal\.(?:js|css)\?v=)(\d+)')


def bump_assets(html):
    return ASSET_RE.sub(lambda m: m.group(1) + (ASSET_VERSION if int(m.group(2)) < int(ASSET_VERSION) else m.group(2)), html)


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
    if bump_assets(html) != html:
        missing.append('index.html asset version')
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
    new_html = bump_assets(bump_index(new_html))
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: client-portal.js/css ?v={ASSET_VERSION}, bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
