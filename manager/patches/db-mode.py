#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Banco de dados" choice in the "Nova instância" dialog.

When the server has the per-instance database on (DB_PER_INSTANCE_ENABLED + NEON_API_KEY), the create dialog shows
two options: "Banco próprio (recomendado)" (a Neon project only for this client, with the remaining-projects
counter) and "Compartilhado" (the main database). The choice goes to POST /instance/create as `dbMode`
("own" / "shared"). With the feature off, or when the quota cannot be read (instance-token login), nothing changes
and the server keeps its default.

Backend (same release): GET /admin/database-quota (global key only, answered from memory/Neon API, never wakes the
database) -> { enabled, defaultMode, limit, used, remaining, ownInstances, source }.
Requests go through `bd`, the bundle's axios instance with the login (global) key, like POST /instance/create.

Same method as the other scripts in manager/patches: exact string replacements on the minified bundle.
Styles: manager/dist/assets/db-mode.css (only var(--m-*) tokens, so the light and dark themes apply).

Bundle groups (each one is applied once and leaves a marker comment at the top of the bundle):
  state  - quota and chosen mode in the create dialog (dQ), quota fetched each time the dialog opens.
  submit - `dbMode` in the create payload (only when the feature is on) and reset when the dialog closes.
  field  - the "Banco de dados" fieldset right after the integration select.
index.html group (marker: an HTML comment in <head>):
  html   - links db-mode.css?v=1 after the last patch stylesheet and raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.
Order: run after ui-tables.py (it rewrote the create dialog this patch edits) and after theme.py.

Usage (from the repository root):
  python3 -I manager/patches/db-mode.py           # apply
  python3 -I manager/patches/db-mode.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'db-mode.css')
CACHE_VERSION = '30'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_LINK = '    <link rel="stylesheet" href="/assets/db-mode.css?v=1" />\n'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:db-mode:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:db-mode:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


# The chosen mode: null = follow the server suggestion (defaultMode), "own" / "shared" = the admin's pick.
MODE = '(waDbMode||waDbQ.defaultMode)'

STATE_OLD = 'function dQ({resetTable:e}){const{t}=Ve(),{createInstance:n}=Hh(),[r,s]=y.useState(!1),'
STATE_NEW = (
    'function dQ({resetTable:e}){const{t}=Ve(),{createInstance:n}=Hh(),[r,s]=y.useState(!1),'
    '[waDbQ,waSetDbQ]=y.useState(null),[waDbMode,waSetDbMode]=y.useState(null),'
    'waDbEffect=y.useEffect(()=>{if(!r)return;let c=!1;'
    'bd.get("/admin/database-quota").then(x=>{c||waSetDbQ(x&&x.data&&typeof x.data=="object"?x.data:{enabled:!1})})'
    '.catch(()=>{c||waSetDbQ({enabled:!1,failed:!0})});return()=>{c=!0}},[r]),'
)

SUBMIT_OLD = 'businessId:h.businessId===""?null:h.businessId};await n(m)'
SUBMIT_NEW = ('businessId:h.businessId===""?null:h.businessId,'
              '...(waDbQ&&waDbQ.enabled?{dbMode:' + MODE + '}:{})};await n(m)')
RESET_OLD = 'f=()=>{l.reset({name:"",integration:"WHATSAPP-BUSINESS"'
RESET_NEW = 'f=()=>{waSetDbMode(null);waSetDbQ(null);l.reset({name:"",integration:"WHATSAPP-BUSINESS"'

FIELD_OLD = ('i.jsx(Jt,{name:"integration",label:t("instance.form.integration.label"),options:o}),'
             'i.jsxs("details",{className:"wa-ut-adv"')
FIELD_NEW = (
    'i.jsx(Jt,{name:"integration",label:t("instance.form.integration.label"),options:o}),'
    'waDbQ&&waDbQ.enabled?i.jsxs("fieldset",{className:"wa-db-mode",children:['
    'i.jsx("legend",{children:"Banco de dados"}),'
    'i.jsxs("label",{className:"wa-db-opt"+(' + MODE + '==="own"?" is-on":"")+(waDbQ.remaining===0?" is-off":""),'
    'children:[i.jsx("input",{type:"radio",name:"waDbMode",value:"own",checked:' + MODE + '==="own",'
    'disabled:waDbQ.remaining===0,onChange:()=>waSetDbMode("own")}),'
    'i.jsxs("span",{className:"wa-db-txt",children:[i.jsx("strong",{children:"Banco próprio (recomendado)"}),'
    'i.jsx("small",{children:"Um projeto Neon só deste cliente: cota própria todo mês e dados separados das outras instâncias."}),'
    'i.jsx("small",{className:"wa-db-count",children:waDbQ.remaining===0?"Limite de "+waDbQ.limit+" projetos atingido"'
    ':waDbQ.remaining==null?"":"Restam "+waDbQ.remaining+" de "+waDbQ.limit+" projetos"'
    '+(waDbQ.source==="estimate"?" (estimativa)":"")})]})]}),'
    'i.jsxs("label",{className:"wa-db-opt"+(' + MODE + '==="shared"?" is-on":""),'
    'children:[i.jsx("input",{type:"radio",name:"waDbMode",value:"shared",checked:' + MODE + '==="shared",'
    'onChange:()=>waSetDbMode("shared")}),'
    'i.jsxs("span",{className:"wa-db-txt",children:[i.jsx("strong",{children:"Compartilhado"}),'
    'i.jsx("small",{children:"Usa o banco principal, junto com as outras instâncias compartilhadas. Bom para testes."})]})]})]})'
    ':r&&!waDbQ?i.jsx("p",{className:"wa-db-wait",children:"Verificando a cota de bancos…"}):null,'
    'i.jsxs("details",{className:"wa-ut-adv"'
)


def patch_state(s):
    return rep(s, STATE_OLD, STATE_NEW, 'state')


def patch_submit(s):
    s = rep(s, SUBMIT_OLD, SUBMIT_NEW, 'submit payload')
    return rep(s, RESET_OLD, RESET_NEW, 'submit reset')


def patch_field(s):
    return rep(s, FIELD_OLD, FIELD_NEW, 'field')


GROUPS = [('state', patch_state), ('submit', patch_submit), ('field', patch_field)]


def patch_html(html):
    links = list(re.finditer(r'    <link rel="stylesheet" href="/assets/[a-z0-9-]+\.css\?v=\d+" />\n', html))
    if not links:
        raise PatchError('index.html: no stylesheet link found')
    last = links[-1]
    return html[:last.end()] + CSS_LINK + html[last.end():].replace(
        '</head>', '    ' + html_marker('html') + '\n  </head>', 1) if '</head>' in html else None


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
    if not os.path.isfile(CSS):
        missing.append('db-mode.css')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/db-mode.css is missing')
    if '/*whatsai-patch:ui-tables:' not in s and 'wa-ut-adv' not in s:
        raise PatchError('run ui-tables.py first (it rewrote the create dialog)')

    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = html
    if 'html' in missing:
        patched = patch_html(new_html)
        if patched is None:
            raise PatchError('index.html: </head> not found')
        new_html = patched
        report.append('html: applied')
    else:
        report.append('html: already applied')
    new_html = bump_index(new_html)

    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        report.append(f'index.html written (db-mode.css ?v=1, bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
