#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager bundle: the panel is Brazilian Portuguese ONLY.

Same method as the other scripts in manager/patches: exact string replacements on the minified bundle.
  picker   - the language picker (header button with the translate icon, aria-label/title "Idioma", and its menu
             with Portugues / English / Espanol / Francais) is gone: the component iM (used in the Manager header
             and in the sign-in top bar) now renders nothing. The span is checked by SHA-256.
  i18n     - i18next always starts in pt-BR: lng is the constant "pt-BR" (the localStorage "i18nextLng" and the
             browser language are ignored), fallbackLng and supportedLngs are pt-BR, and only the pt-BR
             resources are registered (no key can fall back to English, Spanish or French). A visitor who had
             picked another language before has the stored "i18nextLng" overwritten with "pt-BR" on load.
  texts    - hardcoded English that users could see, now in Portuguese:
               * react-query retry toast ("The application is taking longer than expected...");
               * "Error: ..." toasts of the settings/bot forms (28 calls) -> "Erro: ..." (the other toasts of the
                 panel already said "Erro:"); "Instance not found." toast;
               * form validation: "serverUrl is required", "ApiKey is required", "Invalid URL format" and the
                 default zod messages "Required" / "Expected X, received Y";
               * placeholder of the tag fields ("Press enter to add new tag") and the aria-label of the toast timer;
               * pt-BR resources that were still English: "Push Name", "Session ID", "Basic Auth User/Password".
             API paths, keys and code identifiers are not touched (console.error messages stay as they are).
  messages - Conversas: WhatsApp reactions no longer render as "Mensagem nao suportada: reactionMessage". A
             reactionMessage is a small chip ("Reagiu com <emoji>"), hidden when the emoji is empty (reaction
             removed); protocolMessage, senderKeyDistributionMessage and messageContextInfo are hidden (WaChatMsg
             renders nothing); any other unknown type shows a neutral "Mensagem não suportada" without the
             technical type name or the raw JSON.
The landing page, the manual (readme-tab.*, readmes/) and observability already are Portuguese with
<html lang="pt-BR">; nothing to change there.
Applying also bumps the bundle ?v= in index.html to CACHE_VERSION (only raised, never lowered).

Every anchor must match exactly once (or the expected number of times, stated next to it), otherwise the script
stops without writing anything. Re-running is safe: when the marker is present the bundle is left alone.
Order: run after minimal.py (the last patch that touches the bundle before this one).

Usage (from the repository root):
  python3 -I manager/patches/ptbr-only.py           # apply
  python3 -I manager/patches/ptbr-only.py --check   # exit 1 unless applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import hashlib
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CACHE_VERSION = '18'
MARKER = '/*whatsai-patch:ptbr-only:v1*/'
REQUIRED = ('/*whatsai-patch:minimal:lid*/', '/*whatsai-patch:chat-ui:list*/')


class PatchError(Exception):
    pass


def rep(s, old, new, label, count=1):
    n = s.count(old)
    if n != count:
        raise PatchError(f'{label}: expected {count} match(es), got {n}')
    return s.replace(old, new)


# Minified names (bundle index-b29a5d7a.js): iM = language picker, lM = theme picker (next function), Jn = i18next
# instance, TF = react-i18next plugin, Ooe/eie/sae/Mae = en-US/pt-BR/es-ES/fr-FR resources, me = toast.

# ------------------------------------------------------------------------------------------------ picker
PICKER_START = 'function iM(){const{t:e,i18n:t}=Ve(),n=r=>{t.changeLanguage(r),localStorage.setItem("i18nextLng",r),window.location.reload()};'
PICKER_END = '}function lM(){'
PICKER_DIGEST = '54c0a54e38e50c974a6461a582718577146446fb4020eabeea851f332ac279a9'


def patch_picker(s):
    # The checked span goes from "function iM(){" to the closing brace of iM (right before "function lM(){").
    i = s.index(PICKER_START) if s.count(PICKER_START) == 1 else -1
    if i < 0:
        raise PatchError('language picker: start anchor expected once')
    j = s.find(PICKER_END, i)
    if j < 0:
        raise PatchError('language picker: end anchor not found')
    old = s[i:j + 1]  # up to and including the closing brace of iM
    got = hashlib.sha256(old.encode('utf-8')).hexdigest()
    if got != PICKER_DIGEST:
        raise PatchError(f'language picker: unexpected text (sha256 {got[:12]}...)')
    return s[:i] + 'function iM(){return null}' + s[j + 1:]


# ------------------------------------------------------------------------------------------------ i18n
I18N_OLD = ('Jn.use(TF).init({resources:{"en-US":{translation:Ooe},"pt-BR":{translation:eie},"es-ES":{translation:sae},'
            '"fr-FR":{translation:Mae}},lng:localStorage.getItem("i18nextLng")||"pt-BR",fallbackLng:"pt-BR",interpolation:{escapeValue:!1}});')
I18N_NEW = ('try{localStorage.setItem("i18nextLng","pt-BR")}catch(_e){}'
            'Jn.use(TF).init({resources:{"pt-BR":{translation:eie}},lng:"pt-BR",fallbackLng:"pt-BR",supportedLngs:["pt-BR"],'
            'interpolation:{escapeValue:!1}});')


def patch_i18n(s):
    return rep(s, I18N_OLD, I18N_NEW, 'i18n init')


# ------------------------------------------------------------------------------------------------ texts
def patch_texts(s):
    s = rep(s, 'me.error("The application is taking longer than expected to load, please try again in a few minutes."',
            'me.error("O servidor está demorando para responder. Tente novamente em alguns minutos."', 'retry toast')
    s = rep(s, 'me.error(`Error: ${', 'me.error(`Erro: ${', 'Error: toasts', 28)
    s = rep(s, 'me.error("Instance not found.")', 'me.error("Instância não encontrada.")', 'instance not found toast')
    s = rep(s, 'required_error:"serverUrl is required"', 'required_error:"Informe a URL do servidor"', 'serverUrl required')
    s = rep(s, 'required_error:"ApiKey is required"', 'required_error:"Informe a API Key"', 'apiKey required')
    s = rep(s, 'url("Invalid URL format")', 'url("URL inválida")', 'webhook url message')
    s = rep(s, 'e.received===Le.undefined?n="Required":n=`Expected ${e.expected}, received ${e.received}`',
            'e.received===Le.undefined?n="Campo obrigatório":n=`Valor inválido: esperado ${e.expected}, recebido ${e.received}`',
            'zod default messages')
    s = rep(s, 's7="Press enter to add new tag"', 's7="Pressione Enter para adicionar"', 'tag placeholder')
    s = rep(s, '"aria-label":"notification timer"', '"aria-label":"temporizador da notificação"', 'toast timer label')
    # pt-BR resources still in English (the block between the pt-BR theme labels and the i18n init)
    a = s.find('Aae={theme:{label:"Mudar Tema"')
    b = s.find('Jn.use(TF).init')
    if s.count('Aae={theme:{label:"Mudar Tema"') != 1 or b < a:
        raise PatchError('pt-BR resources: block anchors not found')
    block = s[a:b]
    block = rep(block, 'pushName:"Push Name"', 'pushName:"Nome do contato"', 'pt-BR pushName', 2)
    block = rep(block, 'sessionId:"Session ID"', 'sessionId:"ID da sessão"', 'pt-BR sessionId', 2)
    block = rep(block, 'basicAuthUser:{label:"Basic Auth User"}', 'basicAuthUser:{label:"Usuário (Basic Auth)"}', 'pt-BR basicAuthUser')
    block = rep(block, 'basicAuthPass:{label:"Basic Auth Password"}', 'basicAuthPass:{label:"Senha (Basic Auth)"}', 'pt-BR basicAuthPass')
    return s[:a] + block + s[b:]


# ------------------------------------------------------------------------------------------------ messages
MSG_OLD = 'function WaChatMsg({message:m,cont:c,group:g}){const o=!!m?.key?.fromMe,'
MSG_NEW = ('function WaChatMsg({message:m,cont:c,group:g}){const wt=String(m?.messageType||"");'
           'if(wt==="protocolMessage"||wt==="senderKeyDistributionMessage"||wt==="messageContextInfo")return null;'
           'if(wt==="reactionMessage"){const em=String(m?.message?.reactionMessage?.text||"").trim();if(!em)return null;'
           'return i.jsx("div",{className:"wa-msg "+(m?.key?.fromMe?"wa-msg--out":"wa-msg--in")+(c?" wa-msg--cont":""),'
           'children:i.jsxs("span",{className:"wa-react-chip",style:{fontSize:12,lineHeight:"18px",padding:"1px 8px",'
           'borderRadius:999,border:"1px solid #e5e7eb",background:"#fff",color:"#374151"},children:["Reagiu com ",em]})})}'
           'const o=!!m?.key?.fromMe,')
UNSUP_OLD = ('children:i.jsxs("details",{children:[i.jsxs("summary",{children:["Mensagem não suportada: ",t]}),'
             'i.jsx("pre",{className:"mt-2 whitespace-pre-wrap break-all text-xs",children:JSON.stringify(e.message,null,2)})]})})')
UNSUP_NEW = 'children:"Mensagem não suportada"})'


def patch_messages(s):
    s = rep(s, MSG_OLD, MSG_NEW, 'chat message wrapper')
    return rep(s, UNSUP_OLD, UNSUP_NEW, 'unknown message type')


def apply_all(s):
    return patch_messages(patch_texts(patch_i18n(patch_picker(s))))


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
        print('ok: all groups applied' if ok else 'missing: ptbr-only' if not applied else 'missing: index.html cache version')
        return 0 if ok else 1

    for required in REQUIRED:
        if required not in bundle:
            raise PatchError(f'run the patch that adds {required} first')

    new_bundle = bundle
    if not applied:
        new_bundle = MARKER + apply_all(bundle)  # nothing is written if any anchor fails
        print('ptbr-only: applied')
    else:
        print('ptbr-only: already applied')
    new_html = bump_cache(html)

    if new_bundle != bundle:
        with open(BUNDLE, 'w', encoding='utf-8') as f:
            f.write(new_bundle)
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
