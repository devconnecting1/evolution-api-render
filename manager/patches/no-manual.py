#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: the Manual leaves the panel (it lives only in the GitHub repository).

The Manual (README-WHATSAI.md rendered by readme-tab.js at /readme) was written for the operator of the system and
for the agent that maintains it, not for the people who use the panel. It stays in the repository (README-WHATSAI.md,
readmes/) and in the MCP resources (whatsai://docs, served by the API from the Docker image); the panel loses every
way to open it.

1. links   - removes "Manual" from the instance menu (j5), the instances sidebar, the "Mais" menu of the list, the
             "Abrir o Manual" button of "Primeiros passos", the Ctrl K palette, and the "Ler o manual" button and the
             Manual/Guia comercial cards of the old SPA home.
2. html    - drops readme-tab.css, readme-tab.js and marked.min.js from index.html (the files are deleted) and raises
             the bundle ?v= to CACHE_VERSION. /readme and /readmes/* answer with a redirect in vercel.json.

The license notice required by the Evolution API license (condition 1b) was shown in the Manual footer; it stays in
README.md, README-WHATSAI.md, NOTICE and LICENSE in the repository, which is where the administrators read the docs.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.

Usage (from the repository root):
  python3 -I manager/patches/no-manual.py           # apply
  python3 -I manager/patches/no-manual.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '39'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:no-manual:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:no-manual:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


CARD = (
    'i.jsxs("a",{href:"/readme",className:"flex items-center gap-3 p-4 rounded-lg border border-border hover:bg-accent '
    'transition-colors",children:[i.jsx(iB,{className:"w-5 h-5 text-muted-foreground"}),i.jsxs("div",{children:['
    'i.jsx("div",{className:"font-medium text-foreground",children:"Manual"}),i.jsx("div",{className:"text-sm '
    'text-muted-foreground",children:"Documentação do WhatsAI"})]})]}),i.jsxs("a",{href:"/readmes/README-COMERCIAL.md",'
    'className:"flex items-center gap-3 p-4 rounded-lg border border-border hover:bg-accent transition-colors",children:['
    'i.jsx(vB,{className:"w-5 h-5 text-muted-foreground"}),i.jsxs("div",{children:[i.jsx("div",{className:"font-medium '
    'text-foreground",children:"Guia comercial"}),i.jsx("div",{className:"text-sm text-muted-foreground",children:'
    '"Planos e valores"})]})]})'
)

EDITS = [
    ('instance menu',
     ',{id:"readme",title:"Manual",icon:sB,link:"/readme",divider:!0}].filter(',
     '].filter('),
    ('list sidebar',
     "          i.jsx('li',{children:i.jsxs('a',{href:'/readme',className:'wa-ut-nav-item',children:[svg('book',15),"
     "i.jsx('span',{children:'Manual'})]})}),\n",
     ''),
    ('list "Mais" menu',
     ",\n                i.jsxs(wt,{onSelect:()=>{window.location.href='/readme'},children:[svg('book',14),'Manual']})]})",
     ']})'),
    ('first steps button',
     ",\n        i.jsxs('a',{className:'wa-ut-start-btn',href:'/readme',children:[svg('book',15),'Abrir o Manual']})]}),",
     ']}),'),
    ('palette page', ",['readme','Manual','book']", ''),
    ('palette run', "else if(it.k==='readme')window.location.href='/readme';", ''),
    ('palette meta', "it.k==='readme'?'Abre o manual':'Página'", "'Página'"),
    ('old home button',
     ',i.jsx(se,{variant:"outline",size:"lg",asChild:!0,className:"wa-btn-line",children:i.jsx("a",{href:"/readme",'
     'children:"Ler o manual"})})]',
     ']'),
    ('old home cards', ',' + CARD, ''),
]


def patch_links(s):
    for label, old, new in EDITS:
        s = rep(s, old, new, label)
    return s


GROUPS = [('links', patch_links)]

HTML_TAGS = [
    '    <link rel="stylesheet" href="/assets/readme-tab.css?v=11" />\n',
    '    <script src="/assets/marked.min.js" defer></script>\n',
    '    <script src="/assets/readme-tab.js?v=15" defer></script>\n',
]


def patch_html(html):
    for tag in HTML_TAGS:
        html = rep(html, tag, '', 'index.html ' + tag.strip()[:40])
    return rep(html, '</head>', '    ' + html_marker('html') + '\n  </head>', 'index.html </head>')


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
    report.append(f'index.html: readme-tab and marked removed, bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
