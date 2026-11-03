#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager bundle: two Conversas crashes.

1. Direct link to a conversation (e.g. /manager/instance/<id>/chat/<jid>) opened before the instance page
   ran: the axios interceptor only fell back to localStorage "instanceToken", which is not set yet, so
   findChats/findMessages went out without an apikey and got 401. It now falls back to the panel login
   key ("token") when there is no instance token.
2. A stored message whose `message` body is null (WhatsApp sometimes saves these) crashed the whole page
   with "Cannot read properties of null (reading 'contactMessage')". The bubble renderer now shows
   "Mensagem indisponível" for it, and the chat-list preview uses optional chaining.

Same method as the other scripts in manager/patches: exact string replacements on the minified bundle,
each anchor must match the expected number of times or nothing is written. Re-running is safe.
Applying also bumps the bundle ?v= in index.html to CACHE_VERSION (only raised, never lowered).
Order: run after ptbr-only.py.

Usage (from the repository root):
  python3 -I manager/patches/chat-guards.py           # apply
  python3 -I manager/patches/chat-guards.py --check   # exit 1 unless applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CACHE_VERSION = '19'
MARKER = '/*whatsai-patch:chat-guards:v1*/'
REQUIRED = ('/*whatsai-patch:ptbr-only:v1*/',)

GROUPS = [
    ('apikey fallback',
     'const n=dr(jn.INSTANCE_TOKEN);n&&(e.headers.apikey=`${n}`)',
     'const n=dr(jn.INSTANCE_TOKEN)||dr(jn.TOKEN);n&&(e.headers.apikey=`${n}`)',
     1),
    ('null message bubble',
     'ek=({message:e})=>{const t=e.messageType;',
     'ek=({message:e})=>{if(!e||!e.message||typeof e.message!="object")return i.jsx("span",'
     '{className:"text-sm italic text-muted-foreground",children:"Mensagem indisponível"});const t=e.messageType;',
     1),
    ('null message preview', 't?.message.', 't?.message?.', 12),
]


class PatchError(Exception):
    pass


def bump_cache(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag not found exactly once')
    end = pos + len(SCRIPT_TAG)
    while end < len(html) and html[end].isdigit():
        end += 1
    current = html[pos + len(SCRIPT_TAG):end]
    if not current.isdigit():
        raise PatchError(f'index.html: unexpected bundle version ?v={current}')
    if int(current) >= int(CACHE_VERSION):
        return html
    return html[:pos + len(SCRIPT_TAG)] + CACHE_VERSION + html[end:]


def main():
    check = '--check' in sys.argv[1:]
    with open(BUNDLE, encoding='utf-8') as f:
        bundle = f.read()
    with open(INDEX, encoding='utf-8') as f:
        html = f.read()

    applied = MARKER in bundle
    cache_ok = bump_cache(html) == html
    if check:
        ok = applied and cache_ok
        print('ok: all groups applied' if ok else 'missing: chat-guards' if not applied else 'missing: index.html cache version')
        return 0 if ok else 1

    for required in REQUIRED:
        if required not in bundle:
            raise PatchError(f'run the patch that adds {required} first')

    if not applied:
        for name, old, new, expected in GROUPS:
            found = bundle.count(old)
            if found != expected:
                raise PatchError(f'{name}: expected {expected} match(es), got {found}')
        for name, old, new, _ in GROUPS:
            bundle = bundle.replace(old, new)
            print(f'{name}: applied')
        bundle = MARKER + bundle
        with open(BUNDLE, 'w', encoding='utf-8') as f:
            f.write(bundle)
    else:
        print('chat-guards: already applied')

    new_html = bump_cache(html)
    if new_html != html:
        with open(INDEX, 'w', encoding='utf-8') as f:
            f.write(new_html)
    print(f'index.html: bundle ?v={CACHE_VERSION}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'error: {error}', file=sys.stderr)
        sys.exit(2)
