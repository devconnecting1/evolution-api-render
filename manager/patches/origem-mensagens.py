#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: who wrote each message (Message.sentBy).

API (same release): every stored message keeps who wrote it (ai, panel, api, device, contact). A send is "panel" when
the request carries the header `x-wa-origin: panel` (src/utils/message-sender.ts); /chat/findMessages returns
`sentBy`.

Groups:
  1. origin - the three sends of the Conversas page (sendText, sendMedia, sendWhatsAppAudio) carry
              `x-wa-origin: panel`.
  2. ai     - the bubble of an AI message (sentBy "ai") shows a small "IA" label; the screen reader reads "IA:"
              instead of "Você:".
  3. html   - links origem-mensagens.css and raises the bundle ?v= one above the current value (at least 83).

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: the markers in the bundle and in index.html make it a no-op.

Usage (from the repository root):
  python3 -I manager/patches/origem-mensagens.py           # apply
  python3 -I manager/patches/origem-mensagens.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
ASSETS = os.path.join(ROOT, 'manager', 'dist', 'assets')
CSS_VERSION = '1'
# 82 is the highest bundle version of the panel patches when this one was written (design-system.py); this patch
# always goes one above the current value.
MIN_CACHE_VERSION = 82
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
MODULE_ANCHOR = '    <script type="module" crossorigin src="/assets/index-b29a5d7a.js'
HTML_MARKER = '<!-- whatsai-patch:origem-mensagens:html -->'
CSS_TAG = '<link rel="stylesheet" href="/assets/origem-mensagens.css?v=' + CSS_VERSION + '" />'

JSON_HEADERS = '{headers:{apikey:t,"content-type":"application/json"}}'
PANEL_HEADERS = '{headers:{apikey:t,"content-type":"application/json","x-wa-origin":"panel"}}'
SENDS = [
    ('sendText', '`/message/sendText/${e}`,n,'),
    ('sendMedia', '`/message/sendMedia/${e}`,r,'),
    ('sendWhatsAppAudio', '`/message/sendWhatsAppAudio/${e}`,r,'),
]

BUBBLE_OLD = (
    'i.jsx("span",{className:"sr-only",children:o?"Você: ":(a||"Contato")+": "}),'
    'a?i.jsx("span",{className:"wa-bubble-author","aria-hidden":"true",children:a}):null,'
)
BUBBLE_NEW = (
    'i.jsx("span",{className:"sr-only",children:o?(m?.sentBy==="ai"?"IA: ":"Você: "):(a||"Contato")+": "}),'
    'a?i.jsx("span",{className:"wa-bubble-author","aria-hidden":"true",children:a}):null,'
    'o&&m?.sentBy==="ai"?i.jsx("span",{className:"wa-bubble-ai","aria-hidden":"true",'
    'title:"Resposta automática da IA",children:"IA"}):null,'
)


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:origem-mensagens:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


def g_origin(s):
    for label, url in SENDS:
        s = rep(s, url + JSON_HEADERS, url + PANEL_HEADERS, label)
    return s


def g_ai(s):
    return rep(s, BUBBLE_OLD, BUBBLE_NEW, 'bubble')


GROUPS = [('origin', g_origin), ('ai', g_ai)]


def current_bundle_version(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag expected once')
    start = pos + len(SCRIPT_TAG)
    end = start
    while end < len(html) and html[end].isdigit():
        end += 1
    current = html[start:end]
    if not current:
        raise PatchError('index.html: bundle ?v= not found')
    return int(current)


def patch_index(html):
    if HTML_MARKER in html:
        return html
    if '/assets/origem-mensagens.css' in html:
        raise PatchError('index.html: origem-mensagens.css present without the marker; remove it first')
    if html.count(MODULE_ANCHOR) != 1:
        raise PatchError('index.html: module script line expected once')
    version = max(current_bundle_version(html), MIN_CACHE_VERSION) + 1
    pos = html.find(SCRIPT_TAG) + len(SCRIPT_TAG)
    end = pos
    while end < len(html) and html[end].isdigit():
        end += 1
    html = html[:pos] + str(version) + html[end:]
    tags = '    ' + CSS_TAG + '\n    ' + HTML_MARKER + '\n'
    return html.replace(MODULE_ANCHOR, tags + MODULE_ANCHOR, 1)


def main():
    check = '--check' in sys.argv[1:]
    if not os.path.isfile(os.path.join(ASSETS, 'origem-mensagens.css')):
        raise PatchError('assets/origem-mensagens.css is missing')
    bundle = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    missing = [name for name, _ in GROUPS if marker(name) not in bundle]
    if HTML_MARKER not in html:
        missing.append('index.html')
    if check:
        print('ok: origem-mensagens applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    report = []
    new_bundle = bundle
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        new_bundle = marker(name) + fn(new_bundle)
        report.append(f'{name}: applied')
    new_html = patch_index(html)
    if new_bundle != bundle:
        open(BUNDLE, 'w', encoding='utf-8').write(new_bundle)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: bundle ?v={current_bundle_version(new_html)}, origem-mensagens.css ?v={CSS_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
