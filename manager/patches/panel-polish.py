#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: navigation and mobile polish.

1. sidebar - the instances page sidebar (ui-tables.py) only lists global pages: Instâncias, Observabilidade,
   Chaves e credenciais, Manual, Sair. The shortcuts "Conversas", "Plano e limites" and "Configurações" opened the
   first instance ("Atalhos abrem ...") from the page that lists every instance, which was confusing; the
   instance menu appears once an instance is opened.
2. html    - links panel-polish.css?v=1 after the last patch stylesheet and raises the bundle ?v= to CACHE_VERSION.
   The stylesheet fits the top bar on phones (usage chip shortened, repeated avatar hidden), and brings the older
   upstream pieces of the instance page (record card, action buttons, collapse button) to the compact style of
   the rest of the panel. Only var(--m-*) tokens, so both themes apply.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after ui-tables.py, theme.py, db-mode.py.

Usage (from the repository root):
  python3 -I manager/patches/panel-polish.py           # apply
  python3 -I manager/patches/panel-polish.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'panel-polish.css')
CACHE_VERSION = '32'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_LINK = '    <link rel="stylesheet" href="/assets/panel-polish.css?v=1" />\n'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:panel-polish:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:panel-polish:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


SIDEBAR_OLD = (
    "          navItem('db','Instâncias',null,!0,{onClick:()=>setDrawer(!1)}),\n"
    "          cur?navItem('chat','Conversas','/manager/instance/'+cur.id+'/chat'):null,\n"
    "          cur?navItem('gauge','Plano e limites','/manager/instance/'+cur.id+'/usage'):null,\n"
    "          navItem('pulse','Observabilidade','/manager/observability')]}),\n"
    "        i.jsx('p',{className:'wa-ut-side-label',children:'Outros'}),\n"
    "        i.jsxs('ul',{className:'wa-ut-nav',children:[\n"
    "          cur?navItem('cog','Configurações','/manager/instance/'+cur.id+'/settings'):null,\n"
)
SIDEBAR_NEW = (
    "          navItem('db','Instâncias',null,!0,{onClick:()=>setDrawer(!1)}),\n"
    "          navItem('pulse','Observabilidade','/manager/observability'),\n"
    "          navItem('lock','Chaves e credenciais','/manager/chaves')]}),\n"
    "        i.jsx('p',{className:'wa-ut-side-label',children:'Outros'}),\n"
    "        i.jsxs('ul',{className:'wa-ut-nav',children:[\n"
)
NOTE_OLD = "        cur?i.jsxs('p',{className:'wa-ut-side-note',children:['Atalhos abrem ',i.jsx('strong',{children:cur.name})]}):null]}),"
NOTE_NEW = "        null]}),"


def patch_sidebar(s):
    s = rep(s, SIDEBAR_OLD, SIDEBAR_NEW, 'sidebar items')
    return rep(s, NOTE_OLD, NOTE_NEW, 'sidebar note')


GROUPS = [('sidebar', patch_sidebar)]


def patch_html(html):
    links = list(re.finditer(r'    <link rel="stylesheet" href="/assets/[a-z0-9-]+\.css\?v=\d+" />\n', html))
    if not links or '</head>' not in html:
        raise PatchError('index.html: stylesheet links or </head> not found')
    last = links[-1]
    out = html[:last.end()] + CSS_LINK + html[last.end():]
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
    if not os.path.isfile(CSS):
        missing.append('panel-polish.css')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/panel-polish.css is missing')
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
    report.append(f'index.html: panel-polish.css ?v=1, bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
