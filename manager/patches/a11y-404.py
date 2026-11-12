#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: friendly error page and Agenda roles (proposal Q, accessibility).

1. error  - the router's default error element printed "Unexpected Application Error! 404 Not Found" in English on an
            empty page for any unknown /manager address. It becomes a page in Portuguese: "Esta página não existe" with a
            link back to the panel, or, for a crash, "Algo deu errado nesta tela" with "Recarregar". Same tokens as the
            panel, so it follows the light and dark theme.
2. agenda - the week view declared role=grid with gridcells that had no row around them (axe: aria-required-parent,
            aria-required-children) and day labels that did not match the visible text. The week becomes a group of
            labelled day groups; the visible headers stay.
3. nav    - sidebar items: the link itself gets the button look instead of a link inside a <button tabindex=-1>.
4. html   - loads /assets/panel-a11y.js (main landmark, tab title per page, names for unlabelled switches) and raises
            the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after chat-live.py.

Usage (from the repository root):
  python3 -I manager/patches/a11y-404.py           # apply
  python3 -I manager/patches/a11y-404.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '49'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
A11Y_VERSION = '1'
A11Y_TAG = '<script src="/assets/panel-a11y.js?v=' + A11Y_VERSION + '"></script>'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:a11y-404:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


ERROR_OLD = (
    'function P2(){let e=B2(),t=mh(e)?e.status+" "+e.statusText:e instanceof Error?e.message:JSON.stringify(e),'
    'n=e instanceof Error?e.stack:null,s={padding:"0.5rem",backgroundColor:"rgba(200,200,200, 0.5)"};'
    'return y.createElement(y.Fragment,null,y.createElement("h2",null,"Unexpected Application Error!"),'
    'y.createElement("h3",{style:{fontStyle:"italic"}},t),n?y.createElement("pre",{style:s},n):null,null)}'
)
ERROR_NEW = (
    'function P2(){let e=B2(),nf=mh(e)&&e.status===404;'
    'typeof console<"u"&&!nf&&console.error(e);'
    'const box={minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",'
    'background:"var(--m-bg, #f5f5f5)",color:"var(--m-text, #1a1a1a)",fontFamily:"Geist, system-ui, sans-serif"},'
    'muted={color:"var(--m-text-2, #5e5e5e)",fontSize:"14px",lineHeight:1.5,margin:"0 0 20px"},'
    'btn={display:"inline-flex",alignItems:"center",height:"36px",padding:"0 16px",border:0,borderRadius:"6px",'
    'background:"var(--m-primary, #1a1a1a)",color:"var(--m-on-primary, #ffffff)",font:"inherit",fontSize:"14px",'
    'fontWeight:500,textDecoration:"none",cursor:"pointer"};'
    'return y.createElement("main",{style:box},y.createElement("div",{style:{maxWidth:"420px",textAlign:"center"}},'
    'y.createElement("p",{style:{...muted,fontSize:"13px",margin:"0 0 6px"}},nf?"Erro 404":"Erro"),'
    'y.createElement("h1",{style:{fontSize:"22px",fontWeight:600,letterSpacing:"-0.02em",margin:"0 0 8px"}},'
    'nf?"Esta página não existe":"Algo deu errado nesta tela"),'
    'y.createElement("p",{style:muted},nf?"O endereço pode ter mudado ou estar incompleto."'
    ':"Seus dados continuam salvos. Recarregue a página; se continuar, fale com o suporte."),'
    'nf?y.createElement("a",{href:"/manager/",style:btn},"Ir para o painel")'
    ':y.createElement("button",{type:"button",style:btn,onClick:()=>location.reload()},"Recarregar")))}'
)


def g_error(s):
    return rep(s, ERROR_OLD, ERROR_NEW, 'router error element')


AGENDA = [
    ("role:'grid','aria-label':'Semana'}", "role:'group','aria-label':'Semana'}", 'week grid'),
    ("h('div',{className:'wag-week-head',role:'row'}", "h('div',{className:'wag-week-head'}", 'week header row'),
    ("h('div',{key:d,role:'columnheader',className:'wag-dayhead'", "h('div',{key:d,className:'wag-dayhead'", 'day header'),
    ("className:'wag-col',role:'gridcell'", "className:'wag-col',role:'group'", 'day column'),
]


def g_agenda(s):
    for old, new, label in AGENDA:
        s = rep(s, old, new, 'agenda ' + label)
    return s


NAV_OLD = (
    'i.jsxs(se,{className:Ie("relative flex w-full items-center justify-start gap-2",u.isActive&&"pointer-events-none"),'
    'variant:u.isActive?"secondary":"link",tabIndex:-1,children:["link"in u&&i.jsx("a",{href:u.link,target:"_blank",'
    'rel:"noreferrer",className:"absolute inset-0 h-full w-full","aria-label":u.title}),"path"in u&&i.jsx(Fu,'
    '{to:`/manager/instance/${s?.id}/${u.path}`,className:"absolute inset-0 h-full w-full","aria-label":u.title,'
    '"aria-current":u.isActive?"page":void 0}),u.icon&&i.jsx(u.icon,{size:"15"}),i.jsx("span",{children:u.title})]})'
)
# The sidebar item was a <button tabindex=-1> wrapping a full-size <a>: a link inside a button (axe nested-interactive,
# 9 per page). Now the link itself carries the button look (Button asChild + .wa-nb); the CSS rules that styled
# "> li > button" also match .wa-nb.
NAV_NEW = (
    'i.jsx(se,{asChild:!0,className:Ie("relative flex w-full items-center justify-start gap-2 wa-nb",u.isActive&&"pointer-events-none"),'
    'variant:u.isActive?"secondary":"link",children:"link"in u?i.jsxs("a",{href:u.link,target:"_blank",rel:"noreferrer",'
    'children:[u.icon&&i.jsx(u.icon,{size:"15"}),i.jsx("span",{children:u.title})]}):"path"in u?i.jsxs(Fu,'
    '{to:`/manager/instance/${s?.id}/${u.path}`,"aria-current":u.isActive?"page":void 0,children:[u.icon&&i.jsx(u.icon,'
    '{size:"15"}),i.jsx("span",{children:u.title})]}):i.jsxs("span",{children:[u.icon&&i.jsx(u.icon,{size:"15"}),'
    'i.jsx("span",{children:u.title})]})})'
)


def g_nav(s):
    return rep(s, NAV_OLD, NAV_NEW, 'sidebar link item')


GROUPS = [('error', g_error), ('agenda', g_agenda), ('nav', g_nav)]


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
    if A11Y_TAG not in html:
        if '/assets/panel-a11y.js' in html:
            raise PatchError('index.html: panel-a11y.js present with another version; edit A11Y_VERSION')
        anchor = '    <script type="module" crossorigin src="/assets/index-b29a5d7a.js'
        if html.count(anchor) != 1:
            raise PatchError('index.html: module script line expected once')
        html = html.replace(anchor, '    ' + A11Y_TAG + '\n' + anchor, 1)
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
    report.append(f'index.html: bundle ?v={CACHE_VERSION}, panel-a11y.js ?v={A11Y_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
