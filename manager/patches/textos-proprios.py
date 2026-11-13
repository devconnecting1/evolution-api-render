#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: the integrations catalog no longer describes the bot integration
as "Bots do Evolution API".

The catalog entry keeps the same key, label and route; only the sentence the administrator reads changes to the
product's own wording. Applying also raises the bundle ?v= in index.html to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after integracoes-catalogo.py.

Usage (from the repository root):
  python3 -I manager/patches/textos-proprios.py           # apply
  python3 -I manager/patches/textos-proprios.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '81'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:textos-proprios:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


CATALOG_OLD = "['evolutionBot','BE','Bot Evolution','Bots do Evolution API.'],"
CATALOG_NEW = "['evolutionBot','BE','Bot Evolution','Bots de atendimento do WhatsAI.'],"


def g_catalogo(s):
    return rep(s, CATALOG_OLD, CATALOG_NEW, 'catalog description')


GROUPS = [('catalogo', g_catalogo)]


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
