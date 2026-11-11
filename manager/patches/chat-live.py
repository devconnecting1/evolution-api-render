#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: Conversas update by themselves without the WebSocket.

The chat page learned about new messages only from the Socket.IO events of the Evolution API. WEBSOCKET_ENABLED is
off on the server (and the Evolution socket accepts only the global key or the instance token, and puts the
instance token inside every event, so it cannot be opened to the "Acesso do cliente" code). Result: with a
conversation open, a new message from the contact did not appear until the page was reloaded.

1. live  - waLive(ms): refetch interval for the chat queries, plus an idle guard. After 10 minutes without a click,
           key or touch the panel tells React Query the window is unfocused (focusManager Rb), so the polling stops
           and the database (Neon) can sleep; the next interaction turns it back on and refreshes at once.
           Hidden tabs never poll (refetchIntervalInBackground stays false).
2. chats - list of conversations (findChats) every 20 s.
3. msgs  - open conversation (findMessages, first page) every 8 s; older pages loaded by "Carregar anteriores" stay.
4. html  - raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after agenda-polish.py.

Usage (from the repository root):
  python3 -I manager/patches/chat-live.py           # apply
  python3 -I manager/patches/chat-live.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '48'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:chat-live:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


LIVE_ANCHOR = 'const dX=e=>e.split("@")[0];function tk('
LIVE = (
    "var waLiveOn=!1;function waLive(ms){if(!waLiveOn&&typeof window<'u'){waLiveOn=!0;"
    "let last=Date.now(),idle=!1;const wake=()=>{last=Date.now();if(idle){idle=!1;Rb.setFocused(void 0)}};"
    "['pointerdown','keydown','wheel','touchstart','scroll'].forEach(ev=>window.addEventListener(ev,wake,{passive:!0,capture:!0}));"
    "setInterval(()=>{if(!idle&&Date.now()-last>6e5){idle=!0;Rb.setFocused(!1)}},3e4)}return ms}"
)


def g_live(s):
    return rep(s, LIVE_ANCHOR, LIVE + LIVE_ANCHOR, 'waLive helper')


def g_chats(s):
    return rep(
        s,
        '{data:u,isSuccess:d,isLoading:waLoading,isError:waError,refetch:waRefetch}=sY({instanceName:s?.name})',
        '{data:u,isSuccess:d,isLoading:waLoading,isError:waError,refetch:waRefetch}=sY({instanceName:s?.name,refetchInterval:waLive(2e4)})',
        'chat list query',
    )


def g_msgs(s):
    return rep(
        s,
        '{data:O,isSuccess:D,isLoading:waMsgLoading,isError:waMsgError}=rX({remoteJid:C,instanceName:o?.name})',
        '{data:O,isSuccess:D,isLoading:waMsgLoading,isError:waMsgError}=rX({remoteJid:C,instanceName:o?.name,refetchInterval:waLive(8e3)})',
        'messages query',
    )


GROUPS = [('live', g_live), ('chats', g_chats), ('msgs', g_msgs)]


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
