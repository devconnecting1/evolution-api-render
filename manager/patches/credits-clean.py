#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: no author credits at the bottom of the panel pages, and the
"Comportamento" settings say what each switch really does.

1. footer - the footer of both panel layouts (Vb: "WhatsAI · Atendimento com IA no WhatsApp" / "Desenvolvido por
            ... · 2026" / "Inspirado no Evolution Foundation/Evolution API") renders nothing. It repeated on every
            page, under the content, and took space on phones.
2. about  - the in-panel welcome page (Fse) loses its "© 2026 WhatsAI. Desenvolvido por ..." paragraph.
The notice the Evolution API license asks for (condition 1b: a notice, visible to administrators and reachable
from the documentation, that the system uses Evolution API) stays in the Manual footer (readme-tab.js), in
README-WHATSAI.md, LICENSE and NOTICE.
3. behavior - the help text of instance > Comportamento (pt-BR strings only; same fields, same API): each switch
            says its effect and the recommended value, from the Baileys service: rejectCall refuses calls on every
            device of the number; alwaysOnline is markOnlineOnConnect (the phone stops getting notifications) and
            also keeps the bot online after each reply; readMessages marks every incoming message as read on
            arrival; syncFullHistory only acts when pairing by QR code; readStatus marks statuses as seen and
            stores them (off, status@broadcast is ignored).
Applying also raises the bundle ?v= in index.html to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.

Usage (from the repository root):
  python3 -I manager/patches/credits-clean.py           # apply
  python3 -I manager/patches/credits-clean.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '35'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:credits-clean:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


FOOTER_OLD = (
    'function Vb(){return i.jsxs("footer",{className:"flex w-full flex-col items-center justify-center gap-1 p-6 '
    'text-center text-xs text-muted-foreground",children:[i.jsx("span",{children:"WhatsAI · Atendimento com IA no '
    'WhatsApp"}),i.jsx("span",{children:"Desenvolvido por Matheus Moraes · 2026"}),i.jsx("span",{children:'
    '"Inspirado no Evolution Foundation/Evolution API"})]})}'
)
FOOTER_NEW = 'function Vb(){return null}'

ABOUT_OLD = (
    ',i.jsx("div",{className:"text-center mt-12 text-sm text-muted-foreground",children:i.jsx("p",{children:'
    '"© 2026 WhatsAI. Desenvolvido por Matheus Moraes. Inspirado no Evolution Foundation/Evolution API. '
    'Licenciado sob Apache 2.0, com condições adicionais."})})'
)


def g_footer(s):
    return rep(s, FOOTER_OLD, FOOTER_NEW, 'footer')


def g_about(s):
    return rep(s, ABOUT_OLD, '', 'about')


BEHAVIOR = [
    ('rejectCall:{label:"Rejeitar Chamadas",description:"Rejeitar todas as chamadas"}',
     'rejectCall:{label:"Rejeitar Chamadas",description:"Recusa as ligações de voz e vídeo deste número, também no '
     'celular da equipe. Deixe desligado se alguém atende ligações por este WhatsApp."}'),
    ('msgCall:{label:"Mensagem de Rejeição de Chamada",description:"Enviar mensagem de rejeição de chamada"}',
     'msgCall:{label:"Mensagem de Rejeição de Chamada",description:"Mensagem para quem ligou, ex.: No momento não '
     'atendemos ligações por aqui. Mande sua mensagem que respondemos."}'),
    ('groupsIgnore:{label:"Ignorar Grupos",description:"Ignorar todas as mensagens de grupos"}',
     'groupsIgnore:{label:"Ignorar Grupos",description:"A IA não responde em grupos e as mensagens de grupos não são '
     'salvas. Recomendado: ligado."}'),
    ('alwaysOnline:{label:"Sempre Online",description:"Permanecer sempre online"}',
     'alwaysOnline:{label:"Sempre Online",description:"Mostra o número como online o tempo todo. Ligado, o celular da '
     'equipe pode parar de receber notificações. Recomendado: desligado."}'),
    ('readMessages:{label:"Visualizar Mensagens",description:"Marcar todas as mensagens como lidas"}',
     'readMessages:{label:"Visualizar Mensagens",description:"Marca como lida toda mensagem que chega, antes da '
     'resposta. A equipe perde o aviso de não lida. Recomendado: desligado."}'),
    ('syncFullHistory:{label:"Sincronizar Histórico Completo",description:"Sincronizar o histórico completo ao ler o QR Code"}',
     'syncFullHistory:{label:"Sincronizar Histórico Completo",description:"Importa todo o histórico do celular, só ao '
     'conectar pelo QR code. Pesa no banco de dados. Recomendado: desligado."}'),
    ('readStatus:{label:"Visualizar Status",description:"Marcar todos os status como visualizados"}',
     'readStatus:{label:"Visualizar Status",description:"Marca os status dos contatos como vistos (o contato vê) e '
     'guarda esses status no banco. Recomendado: desligado."}'),
]


def g_behavior(s):
    for old, new in BEHAVIOR:
        s = rep(s, old, new, 'behavior ' + old.split(':', 1)[0])
    return s


GROUPS = [('footer', g_footer), ('about', g_about), ('behavior', g_behavior)]


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
