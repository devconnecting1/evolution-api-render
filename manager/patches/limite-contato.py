#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: the "Limite por contato por dia" field tells the truth.

API (same release): an always-on anti-loop guard caps the AI at 100 answers per contact per day, with or without a
plan (conversations with other bots: operadoras, lojas, URAs). A configured per-contact limit can only be lower, and
the API refuses more than 100. The field said "Vazio = sem limite", which stopped being true.

1. field - hint "Até 100. Vazio = 100 ...", max=100 and placeholder "100"; the form refuses more than 100 before
           saving (same message as the API).
2. html  - raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after usage-limits.py.

Usage (from the repository root):
  python3 -I manager/patches/limite-contato.py           # apply
  python3 -I manager/patches/limite-contato.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '46'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:limite-contato:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


EDITS = [
    ('hint',
     "hint:'Protege contra conversas em loop. Vazio = sem limite.'",
     "hint:'Até 100. Vazio = 100: proteção fixa contra conversas entre robôs (operadoras, lojas, URAs).'"),
    ('input',
     "min:1,step:1,placeholder:'Sem limite',value:form.perContact",
     "min:1,max:100,step:1,placeholder:'100',value:form.perContact"),
    ('validation',
     "if(!int(f.perContact))e.push('Limite por contato: use um número inteiro a partir de 1, ou deixe vazio.');",
     "if(!int(f.perContact))e.push('Limite por contato: use um número inteiro a partir de 1, ou deixe vazio.');"
     "if(f.perContact!==''&&Number(f.perContact)>100)e.push('O limite por contato por dia vai até 100 (proteção fixa contra conversas entre robôs).');"),
]


def g_field(s):
    for label, old, new in EDITS:
        s = rep(s, old, new, label)
    return s


GROUPS = [('field', g_field)]


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
    new_html = bump_index(html)
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
