#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: confirmation before the destructive actions that had none.

Audit of 11/11/2026 (every delete/remove/disconnect of the panel):
  already confirmed: delete instance (type the name), disconnect, log out, cancel appointment, remove process and
  OAB, "Analisar conversas anteriores" (spends OpenAI credit), retention, client access, delete of the bots.
  not confirmed, fixed here:
1. creds   - Integrações > OpenAI > Credenciais > Excluir: deleted the OpenAI key at once; every bot using it stopped
             answering. Now asks first.
2. session - the old "Sessões" dialog of the OpenAI bot > Excluir sessão: deleted the AI history of the contact at
             once. Now asks first. (The "Contatos da IA" page is the modern place for pause/resume.)
Both live inside Radix dialogs, so they use the browser confirm() like the process removal already does: a second
native <dialog> on top of a Radix modal fights its focus trap.
3. html    - raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.

Usage (from the repository root):
  python3 -I manager/patches/confirmacoes.py           # apply
  python3 -I manager/patches/confirmacoes.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '43'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:confirmacoes:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


CREDS_OLD = 'i.jsx(wt,{onClick:()=>x(C.id),children:n("openai.credentials.table.actions.delete")})'
CREDS_NEW = (
    'i.jsx(wt,{onClick:()=>{if(window.confirm("Excluir esta chave OpenAI?\\n\\nOs bots que usam esta chave param de '
    'responder até você escolher outra. Não dá para desfazer."))x(C.id)},'
    'children:n("openai.credentials.table.actions.delete")})'
)
SESSION_OLD = (
    'i.jsxs(wt,{onClick:()=>x(C.remoteJid,"delete"),children:[i.jsx(Ii,{className:"mr-2 h-4 w-4"}),'
    't("openai.sessions.state.actionDelete")]})'
)
SESSION_NEW = (
    'i.jsxs(wt,{onClick:()=>{if(window.confirm("Excluir a sessão deste contato?\\n\\nA IA esquece o histórico desta '
    'conversa (no WhatsApp nada muda). Para só parar a IA, use Pausar."))x(C.remoteJid,"delete")},'
    'children:[i.jsx(Ii,{className:"mr-2 h-4 w-4"}),t("openai.sessions.state.actionDelete")]})'
)


def g_creds(s):
    return rep(s, CREDS_OLD, CREDS_NEW, 'credentials delete')


def g_session(s):
    return rep(s, SESSION_OLD, SESSION_NEW, 'session delete')


GROUPS = [('creds', g_creds), ('session', g_session)]


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
