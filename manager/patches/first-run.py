#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: guided first use (proposal U).

A new administrator, with no instance yet, saw an empty table and one line of text at the bottom of the page
("Nenhuma instância ainda"), with no button and no idea of what comes next.

1. welcome - Instâncias with zero instances (and the list loaded): a welcome block in place of the table with the
             three steps (connect the WhatsApp, set up the attendant, send a test message) and the same
             "Nova instância" button as the header. Lovable, Neon and Cal.com do the same on an empty workspace.
             The empty states for a filtered view and for a failed load stay as they are.
2. html    - links /assets/first-run.css and raises the bundle ?v= to CACHE_VERSION.

The client portal's first-access notice lives in client-portal.js (no bundle change).

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after states.py.

Usage (from the repository root):
  python3 -I manager/patches/first-run.py           # apply
  python3 -I manager/patches/first-run.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '51'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_VERSION = '1'
CSS_TAG = '<link rel="stylesheet" href="/assets/first-run.css?v=' + CSS_VERSION + '" />'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:first-run:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


STEPS = [
    ('Conecte o WhatsApp', 'Crie a instância e leia o QR code no celular do número, ou use a API oficial da Meta.'),
    ('Configure o atendente', 'Escreva as informações do negócio, o horário e o tom das respostas da IA.'),
    ('Mande uma mensagem de teste', 'De outro celular, escreva para o número e veja a resposta chegar.'),
]
WELCOME = (
    "empty&&!all.length&&Array.isArray(list)?i.jsxs('section',{className:'wa-ut-welcome','aria-labelledby':'wa-ut-welcome-t',children:["
    "i.jsx('h2',{id:'wa-ut-welcome-t',className:'wa-ut-welcome-title',children:'Boas-vindas ao WhatsAI'}),"
    "i.jsx('p',{className:'wa-ut-welcome-lead',children:'Cada número de WhatsApp é uma instância, com o próprio atendente de IA. Três passos para começar:'}),"
    "i.jsx('ol',{className:'wa-ut-welcome-steps',children:["
    + ','.join(
        "i.jsxs('li',{children:[i.jsx('span',{className:'wa-ut-welcome-n','aria-hidden':'true',children:'" + str(k + 1) + "'}),"
        "i.jsxs('span',{children:[i.jsx('strong',{children:'" + t + "'}),i.jsx('span',{children:'" + d + "'})]})]},'s" + str(k) + "')"
        for k, (t, d) in enumerate(STEPS)
    )
    + "]}),i.jsx('div',{className:'wa-ut-welcome-cta',children:create})]}):"
)
ANCHOR = "        empty?i.jsxs('div',{className:'wa-ut-empty',children:[i.jsx("


def g_welcome(s):
    return rep(s, ANCHOR, '        ' + WELCOME + ANCHOR.lstrip(), 'instances empty block')


GROUPS = [('welcome', g_welcome)]


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
        if '/assets/first-run.css' in html:
            raise PatchError('index.html: first-run.css present with another version; edit CSS_VERSION')
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
    report.append(f'index.html: bundle ?v={CACHE_VERSION}, first-run.css ?v={CSS_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
