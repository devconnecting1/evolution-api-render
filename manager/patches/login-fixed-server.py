#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: login with the server fixed, only the key is typed.

The panel talks to one API (the WhatsAI server on Render), so the "URL do Servidor" field only added a way to get
it wrong. The address stays in the form's default values (it is not a secret: the browser shows it in every
request anyway); what protects the panel is the key, checked on the server with a limit on wrong attempts
(src/utils/auth-throttle.ts).

1. login - removes the server field from the form; a server that does not answer now shows its message under the
           key field ("Servidor indisponível..."), since there is no server field to show it under; the key field is
           labelled "Chave de acesso" and gets focus.
2. html   - raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after login-clean.py.

Usage (from the repository root):
  python3 -I manager/patches/login-fixed-server.py           # apply
  python3 -I manager/patches/login-fixed-server.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '38'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:login-fixed-server:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


SERVER_FIELD = (
    'i.jsx(le,{required:!0,name:"serverUrl",label:e("login.form.serverUrl"),children:i.jsx(ne,{inputMode:"url",'
    'autoComplete:"url",spellCheck:!1,autoCapitalize:"off",placeholder:"https://seu-servidor.com"})}),'
)
KEY_FIELD_OLD = (
    'i.jsx(le,{required:!0,name:"apiKey",label:e("login.form.apiKey"),children:i.jsx(ne,{type:"password",'
    'autoComplete:"current-password",spellCheck:!1})})'
)
KEY_FIELD_NEW = (
    'i.jsx(le,{required:!0,name:"apiKey",label:"Chave de acesso",children:i.jsx(ne,{type:"password",'
    'autoComplete:"current-password",spellCheck:!1,autoFocus:!0})})'
)
SERVER_ERROR_OLD = 'r.setError("serverUrl",{type:"manual",message:e("login.message.invalidServer")});return}'
SERVER_ERROR_NEW = (
    'r.setError("apiKey",{type:"manual",message:"Servidor indisponível no momento. Tente de novo em alguns segundos."});'
    'return}'
)


def patch_login(s):
    s = rep(s, SERVER_FIELD, '', 'login server field')
    s = rep(s, KEY_FIELD_OLD, KEY_FIELD_NEW, 'login key field')
    return rep(s, SERVER_ERROR_OLD, SERVER_ERROR_NEW, 'login server error')


GROUPS = [('login', patch_login)]


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
