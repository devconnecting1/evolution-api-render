#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: the text and layout polish from the delivery review of 12/11/2026.

Items 1, 3, 4, 5, 6, 7 of "Acabamento do painel" (the low-risk ones, only manager/). Item 2 is the accessibility
PR of the same review: this script only takes the text/layout part.

1. labels   - inherited screens stop using Title Case in each word: "Rejeitar Chamadas" -> "Rejeitar chamadas",
              "Marcar Todos" -> "Marcar todos", "Configuracoes Padrao" -> "Configuracoes padrao" and the other
              labels of the pt-BR resources (Comportamento, Atendente IA, Typebot, Dify, n8n, EvoAI, Evolution Bot,
              Flowise, Chatwoot, Webhook). Only the pt-BR block is touched (anchored by "_ae={title:\"Instancias\""
              and "};try{localStorage"): the Spanish/French resources, legal texts, acronyms (IA, API, URL, JIDs,
              PDFs), product names (WhatsApp, OpenAI, Typebot, Dify, n8n, EvoAI, Evolution Bot, Flowise, Chatwoot,
              QR Code, Base64, Basic Auth) and the sentences that explain a feature stay as they are.
2. eventos  - "Enviar teste" only saved and validated the configuration; there is no test-delivery endpoint in the
              API. The button becomes "Salvar e validar" ("Salvando..." while it runs), the hint says it saves and
              checks the settings without sending a test message, and the result lines say "Validacao:" instead of
              "Ultimo teste:".
3. cobranca - the "Proximo vencimento" card said "Nenhuma cobranca registrada ainda." and the empty history said
              the same thing. The due card now says "Nenhum vencimento previsto."; the empty history keeps one
              title and the server note.
4. ajuda    - "Guia rapido" pointed to README-WHATSAI.md in the private GitHub repository, which the client cannot
              open. Decision: the item now says "Novidades do WhatsAI", opens the public /novidades page and is
              hidden for client access codes (window.WaPortal.client, prefix wac_); the Novidades section of the
              menu keeps its own "Ver todas" link.
5. celular  - on the lead card of the board (K), the last-message time ("ha 48 min") moves to the right of the
              name and the priority/status chips share the last row, so the status chip no longer sits on top of
              "Aguardando ha X". Pure CSS, below 640 px; desktop keeps the previous card.
6. visao    - the "Visao Geral" top card spent a whole row on the refresh button and "Conexao"; both move into
              the name row (markup moved into .wa-dash-head, styles reset to a quiet inline group). On desktop the
              "Hoje" column (agenda de hoje + precisa de atencao) sits beside the chart, like the drawing.
7. conversa - "Assumir conversa" and "Pausar IA" did almost the same thing in the contact panel. The panel keeps
              only the lead card's "Assumir conversa" (and "Retomar IA" when paused); the "IA neste contato" row
              shows the state as text. The P shortcut and the Ctrl K action now press "Assumir conversa" /
              "Retomar IA" (manager/dist/assets/help-shortcuts.js and the Ctrl K action labels).
              The sidebar "Visao Geral" label and "Voltar para Instancias" (credentials) also get sentence case.

The new styles live in manager/dist/assets/qa-painel-polish.css (plain file, only var(--m-*) tokens, light and
dark), linked right before design-system.css so the design system remains the last stylesheet. The bundle ?v= is
raised to CACHE_VERSION (75, only raised, never lowered) and help-shortcuts.js goes to ?v=2.

Every anchor must match exactly once (or the expected number of times, stated next to it), otherwise the script
stops without writing anything. Re-running is safe: when the marker is present the group is skipped.
Order: after qa-polish.py, help-menu.py, eventos-grupos.py, cobranca-exportacao.py, chat-lead-panel.py and
quadro-leads.py (it edits their output).

Usage (from the repository root):
  python3 -I manager/patches/qa-painel-polish.py           # apply
  python3 -I manager/patches/qa-painel-polish.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'qa-painel-polish.css')
SHORTCUTS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'help-shortcuts.js')
CACHE_VERSION = '75'
CSS_VERSION = '2'
SHORTCUTS_VERSION = '2'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_LINK = '    <link rel="stylesheet" href="/assets/qa-painel-polish.css?v=' + CSS_VERSION + '" />\n'
CSS_MARKER = '<!-- whatsai-patch:qa-painel-polish:html -->'
DESIGN_MARKER = '<!-- whatsai-patch:design-system:html -->'
BUNDLE_MARKER = '/*whatsai-patch:qa-painel-polish:v1*/'
SHORTCUTS_MARKER = '/*whatsai-patch:qa-painel-polish:shortcuts*/'
PT_START = '_ae={title:"Instâncias"'
PT_END = '};try{localStorage'


class PatchError(Exception):
    pass


def rep(s, old, new, label, count=1):
    n = s.count(old)
    if n != count:
        raise PatchError(f'{label}: expected {count} match(es), got {n}')
    return s.replace(old, new)


# ------------------------------------------------------------------------------------------------ labels
# Exact strings of the pt-BR resources. Each one is a label, title, option or toast; proper names and acronyms
# are not in the list. Counts are checked inside the pt-BR block only.
LABELS = [
    ('Assinar Mensagens', 'Assinar mensagens', 1),
    ('Configurações Gerais', 'Configurações gerais', 6),
    ('Configurações de Gatilho', 'Configurações de gatilho', 4),
    ('Configurações do Gatilho', 'Configurações do gatilho', 2),
    ('Conversação Pendente', 'Conversação pendente', 1),
    ('Criação Automática', 'Criação automática', 1),
    ('Delimitador de Assinatura', 'Delimitador de assinatura', 1),
    ('Desmarcar Todos', 'Desmarcar todos', 1),
    ('Dividir Mensagens', 'Dividir mensagens', 6),
    ('Excluir Registro', 'Excluir registro', 1),
    ('Fala para Texto', 'Fala para texto', 1),
    ('Gerar Código de Pareamento', 'Gerar código de pareamento', 1),
    ('ID da Conta', 'ID da conta', 1),
    ('Ignorar Grupos', 'Ignorar grupos', 1),
    ('Importar Contatos', 'Importar contatos', 1),
    ('Importar Mensagens', 'Importar mensagens', 1),
    ('Limite de Dias para Importação de Mensagens', 'Limite de dias para importação de mensagens', 1),
    ('Marcar Todos', 'Marcar todos', 1),
    ('Mensagem Desconhecida', 'Mensagem desconhecida', 6),
    ('Mensagem de Atraso Padrão', 'Mensagem de atraso padrão', 6),
    ('Mensagem de Rejeição de Chamada', 'Mensagem de rejeição de chamada', 1),
    ('Mudar Tema', 'Mudar tema', 1),
    ('Nome Público do Typebot', 'Nome público do Typebot', 1),
    ('Nome da Caixa de Entrada', 'Nome da caixa de entrada', 1),
    ('Nova Instância', 'Nova instância', 1),
    ('Operador do Gatilho', 'Operador do gatilho', 6),
    ('Palavra-chave de Finalização', 'Palavra-chave de finalização', 6),
    ('Reabrir Conversa', 'Reabrir conversa', 1),
    ('Rejeitar Chamadas', 'Rejeitar chamadas', 1),
    ('Sempre Online', 'Sempre online', 1),
    ('Sincronizar Histórico Completo', 'Sincronizar histórico completo', 1),
    ('Tempo de Debounce', 'Tempo de debounce', 6),
    ('Tempo por Caractere', 'Tempo por caractere', 4),
    ('Tipo de Bot', 'Tipo de bot', 1),
    ('Tipo de Gatilho', 'Tipo de gatilho', 6),
    ('URL do Agente', 'URL do agente', 1),
    ('URL do Webhook', 'URL do webhook', 1),
    ('Visualizar Mensagens', 'Visualizar mensagens', 1),
    ('Visualizar Status', 'Visualizar status', 1),
    ('Webhook por Eventos', 'Webhook por eventos', 1),
    ('API Key (Opcional)', 'Chave de API (opcional)', 1),
    ('Basic Auth (Opcional)', 'Basic Auth (opcional)', 1),
    ('Bot de Chat', 'Bot de chat', 1),
    ('Gerador de Texto', 'Gerador de texto', 1),
    ('Fluxo de Trabalho', 'Fluxo de trabalho', 1),
    ('Termina Com', 'Termina com', 7),
    ('Começa Com', 'Começa com', 7),
    ('Nome de Exibição', 'Nome de exibição', 5),
    ('ID da Sessão', 'ID da sessão', 5),
    ('Suporte Premium', 'Suporte premium', 1),
    ('Nome do Cliente', 'Nome do cliente', 1),
    ('URL do Servidor', 'URL do servidor', 1),
    ('Chave de API Global', 'Chave de API global', 1),
    ('Visão Geral', 'Visão geral', 1),
]


def patch_labels(s):
    """Sentence case only inside the pt-BR resources block."""
    if s.count(PT_START) != 1 or s.count(PT_END) != 1:
        raise PatchError('pt-BR resources: start/end anchor expected once')
    start = s.index(PT_START)
    end = s.index(PT_END, start)
    block = s[start:end]
    # The four explanatory notes say "das Configurações Padrão" mid-sentence: lower both words there first.
    block = rep(block, 'das Configurações Padrão.', 'das configurações padrão.', 'configurações padrão (nota das)', 3)
    block = rep(block, 'nas Configurações Padrão.', 'nas configurações padrão.', 'configurações padrão (nota nas)', 1)
    for old, new, count in LABELS:
        block = rep(block, old, new, 'label ' + old, count)
    block = rep(block, 'Configurações Padrão', 'Configurações padrão', 'label Configurações Padrão', 21)
    return s[:start] + block + s[end:]


# ------------------------------------------------------------------------------------------------ events
def patch_events(s):
    s = rep(s, "children:testing?'Enviando...':'Enviar teste'",
            "children:testing?'Salvando...':'Salvar e validar'", 'eventos: button label')
    s = rep(s, "i.jsx('p',{className:'wa-eventos-hint',children:'Salva a configuração atual e mostra a resposta da API.'})",
            "i.jsx('p',{className:'wa-eventos-hint',children:'Salva a configuração e confere com o servidor. Não envia mensagem de teste.'})",
            'eventos: hint')
    s = rep(s, "'Último teste: '+res.status", "'Validação: '+res.status", 'eventos: success text')
    s = rep(s, "'Último teste: erro'", "'Validação: erro'", 'eventos: error text')
    s = rep(s, "'Informe o endereço (URL) antes de testar.'", "'Informe o endereço (URL) antes de validar.'",
            'eventos: URL validation')
    return s


# ------------------------------------------------------------------------------------------------ billing
def patch_billing(s):
    return rep(s, "i.jsx('p',{className:'wu-muted',children:'Nenhuma cobrança registrada ainda.'})",
               "i.jsx('p',{className:'wu-muted',children:'Nenhum vencimento previsto.'})",
               'cobrança: empty due date')


# ------------------------------------------------------------------------------------------------ help
HELP_ITEM_OLD = ("i.jsxs('a',{role:'menuitem',className:'wa-help-item',href:GUIDE,target:'_blank',"
                 "rel:'noopener noreferrer',children:[svg('book',16),i.jsxs('span',{className:'wa-help-item-text',"
                 "children:[i.jsx('span',{children:'Guia rápido'}),i.jsx('span',{className:'wa-help-item-hint',"
                 "children:'Manual no GitHub'})]}),svg('ext',13)]})")
HELP_ITEM_NEW = ("(!window.WaPortal||!window.WaPortal.client)?i.jsxs('a',{role:'menuitem',className:'wa-help-item',"
                 "href:GUIDE,target:'_blank',rel:'noopener noreferrer',children:[svg('book',16),"
                 "i.jsxs('span',{className:'wa-help-item-text',children:[i.jsx('span',{children:'Novidades do WhatsAI'}),"
                 "i.jsx('span',{className:'wa-help-item-hint',children:'Página pública'})]}),svg('ext',13)]}):null")


def patch_help(s):
    s = rep(s, "const GUIDE='https://github.com/devconnecting1/evolution-api-render/blob/main/README-WHATSAI.md';",
            "const GUIDE='/novidades';", 'help: GUIDE')
    return rep(s, HELP_ITEM_OLD, HELP_ITEM_NEW, 'help: Guia rápido item')


# ------------------------------------------------------------------------------------------------ other locales
def patch_other_locales(s):
    """The Spanish resources are not registered any more (ptbr-only.py), but keep the same sentence case so a
    grep for a Title Case label does not find a dead string."""
    s = rep(s, 'markAll:"Marcar Todos"', 'markAll:"Marcar todos"', 'es: markAll', 1)
    s = rep(s, 'unMarkAll:"Desmarcar Todos"', 'unMarkAll:"Desmarcar todos"', 'es: unMarkAll', 1)
    return rep(s, 'groupsIgnore:{label:"Ignorar Grupos",description:"Ignorar todos los mensajes de grupos"}',
               'groupsIgnore:{label:"Ignorar grupos",description:"Ignorar todos los mensajes de grupos"}',
               'es: groupsIgnore', 1)


# ------------------------------------------------------------------------------------------------ hardcoded labels
def patch_hardcoded(s):
    s = rep(s, "['dashboard','Visão Geral','grid']", "['dashboard','Visão geral','grid']",
            'page table: Visão Geral')
    return rep(s, "children:'Voltar para Instâncias'", "children:'Voltar para instâncias'",
               'credentials: back button')


# ------------------------------------------------------------------------------------------------ dashboard
ACTIONS_JSX = ('i.jsxs("div",{className:"wa-dash-actions",children:[i.jsx(se,{variant:"outline",size:"icon",'
               'className:"refresh-button wa-icon-btn",onClick:b,"aria-label":"Atualizar",title:"Atualizar",'
               'children:i.jsx(Ip,{size:"16","aria-hidden":"true"})}),i.jsx("a",{className:"wa-dash-connect-link",'
               'href:"/manager/instance/"+g.id+"/conexao",children:"Conexão"})]})')
DASH_TAIL_OLD = 'children:waPhoneBR(g.ownerJid||g.number)})]})]})]}),g.connectionStatus!=="open"'
DASH_TAIL_NEW = ('children:waPhoneBR(g.ownerJid||g.number)})]})]})' + ',' + ACTIONS_JSX +
                 ']}),g.connectionStatus!=="open"')


def patch_dashboard(s):
    # Remove the standalone row first (the block is unique before it is copied into the head).
    s = rep(s, ',' + ACTIONS_JSX, '', 'dashboard: standalone actions row')
    # Put the same block inside .wa-dash-head, after the name/profile column.
    return rep(s, DASH_TAIL_OLD, DASH_TAIL_NEW, 'dashboard: actions into the name row')


# ------------------------------------------------------------------------------------------------ chat
CHAT_AI_OLD = ("else ai=i.jsxs('span',{className:'wa-tw-ai',children:[\n"
               "      a.k==='paused'?i.jsx(Badge,{tone:'warn',children:pausedText(a)}):a.k==='closed'?"
               "i.jsx(Badge,{tone:'off',children:'Sessão encerrada'}):i.jsx(Badge,{tone:'ok',children:'Ativa'}),\n"
               "      i.jsxs('button',{type:'button',className:'wa-tw-sbtn'+(a.k==='active'?' wa-tw-sbtn--ghost':''),"
               "onClick:()=>setConfirm(a.k==='active'?'paused':'opened'),children:[svg(a.k==='active'?'pause':'play',14),"
               "a.k==='active'?'Pausar IA':'Retomar IA']})]});\n    ")
CHAT_AI_NEW = ("else ai=i.jsxs('span',{className:'wa-tw-ai',children:[\n"
               "      a.k==='paused'?i.jsx(Badge,{tone:'warn',children:pausedText(a)}):a.k==='closed'?"
               "i.jsx(Badge,{tone:'off',children:'Sessão encerrada'}):i.jsx(Badge,{tone:'ok',children:'Ativa'})]});\n    ")


def patch_chat(s):
    s = rep(s, CHAT_AI_OLD, CHAT_AI_NEW, 'chat: Pausar/Retomar IA button')
    s = rep(s, "'Ainda sem sessão: a IA cria a sessão na primeira mensagem do contato. Depois dá para pausar aqui.'",
            "'Ainda sem sessão: a IA cria a sessão na primeira mensagem do contato. Depois dá para pausar pela ficha do lead.'",
            'chat: no-session hint')
    s = rep(s, "'Somente leitura. O único botão que muda algo é Pausar/Retomar IA, e ele pede confirmação.'",
            "'Somente leitura. Para pausar ou retomar a IA, use a ficha do lead.'", 'chat: panel note')
    s = rep(s, "label:iaK==='active'?'Pausar a IA neste contato':'Retomar a IA neste contato'",
            "label:iaK==='active'?'Assumir a conversa neste contato':'Retomar a IA neste contato'",
            'chat: ctrl K label')
    s = rep(s, "if(t==='Pausar IA'||t==='Retomar IA')", "if(t==='Assumir conversa'||t==='Retomar IA')",
            'chat: ctrl K finder')
    s = rep(s, "'Não foi possível pausar ou retomar a IA por aqui. Abra os detalhes do contato.'",
            "'Não foi possível assumir ou retomar a conversa por aqui. Abra os detalhes do contato.'",
            'chat: ctrl K error')
    s = rep(s, "['P','Pausar ou retomar a IA na conversa aberta']",
            "['P','Assumir ou retomar a conversa aberta']", 'chat: shortcuts dialog')
    return s


# ------------------------------------------------------------------------------------------------ shortcuts js
SHORTCUTS_DOC_OLD = (' *   P      na conversa aberta, abre o painel do contato e aciona "Pausar IA" / "Retomar IA"; a confirmação\n'
                     ' *          continua sendo do usuário, como no botão do painel\n')
SHORTCUTS_DOC_NEW = (' *   P      na conversa aberta, abre o painel do contato e aciona "Assumir conversa" / "Retomar IA"\n'
                     ' *          (a pausa da IA é imediata, como no botão da ficha do lead)\n')


def patch_shortcuts(s):
    s = rep(s, SHORTCUTS_DOC_OLD, SHORTCUTS_DOC_NEW, 'shortcuts: doc line')
    s = rep(s, "if (label === 'Pausar IA' || label === 'Retomar IA') return buttons[i];",
            "if (label === 'Assumir conversa' || label === 'Retomar IA') return buttons[i];",
            'shortcuts: finder')
    return SHORTCUTS_MARKER + '\n' + s


def patch_bundle(s):
    if BUNDLE_MARKER in s:
        return s
    s = patch_labels(s)
    s = patch_events(s)
    s = patch_billing(s)
    s = patch_help(s)
    s = patch_other_locales(s)
    s = patch_hardcoded(s)
    s = patch_dashboard(s)
    s = patch_chat(s)
    return BUNDLE_MARKER + '\n' + s


# ------------------------------------------------------------------------------------------------ index
def bump_bundle(html):
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


def bump_shortcuts(html):
    pattern = re.compile(r'(/assets/help-shortcuts\.js\?v=)(\d+)')

    def repl(match):
        if int(match.group(2)) >= int(SHORTCUTS_VERSION):
            return match.group(0)
        return match.group(1) + SHORTCUTS_VERSION

    return pattern.sub(repl, html)


def patch_html(html):
    if CSS_MARKER not in html:
        anchor = '    ' + DESIGN_MARKER
        if html.count(anchor) != 1:
            raise PatchError('index.html: design-system marker expected once (keep it as the last stylesheet)')
        html = html.replace(anchor, '    ' + CSS_MARKER + '\n' + CSS_LINK + anchor, 1)
    return bump_shortcuts(bump_bundle(html))


def shortcuts_ok(s):
    return (SHORTCUTS_MARKER in s and
            "if (label === 'Assumir conversa' || label === 'Retomar IA') return buttons[i];" in s)


def bundle_ok(s):
    checks = [
        BUNDLE_MARKER in s,
        'children:testing?\'Salvando...\':\'Salvar e validar\'' in s,
        'Nenhum vencimento previsto.' in s,
        "const GUIDE='/novidades';" in s,
        'Novidades do WhatsAI' in s,
        "['dashboard','Visão geral','grid']" in s,
        "children:'Voltar para instâncias'" in s,
        '"URL do webhook"' in s,
        '(!window.WaPortal||!window.WaPortal.client)?i.jsxs(\'a\'' in s,
        'children:waPhoneBR(g.ownerJid||g.number)})]})]})' + ',' + ACTIONS_JSX in s,
        'i.jsx(Badge,{tone:\'ok\',children:\'Ativa\'})]});' in s,
        "if(t==='Assumir conversa'||t==='Retomar IA')" in s,
        "['P','Assumir ou retomar a conversa aberta']" in s,
        '"Rejeitar chamadas"' in s,
        'markAll:"Marcar todos"' in s and 'markAll:"Marcar Todos"' not in s,
        'unMarkAll:"Desmarcar todos"' in s and 'unMarkAll:"Desmarcar Todos"' not in s,
        'label:"Ignorar Grupos"' not in s,
        'defaultSettings:"Configurações padrão"' in s,
        '>Enviar teste<' not in s,
        'Manual no GitHub' not in s,
    ]
    return all(checks)


def main():
    check = '--check' in sys.argv[1:]
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    shortcuts = open(SHORTCUTS, encoding='utf-8').read()

    missing = []
    if not bundle_ok(s):
        missing.append('bundle (labels/textos/layout)')
    if not shortcuts_ok(shortcuts):
        missing.append('help-shortcuts.js')
    if CSS_MARKER not in html or CSS_LINK not in html:
        missing.append('index.html: qa-painel-polish.css link')
    if bump_bundle(html) != html:
        missing.append('index.html: bundle ?v=')
    if bump_shortcuts(html) != html:
        missing.append('index.html: help-shortcuts.js ?v=')
    if not os.path.isfile(CSS):
        missing.append('qa-painel-polish.css')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/qa-painel-polish.css is missing')
    new_s = patch_bundle(s)
    new_shortcuts = shortcuts if SHORTCUTS_MARKER in shortcuts else patch_shortcuts(shortcuts)
    new_html = patch_html(html)

    if new_s != s:
        open(BUNDLE, 'w', encoding='utf-8').write(new_s)
    if new_shortcuts != shortcuts:
        open(SHORTCUTS, 'w', encoding='utf-8').write(new_shortcuts)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    print(f'ok: bundle ?v={CACHE_VERSION}, qa-painel-polish.css ?v={CSS_VERSION}, help-shortcuts.js ?v={SHORTCUTS_VERSION}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
