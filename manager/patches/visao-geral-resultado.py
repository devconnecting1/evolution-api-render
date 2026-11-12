#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Visão Geral com o resultado do escritório".

The first screen of the instance stops being a technical card (token, restart, disconnect) and answers "como foi a
semana?": the numbers, the chart, today's agenda and the alerts live in assets/visao-geral.js, which fills the mount
point created here. The token and the two actions move to the "Conexão" page (client-portal.js), where the
administrator never loses access to them.

1. token     - removes the "Token da instância" field from the top of the dashboard.
2. actions   - keeps the refresh button and puts a "Conexão" link in place of Reiniciar/Desconectar; both now live
               on /manager/instance/:instanceId/conexao.
3. overview  - inserts <div class="wa-overview" data-wa-overview data-wa-instance-id> before the checklist; this is
               where assets/visao-geral.js renders the 7/30 day overview.
4. metrics   - removes the old contacts/chats/messages metrics card (replaced by the overview numbers).
5. html      - links visao-geral.css and loads visao-geral.js (classic script, before the bundle) at
               ASSET_VERSION; raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.

The "Conexão" page of the administrator is plain code in manager/dist/assets/client-portal.js (the same file the
client-portal.py patch instruments); this patch does not touch it.

Usage (from the repository root):
  python3 -I manager/patches/visao-geral-resultado.py           # apply
  python3 -I manager/patches/visao-geral-resultado.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '67'
ASSET_VERSION = '1'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
HTML_ASSETS = (
    '    <link rel="stylesheet" href="/assets/visao-geral.css?v=' + ASSET_VERSION + '" />\n'
    '    <script src="/assets/visao-geral.js?v=' + ASSET_VERSION + '"></script>\n'
)


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:visao-geral-resultado:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:visao-geral-resultado:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# ----------------------------------------------------------------------------------------------- dashboard
# PX = dashboard of the instance. The pieces below are the current minified markup (after dashboard-ui.py).
TOKEN_FIELD = (
    ',i.jsxs("div",{className:"wa-dash-field",children:[i.jsx("span",{className:"wa-dash-label",'
    'children:"Token da instância"}),i.jsx(c_,{token:g.token,className:"wa-dash-token"})]})'
)

DISCONNECT = (
    'i.jsxs(Pt,{children:[i.jsx(Bt,{asChild:!0,children:i.jsx(se,{variant:"destructive",className:"wa-btn-danger",'
    'disabled:g.connectionStatus==="close",children:e("instance.dashboard.button.disconnect")})}),'
    'i.jsxs(Nt,{className:"wa-confirm",children:[i.jsxs(Mt,{children:[i.jsx(zt,{children:"Desconectar o WhatsApp?"}),'
    'i.jsx(eo,{children:`A instância "${g.name}" para de enviar e receber mensagens até ser conectada de novo '
    'pelo QR code ou pelo código de pareamento.`})]}),i.jsxs(Yt,{className:"wa-confirm-foot",children:['
    'i.jsx($M,{asChild:!0,children:i.jsx(se,{variant:"outline",children:"Cancelar"})}),'
    'i.jsx($M,{asChild:!0,children:i.jsx(se,{variant:"destructive",onClick:()=>C(g.name),'
    'children:e("instance.dashboard.button.disconnect")})})]})]})]})'
)
ACTIONS_OLD = (
    ',i.jsxs("div",{className:"wa-dash-actions",children:[i.jsx(se,{variant:"outline",size:"icon",'
    'className:"refresh-button wa-icon-btn",onClick:b,"aria-label":"Atualizar",title:"Atualizar",'
    'children:i.jsx(Ip,{size:"16","aria-hidden":"true"})}),i.jsxs("div",{className:"wa-dash-actions-main",'
    'children:[i.jsx(se,{variant:"outline",className:"action-button",onClick:()=>w(g.name),'
    'children:e("instance.dashboard.button.restart")}),' + DISCONNECT + ']})]})'
)
ACTIONS_NEW = (
    ',i.jsxs("div",{className:"wa-dash-actions",children:[i.jsx(se,{variant:"outline",size:"icon",'
    'className:"refresh-button wa-icon-btn",onClick:b,"aria-label":"Atualizar",title:"Atualizar",'
    'children:i.jsx(Ip,{size:"16","aria-hidden":"true"})}),i.jsx("a",{className:"wa-dash-connect-link",'
    'href:"/manager/instance/"+g.id+"/conexao",children:"Conexão"})]})'
)

CHECKLIST = 'i.jsx(WaUt.Checklist,{instance:g}),'
OVERVIEW_MOUNT = (
    'i.jsx("div",{className:"wa-overview","data-wa-overview":g.name,"data-wa-instance-id":g.id}),'
)

METRICS = (
    ',i.jsxs("dl",{className:"wa-metrics","aria-label":"Números da instância",children:['
    'i.jsxs("div",{className:"wa-metric",children:[i.jsxs("dt",{className:"wa-metric-head",children:['
    'i.jsx("span",{className:"wa-metric-label",children:e("instance.dashboard.contacts")}),'
    'i.jsx(pT,{size:"16",className:"wa-metric-icon","aria-hidden":"true"})]}),'
    'i.jsx("dd",{className:"wa-metric-value",children:n.format(M.contacts)})]}),'
    'i.jsxs("div",{className:"wa-metric",children:[i.jsxs("dt",{className:"wa-metric-head",children:['
    'i.jsx("span",{className:"wa-metric-label",children:e("instance.dashboard.chats")}),'
    'i.jsx(jB,{size:"16",className:"wa-metric-icon","aria-hidden":"true"})]}),'
    'i.jsx("dd",{className:"wa-metric-value",children:n.format(M.chats)})]}),'
    'i.jsxs("div",{className:"wa-metric",children:[i.jsxs("dt",{className:"wa-metric-head",children:['
    'i.jsx("span",{className:"wa-metric-label",children:e("instance.dashboard.messages")}),'
    'i.jsx(Bl,{size:"16",className:"wa-metric-icon","aria-hidden":"true"})]}),'
    'i.jsx("dd",{className:"wa-metric-value",children:n.format(M.messages)})]})]})'
)


def g_token(s):
    return rep(s, TOKEN_FIELD, '', 'token field (moved to Conexão)')


def g_actions(s):
    return rep(s, ACTIONS_OLD, ACTIONS_NEW, 'restart/disconnect actions (moved to Conexão)')


def g_overview(s):
    return rep(s, CHECKLIST, OVERVIEW_MOUNT + CHECKLIST, 'overview mount')


def g_metrics(s):
    return rep(s, METRICS, '', 'old metrics card')


GROUPS = [('token', g_token), ('actions', g_actions), ('overview', g_overview), ('metrics', g_metrics)]
ASSET_RE = re.compile(r'(/assets/visao-geral\.(?:js|css)\?v=)(\d+)')


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
    for asset in ('visao-geral.js', 'visao-geral.css'):
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
    report.append(f'index.html: visao-geral.js/css ?v={ASSET_VERSION}, bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
