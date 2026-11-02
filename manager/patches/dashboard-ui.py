#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: Render-style instance dashboard, consistent header and a11y fixes.

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/dashboard-ui.css (a plain file, edited by hand, loaded after render-style.css).
The Conversas (chat) screen is out of scope: no anchor below touches the chat component, and dashboard-ui.css keeps
the original colour tokens while a chat ([data-wa-chat]) is on screen.

Bundle groups (each one is applied once and leaves a marker comment at the top of the bundle):
  dashboard - instance dashboard (PX) rebuilt as one instance card + three metric cards (.wa-dash*, .wa-metric*):
              avatar (profile picture or initial), instance name (the page <h1>) with a discreet status pill,
              profile name and the number formatted for Brazil ("(21) 96497-5815"; other countries "+<digits>",
              the raw JID stays in the title attribute), token as a labelled field, a callout with "Gerar QR Code"
              and "Gerar Código de Pareamento" while the instance is not connected, and the actions "Atualizar"
              (icon, aria-label), "Reiniciar" (secondary) and "Desconectar" (outlined destructive) which now asks
              for confirmation in a dialog (Radix Dialog already in the bundle). Labels are no longer upper-cased.
              Metrics are a <dl>: small label + icon on top, large number below. The QR and pairing dialogs get a
              real DialogTitle/Description (no Radix console warnings, no <div> inside <p>). Same handlers, same
              API calls, same QR polling (it still looks for `[role="dialog"] svg.rounded-sm`).
  token     - token field (c_, shared with the instance list): class .wa-token and labelled icon buttons
              ("Copiar token", "Mostrar token"/"Ocultar token"); copying no longer throws where the Clipboard API
              is missing or refused (insecure origin, permissions): it shows an error toast instead.
  status    - status badge (l_, shared with the instance list): class .wa-status + data-wa-status (ok/warn/bad).
  header    - logout is a neutral outlined icon button with aria-label/title "Sair" (red only on hover), the
              language button gets the same class and a title; the logout dialog has a visible title and a
              description, the empty DialogClose that took the first focus is gone, both buttons have one size.
  titles    - the title of every settings/events/integrations page (14 pages) is its <h1> (.wa-page-title); they
              were <h3> and those pages had no <h1>.
  list      - instance list cards show the number with the same formatting as the dashboard (waPhoneBR).
  labels    - icon-only buttons without an accessible name get one: the settings cog of each instance card
              (it only had a tooltip) and the OpenAI credentials "+" next to the credentials select.
  sidebar   - the overlay links of the instance menu get an accessible name and aria-current="page"; the button
              around them leaves the tab order (it did nothing on Enter, the link inside is what navigates).
index.html group (marker: an HTML comment in <head>):
  html      - links dashboard-ui.css?v=1 after render-style.css. The bundle ?v= is NOT changed here.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.
Order: run after the other scripts (it needs responsive.py, render-style.py and login-clean.py applied).

Usage (from the repository root):
  python3 -I manager/patches/dashboard-ui.py           # apply
  python3 -I manager/patches/dashboard-ui.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
REQUIRED = (
    '/*whatsai-patch:responsive:drawer*/',
    '/*whatsai-patch:responsive:titles*/',
    '/*whatsai-patch:render-style:brand*/',
    '/*whatsai-patch:render-style:sidebar*/',
    '/*whatsai-patch:render-style:dashboard*/',
    '/*whatsai-patch:login-clean:login*/',
)


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:dashboard-ui:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:dashboard-ui:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# --------------------------------------------------------------------------------------------- dashboard
# Minified names (bundle index-b29a5d7a.js), inside PX (instance dashboard): e = t(), n = Intl.NumberFormat,
# r = QR code, o = pairing code, g = instance, b = refresh, w = restart, C = logout (disconnect), k = connect,
# j = dialog cleanup, M = counts, _ = QR colour. So/Co/Eo/Vh = Card parts, Ei/ki = Avatar/AvatarImage,
# Pt/Bt/Nt/Mt/zt/eo/Yt/$M = Dialog/Trigger/Content/Header/Title/Description/Footer/Close, se = Button,
# rI/sI = Alert/AlertTitle, MX = QRCode, On = spinner, Ip/pT/jB/Bl = refresh/contacts/users/message icons.
DASH_OLD = (
    'return g?i.jsxs("main",{className:"flex flex-col gap-8",children:[i.jsx("section",{children:i.jsxs(So,{childre'
    'n:[i.jsx(Co,{children:i.jsxs("div",{className:"flex flex-wrap items-center justify-between gap-4",children:[i.'
    'jsx("h1",{className:"break-all text-lg font-semibold",children:g.name}),i.jsx(l_,{status:g.connectionStatus})]'
    '})}),i.jsxs(Eo,{className:"flex flex-col items-start space-y-6",children:[i.jsx("div",{className:"flex w-full '
    'flex-1",children:i.jsx(c_,{token:g.token})}),g.profileName&&i.jsxs("div",{className:"flex flex-1 gap-2",childr'
    'en:[i.jsx(Ei,{children:i.jsx(ki,{src:g.profilePicUrl,alt:""})}),i.jsxs("div",{className:"space-y-1",children:['
    'i.jsx("strong",{children:g.profileName}),i.jsx("p",{className:"break-all text-sm text-muted-foreground",childr'
    'en:g.ownerJid})]})]}),g.connectionStatus!=="open"&&i.jsxs(rI,{variant:"warning",className:"flex flex-wrap item'
    's-center justify-between gap-3",children:[i.jsx(sI,{className:"text-lg font-bold tracking-wide",children:e("in'
    'stance.dashboard.alert")}),i.jsxs(Pt,{children:[i.jsx(Bt,{onClick:()=>k(g.name,!1),asChild:!0,children:i.jsx(s'
    'e,{variant:"warning",children:e("instance.dashboard.button.qrcode.label")})}),i.jsxs(Nt,{onCloseAutoFocus:j,ch'
    'ildren:[i.jsx(zt,{className:"sr-only",children:e("instance.dashboard.button.qrcode.title")}),i.jsx(Mt,{childre'
    'n:e("instance.dashboard.button.qrcode.title")}),i.jsx("div",{className:"flex items-center justify-center",chil'
    'dren:r&&i.jsx(MX,{value:r,size:256,bgColor:"transparent",fgColor:_,className:"rounded-sm"})})]})]}),g.number&&'
    'i.jsxs(Pt,{children:[i.jsx(Bt,{className:"connect-code-button",onClick:()=>k(g.name,!0),children:e("instance.d'
    'ashboard.button.pairingCode.label")}),i.jsx(Nt,{onCloseAutoFocus:j,children:i.jsx(Mt,{children:i.jsx(eo,{child'
    'ren:o?i.jsxs("div",{className:"py-3",children:[i.jsx("p",{className:"text-center",children:i.jsx("strong",{chi'
    'ldren:e("instance.dashboard.button.pairingCode.title")})}),i.jsxs("p",{className:"pairing-code text-center",ch'
    'ildren:[o.substring(0,4),"-",o.substring(4,8)]})]}):i.jsx(On,{})})})})]})]})]}),i.jsxs(Vh,{className:"flex fle'
    'x-wrap items-center justify-end gap-3",children:[i.jsx(se,{variant:"outline",className:"refresh-button",size:"'
    'icon",onClick:b,children:i.jsx(Ip,{size:"20"})}),i.jsx(se,{className:"action-button",variant:"secondary",onCli'
    'ck:()=>w(g.name),children:e("instance.dashboard.button.restart").toUpperCase()}),i.jsx(se,{variant:"destructiv'
    'e",onClick:()=>C(g.name),disabled:g.connectionStatus==="close",children:e("instance.dashboard.button.disconnec'
    't").toUpperCase()})]})]})}),i.jsxs("section",{className:"grid grid-cols-[repeat(auto-fit,_minmax(15rem,_1fr))]'
    ' gap-6",children:[i.jsxs(So,{className:"instance-card",children:[i.jsx(Co,{children:i.jsxs(gi,{className:"flex'
    ' items-center gap-2",children:[i.jsx(pT,{size:"20"}),e("instance.dashboard.contacts")]})}),i.jsx(Eo,{children:'
    'n.format(M.contacts)})]}),i.jsxs(So,{className:"instance-card",children:[i.jsx(Co,{children:i.jsxs(gi,{classNa'
    'me:"flex items-center gap-2",children:[i.jsx(jB,{size:"20"}),e("instance.dashboard.chats")]})}),i.jsx(Eo,{chil'
    'dren:n.format(M.chats)})]}),i.jsxs(So,{className:"instance-card",children:[i.jsx(Co,{children:i.jsxs(gi,{class'
    'Name:"flex items-center gap-2",children:[i.jsx(Bl,{size:"20"}),e("instance.dashboard.messages")]})}),i.jsx(Eo,'
    '{children:n.format(M.messages)})]})]})]}):i.jsx(On,{})}'
)

# Number shown under the profile name: Brazilian numbers as "(21) 96497-5815", others as "+<digits>",
# anything that is not a plain number (e.g. @lid) as it came.
PHONE_FN = (
    'function waPhoneBR(e){if(!e)return"";const t=String(e).split("@")[0].split(":")[0];'
    'if(!/^\\d+$/.test(t))return String(e);if(t.startsWith("55")&&(t.length===12||t.length===13)){'
    'const n=t.slice(2,4),r=t.slice(4);return`(${n}) ${r.slice(0,r.length-4)}-${r.slice(-4)}`}return"+"+t}'
)


def metric(label_key, icon, value):
    return (
        'i.jsxs("div",{className:"wa-metric",children:[i.jsxs("dt",{className:"wa-metric-head",children:['
        'i.jsx("span",{className:"wa-metric-label",children:e("instance.dashboard.' + label_key + '")}),'
        'i.jsx(' + icon + ',{size:"16",className:"wa-metric-icon","aria-hidden":"true"})]}),'
        'i.jsx("dd",{className:"wa-metric-value",children:n.format(M.' + value + ')})]})'
    )


QR_DIALOG = (
    'i.jsxs(Pt,{children:[i.jsx(Bt,{onClick:()=>k(g.name,!1),asChild:!0,children:i.jsx(se,{'
    'children:e("instance.dashboard.button.qrcode.label")})}),i.jsxs(Nt,{onCloseAutoFocus:j,className:"wa-qr-dialog",'
    'children:[i.jsxs(Mt,{children:[i.jsx(zt,{children:e("instance.dashboard.button.qrcode.title")}),'
    'i.jsx(eo,{children:"No celular: WhatsApp › Aparelhos conectados › Conectar um aparelho."})]}),'
    'i.jsx("div",{className:"wa-qr-box",children:r?i.jsx(MX,{value:r,size:256,bgColor:"transparent",fgColor:_,'
    'className:"rounded-sm"}):i.jsx("p",{className:"wa-dialog-wait",role:"status",children:"Gerando QR code…"})})]})]})'
)
PAIRING_DIALOG = (
    'g.number&&i.jsxs(Pt,{children:[i.jsx(Bt,{onClick:()=>k(g.name,!0),asChild:!0,children:i.jsx(se,{'
    'variant:"outline",className:"connect-code-button",children:e("instance.dashboard.button.pairingCode.label")})}),'
    'i.jsxs(Nt,{onCloseAutoFocus:j,children:[i.jsxs(Mt,{children:[i.jsx(zt,{children:'
    'e("instance.dashboard.button.pairingCode.title")}),i.jsx(eo,{children:"No celular: WhatsApp › Aparelhos '
    'conectados › Conectar um aparelho › Conectar com número de telefone, e digite o código."})]}),'
    'o?i.jsxs("p",{className:"pairing-code wa-pairing-code",children:[o.substring(0,4),"-",o.substring(4,8)]}):'
    'i.jsx("p",{className:"wa-dialog-wait",role:"status",children:"Gerando código…"})]})]})'
)
ALERT = (
    'g.connectionStatus!=="open"&&i.jsxs("div",{className:"wa-dash-alert",children:[i.jsxs("div",'
    '{className:"wa-dash-alert-text",children:[i.jsx("strong",{children:g.connectionStatus==="connecting"?'
    '"Aguardando conexão":"Instância desconectada"}),i.jsx("span",{children:e("instance.dashboard.alert")})]}),'
    'i.jsxs("div",{className:"wa-dash-alert-actions",children:[' + QR_DIALOG + ',' + PAIRING_DIALOG + ']})]})'
)
DISCONNECT = (
    'i.jsxs(Pt,{children:[i.jsx(Bt,{asChild:!0,children:i.jsx(se,{variant:"destructive",className:"wa-btn-danger",'
    'disabled:g.connectionStatus==="close",children:e("instance.dashboard.button.disconnect")})}),'
    'i.jsxs(Nt,{className:"wa-confirm",children:[i.jsxs(Mt,{children:[i.jsx(zt,{children:"Desconectar o WhatsApp?"}),'
    'i.jsx(eo,{children:`A instância "${g.name}" para de enviar e receber mensagens até ser conectada de novo '
    'pelo QR code ou pelo código de pareamento.`})]}),i.jsxs(Yt,{className:"wa-confirm-foot",children:['
    'i.jsx($M,{asChild:!0,children:i.jsx(se,{variant:"outline",children:"Cancelar"})}),'
    'i.jsx($M,{asChild:!0,children:i.jsx(se,{variant:"destructive",onClick:()=>C(g.name),'
    'children:e("instance.dashboard.button.disconnect")})})]})]})]})'
)
DASH_NEW = (
    'return g?i.jsxs("main",{className:"wa-dash",children:[i.jsxs("section",{className:"wa-dash-card",'
    '"aria-labelledby":"wa-dash-title",children:[i.jsxs("div",{className:"wa-dash-head",children:['
    'i.jsx(Ei,{className:"wa-dash-avatar",children:g.profilePicUrl?i.jsx(ki,{src:g.profilePicUrl,alt:""}):'
    'i.jsx("span",{className:"wa-avatar-fallback","aria-hidden":"true",children:String(g.profileName||g.name||"?")'
    '.slice(0,1).toUpperCase()})}),i.jsxs("div",{className:"wa-dash-id",children:[i.jsxs("div",'
    '{className:"wa-dash-titlerow",children:[i.jsx("h1",{id:"wa-dash-title",className:"wa-dash-title",'
    'children:g.name}),i.jsx(l_,{status:g.connectionStatus})]}),(g.profileName||g.ownerJid||g.number)&&'
    'i.jsxs("p",{className:"wa-dash-profile",children:[g.profileName&&i.jsx("span",{className:"wa-dash-pname",'
    'children:g.profileName}),(g.ownerJid||g.number)&&i.jsx("span",{className:"wa-dash-phone",'
    'title:g.ownerJid||void 0,children:waPhoneBR(g.ownerJid||g.number)})]})]})]}),'
    'i.jsxs("div",{className:"wa-dash-field",children:[i.jsx("span",{className:"wa-dash-label",'
    'children:"Token da instância"}),i.jsx(c_,{token:g.token,className:"wa-dash-token"})]}),' + ALERT + ','
    'i.jsxs("div",{className:"wa-dash-actions",children:[i.jsx(se,{variant:"outline",size:"icon",'
    'className:"refresh-button wa-icon-btn",onClick:b,"aria-label":"Atualizar",title:"Atualizar",'
    'children:i.jsx(Ip,{size:"16","aria-hidden":"true"})}),i.jsxs("div",{className:"wa-dash-actions-main",'
    'children:[i.jsx(se,{variant:"outline",className:"action-button",onClick:()=>w(g.name),'
    'children:e("instance.dashboard.button.restart")}),' + DISCONNECT + ']})]})]}),'
    'i.jsxs("dl",{className:"wa-metrics","aria-label":"Números da instância",children:['
    + metric('contacts', 'pT', 'contacts') + ',' + metric('chats', 'jB', 'chats') + ','
    + metric('messages', 'Bl', 'messages') + ']})]}):i.jsx(On,{})}'
)


def patch_dashboard(s):
    s = rep(s, 'function PX(){const{t:e,i18n:t}=Ve()', PHONE_FN + 'function PX(){const{t:e,i18n:t}=Ve()',
            'dashboard phone helper')
    return rep(s, DASH_OLD, DASH_NEW, 'dashboard markup')


# ------------------------------------------------------------------------------------------------- token
def patch_token(s):
    s = rep(s,
            'const U5=e=>{navigator.clipboard.writeText(e),me.success("Copiado para a área de transferência")};',
            'const U5=e=>{const t=()=>me.error("Não foi possível copiar. Mostre o token e copie manualmente.");'
            'try{navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(e).then('
            '()=>me.success("Copiado para a área de transferência"),t):t()}catch{t()}};',
            'copy to clipboard')
    return rep(s,
               'i.jsxs("div",{className:Ie("flex items-center gap-3 truncate rounded-sm bg-primary/20 px-2 py-1",t),'
               'children:[i.jsx("pre",{className:"block truncate text-xs",children:n?e:e?.replace(/\\w/g,"*")}),'
               'i.jsx(se,{variant:"ghost",size:"icon",onClick:()=>{U5(e)},children:i.jsx(X$,{size:"15"})}),'
               'i.jsx(se,{variant:"ghost",size:"icon",onClick:()=>{r(s=>!s)},children:n?i.jsx(tB,{size:"15"}):'
               'i.jsx(nB,{size:"15"})})]})',
               'i.jsxs("div",{className:Ie("wa-token flex items-center gap-3 truncate rounded-sm bg-primary/20 px-2 py-1",t),'
               'children:[i.jsx("pre",{className:"block truncate text-xs",children:n?e:e?.replace(/\\w/g,"*")}),'
               'i.jsx(se,{variant:"ghost",size:"icon",onClick:()=>{U5(e)},"aria-label":"Copiar token",'
               'title:"Copiar token",children:i.jsx(X$,{size:"15","aria-hidden":"true"})}),'
               'i.jsx(se,{variant:"ghost",size:"icon",onClick:()=>{r(s=>!s)},"aria-label":n?"Ocultar token":'
               '"Mostrar token",title:n?"Ocultar token":"Mostrar token",children:n?i.jsx(tB,{size:"15",'
               '"aria-hidden":"true"}):i.jsx(nB,{size:"15","aria-hidden":"true"})})]})',
               'token field')


# ------------------------------------------------------------------------------------------------ status
def patch_status(s):
    return rep(s,
               'return e?e==="open"?i.jsx(vu,{children:t("status.open")}):e==="connecting"?i.jsx(vu,'
               '{variant:"warning",children:t("status.connecting")}):e==="close"||e==="closed"?i.jsx(vu,'
               '{variant:"destructive",children:t("status.closed")}):i.jsx(vu,{variant:"secondary",children:e}):null}',
               'return e?e==="open"?i.jsx(vu,{className:"wa-status","data-wa-status":"ok",children:t("status.open")}):'
               'e==="connecting"?i.jsx(vu,{variant:"warning",className:"wa-status","data-wa-status":"warn",'
               'children:t("status.connecting")}):e==="close"||e==="closed"?i.jsx(vu,{variant:"destructive",'
               'className:"wa-status","data-wa-status":"bad",children:t("status.closed")}):i.jsx(vu,'
               '{variant:"secondary",className:"wa-status",children:e}):null}',
               'status badge')


# ------------------------------------------------------------------------------------------------ header
# zM = header (n = open logout dialog, o = logout), iM = language menu (Wr = DropdownMenuTrigger, fB = icon).
def patch_header(s):
    s = rep(s,
            'i.jsx(Wr,{asChild:!0,children:i.jsxs(se,{variant:"outline",size:"icon",children:[i.jsx(fB,',
            'i.jsx(Wr,{asChild:!0,children:i.jsxs(se,{variant:"outline",size:"icon",className:"wa-hd-btn",'
            'title:e("header.language.label"),children:[i.jsx(fB,',
            'language button')
    s = rep(s,
            'i.jsx(iM,{}),i.jsx(se,{onClick:()=>n(!0),variant:"destructive",size:"icon",children:i.jsx(eB,{size:"18"})})',
            'i.jsx(iM,{}),i.jsx(se,{onClick:()=>n(!0),variant:"outline",size:"icon",className:"wa-hd-btn wa-hd-logout",'
            '"aria-label":"Sair",title:"Sair",children:i.jsx(eB,{size:"18","aria-hidden":"true"})})',
            'logout button')
    return rep(s,
               'i.jsxs(Nt,{children:[i.jsx($M,{}),i.jsx(zt,{className:"sr-only",children:"Sair"}),'
               'i.jsx(Mt,{children:"Deseja realmente sair?"}),i.jsx(Yt,{children:i.jsxs("div",'
               '{className:"flex items-center gap-4",children:[i.jsx(se,{onClick:()=>n(!1),size:"sm",'
               'variant:"outline",children:"Cancelar"}),i.jsx(se,{onClick:o,variant:"destructive",children:"Sair"})]})})]})',
               'i.jsxs(Nt,{className:"wa-confirm",children:[i.jsxs(Mt,{children:[i.jsx(zt,{children:"Sair do painel?"}),'
               'i.jsx(eo,{children:"Para entrar de novo você vai precisar da URL do servidor e da chave de API."})]}),'
               'i.jsxs(Yt,{className:"wa-confirm-foot",children:[i.jsx(se,{onClick:()=>n(!1),variant:"outline",'
               'children:"Cancelar"}),i.jsx(se,{onClick:o,variant:"destructive",children:"Sair"})]})]})',
               'logout dialog')


# ------------------------------------------------------------------------------------------------ titles
TITLES_MB = ('chatwoot', 'proxy', 'rabbitmq', 'settings', 'sqs', 'webhook', 'websocket')
TITLES = ('dify', 'evoai', 'evolutionBot', 'flowise', 'n8n', 'openai', 'typebot')


def patch_titles(s):
    for name in TITLES_MB:
        s = rep(s, 'i.jsx("h3",{className:"mb-1 text-lg font-medium",children:e("' + name + '.title")})',
                'i.jsx("h1",{className:"wa-page-title mb-1 text-lg font-medium",children:e("' + name + '.title")})',
                f'{name} page title')
    for name in TITLES:
        s = rep(s, 'i.jsx("h3",{className:"text-lg font-medium",children:e("' + name + '.title")})',
                'i.jsx("h1",{className:"wa-page-title text-lg font-medium",children:e("' + name + '.title")})',
                f'{name} page title')
    return s


# -------------------------------------------------------------------------------------------------- list
# instance list card (home-redesign.py markup): k = instance
def patch_list(s):
    return rep(s, 'i.jsx("p",{className:"text-sm text-muted-foreground",children:k.ownerJid&&k.ownerJid.split("@")[0]})',
               'i.jsx("p",{className:"text-sm text-muted-foreground",title:k.ownerJid||void 0,'
               'children:k.ownerJid&&waPhoneBR(k.ownerJid)})',
               'instance list number')


# ------------------------------------------------------------------------------------------------ labels
# FE = Tooltip, Oo = cog icon; LI = OpenAI credentials dialog (t = showText, n = t(), mB = lock icon, cs = plus).
def patch_labels(s):
    s = rep(s, 'i.jsx(FE,{content:e("dashboard.settings"),side:"top",children:i.jsx(se,{variant:"ghost",size:"icon",'
               'children:i.jsx(Oo,{className:"card-icon",size:"20"})})})',
            'i.jsx(FE,{content:e("dashboard.settings"),side:"top",children:i.jsx(se,{variant:"ghost",size:"icon",'
            '"aria-label":e("dashboard.settings"),children:i.jsx(Oo,{className:"card-icon",size:"20","aria-hidden":"true"})})})',
            'instance card settings button')
    return rep(s, 'i.jsx(se,{variant:"secondary",size:"sm",type:"button",children:t?i.jsxs(i.Fragment,{children:[i.jsx(mB,',
               'i.jsx(se,{variant:"secondary",size:"sm",type:"button","aria-label":t?void 0:n("openai.credentials.title"),'
               'title:t?void 0:n("openai.credentials.title"),children:t?i.jsxs(i.Fragment,{children:[i.jsx(mB,',
               'openai credentials button')


# ----------------------------------------------------------------------------------------------- sidebar
def patch_sidebar(s):
    return rep(s,
               'i.jsxs(se,{className:Ie("relative flex w-full items-center justify-start gap-2",u.isActive&&'
               '"pointer-events-none"),variant:u.isActive?"secondary":"link",children:["link"in u&&i.jsx("a",'
               '{href:u.link,target:"_blank",rel:"noreferrer",className:"absolute inset-0 h-full w-full"}),'
               '"path"in u&&i.jsx(Fu,{to:`/manager/instance/${s?.id}/${u.path}`,className:"absolute inset-0 h-full w-full"}),',
               'i.jsxs(se,{className:Ie("relative flex w-full items-center justify-start gap-2",u.isActive&&'
               '"pointer-events-none"),variant:u.isActive?"secondary":"link",tabIndex:-1,children:["link"in u&&'
               'i.jsx("a",{href:u.link,target:"_blank",rel:"noreferrer",className:"absolute inset-0 h-full w-full",'
               '"aria-label":u.title}),"path"in u&&i.jsx(Fu,{to:`/manager/instance/${s?.id}/${u.path}`,'
               'className:"absolute inset-0 h-full w-full","aria-label":u.title,'
               '"aria-current":u.isActive?"page":void 0}),',
               'sidebar links')


GROUPS = [
    ('dashboard', patch_dashboard),
    ('token', patch_token),
    ('status', patch_status),
    ('header', patch_header),
    ('titles', patch_titles),
    ('list', patch_list),
    ('labels', patch_labels),
    ('sidebar', patch_sidebar),
]


# -------------------------------------------------------------------------------------------- html
def patch_html(html):
    return rep(html, '    <link rel="stylesheet" href="/assets/render-style.css?v=2" />\n',
               '    <link rel="stylesheet" href="/assets/render-style.css?v=2" />\n'
               '    ' + html_marker('html') + '\n'
               '    <link rel="stylesheet" href="/assets/dashboard-ui.css?v=1" />\n',
               'index.html render-style.css link (run render-style.py and login-clean.py first)')


def main():
    check = '--check' in sys.argv[1:]
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    missing = [name for name, _ in GROUPS if marker(name) not in s]
    if html_marker('html') not in html:
        missing.append('html')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    for required in REQUIRED:
        if required not in s:
            raise PatchError(f'run the patch that adds {required} first')

    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = html
    if 'html' in missing:
        new_html = patch_html(new_html)
        report.append('html: applied')
    else:
        report.append('html: already applied')

    # everything validated: write
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        report.append('index.html written (dashboard-ui.css ?v=1)')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
