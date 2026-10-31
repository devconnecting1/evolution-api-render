#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: readable "Conversas" page (chat list, conversation header, message
bubbles, composer, empty/loading states).

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/chat-ui.css (a plain file, edited by hand, loaded after render-style.css).

Why: the upstream compiled CSS (index-DsIrum0U.css) paints the bubbles with fixed dark colours made for the dark
theme (.bubble-right .bubble #0a0a0a, .bubble-left .bubble #1b1b1b, .chat-item.active #2f2f2f) while the text
keeps the light-theme foreground (near black): sent and received messages were black on black. The markup now
uses its own classes (wa-*), so those rules no longer apply; chat-ui.css also overrides them for a cached old
bundle and for the embedded chat (/manager/embed-chat), which shares the conversation component.

Bundle groups (each one is applied once and leaves a marker comment at the top of the bundle):
  helpers      - module-level helpers and components, inserted before the conversation component (ZO):
                 Brazilian phone format "(21) 96647-6019" (other countries "+<digits>"), display name (a
                 pushName that is only digits/phone characters, or the instance's own profile name, is not a
                 name), initial avatar, last-message preview ("Você: …", "Foto", "Áudio", "Documento: …"),
                 list time (HH:MM, "Ontem", weekday, dd/mm/aa), chat list with search filter, skeleton rows,
                 empty/error states, message row (bubble + time, sender name in groups), document card.
  content      - message content (ek): the document card (icon, name, type and size in KB/MB, download link when
                 the API sends mediaUrl), Portuguese text for the audio fallback and for unsupported types, and
                 the date separator (cX: "Hoje", "Ontem", weekday, date).
  conversation - conversation component (ZO): header with avatar, name and formatted number on two lines (one line
                 with the formatted number when there is no real name; "Grupo" for groups) and a back link on
                 phones; the fake "GPT-4 / GPT-3" menu of the upstream template is removed; messages in a
                 scrolling log grouped by day, received on the left, sent on the right, consecutive messages of
                 the same side grouped; skeleton while loading, empty and error states; composer with a rounded
                 field, attach button, send button (enabled = accent with white icon, disabled = light grey),
                 the field stays focused while sending (readOnly instead of disabled) and a failed send shows a
                 toast. AI vs. human messages are not distinguished: the message object has no reliable field for
                 it (source is "web" for both, Message.sessionId is never filled, the bot id registry lives only
                 in the server cache).
  list         - chat page (tk): list header "Conversas" with a search field (name or number), Contatos/Grupos
                 tabs, rows as links (avatar, name, time, preview, unread badge), skeleton while loading,
                 empty/no-result/error states; "Selecione uma conversa" when no conversation is open (desktop);
                 the list panel starts at 32% (was 20%); scrolling to the newest message moves only the message
                 log (scrollIntoView also scrolled the page); the empty message field keeps one line (it was
                 measured before the panels had their width and grew to ~200px on desktop).
index.html group (marker: an HTML comment in <head>):
  html         - chat-ui.css?v=1 linked right before the bundle script (after every other stylesheet). The bundle
                 ?v= is not changed here.

Every anchor must match exactly once, otherwise the script stops without writing anything. The two large blocks
(conversation header and list panel) are replaced by span and checked by SHA-256.
Re-running is safe: groups whose marker is present are skipped.
Order: run after responsive.py (it keeps the data-wa-chat root and the back button that script adds).

Usage (from the repository root):
  python3 -I manager/patches/chat-ui.py           # apply
  python3 -I manager/patches/chat-ui.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import hashlib
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
REQUIRED = ('/*whatsai-patch:responsive:chat*/',)


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:chat-ui:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:chat-ui:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


def rep_span(s, start, end, digest, new, label):
    """Replace s[start .. end] (both anchors included, each unique) after checking the SHA-256 of that text."""
    if s.count(start) != 1:
        raise PatchError(f'{label}: start anchor expected once, got {s.count(start)}')
    i = s.index(start)
    j = s.find(end, i)
    if j < 0:
        raise PatchError(f'{label}: end anchor not found')
    j += len(end)
    got = hashlib.sha256(s[i:j].encode('utf-8')).hexdigest()
    if got != digest:
        raise PatchError(f'{label}: unexpected text (sha256 {got[:12]}…)')
    return s[:i] + new + s[j:]


# ------------------------------------------------------------------------------------------------ helpers
# Minified names (bundle index-b29a5d7a.js): i = jsx runtime, Ei / ki / Up = Avatar / AvatarImage / AvatarFallback,
# Ap = lucide User icon, Fu = react-router Link, Yv = message timestamp -> Date, ek = message content renderer.
SEND_PATHS = ('["M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 '
              '.682.627l18-8.5a.5.5 0 0 0 0-.904z","M6 12h16"]')
HELPERS = r'''function waCSvg(d,z){return i.jsx("svg",{xmlns:"http://www.w3.org/2000/svg",width:z||20,height:z||20,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",focusable:"false",children:d.map((p,k)=>i.jsx("path",{d:p},k))})}
function waCDigits(j){return String(j||"").split("@")[0].split(":")[0].replace(/\D/g,"")}
function waCIsGroup(j){return String(j||"").endsWith("@g.us")}
function waCPhone(j){const s=String(j||"");if(!s||waCIsGroup(s))return"";const d=waCDigits(s);if(!d)return s.split("@")[0];if(s.endsWith("@lid"))return d;if(d.startsWith("55")&&(d.length===12||d.length===13)){const r=d.slice(4);return"("+d.slice(2,4)+") "+r.slice(0,-4)+"-"+r.slice(-4)}return"+"+d}
function waCName(c){const n=String(c?.pushName||"").trim();return!n||/^[\d\s()+\-.]+$/.test(n)||n===String(c?.remoteJid||"").split("@")[0]?"":n}
function waCOwn(c,own){return c&&own&&String(c.pushName||"").trim()===String(own).trim()?{...c,pushName:""}:c}
function waCTitle(c){return waCName(c)||waCPhone(c?.remoteJid)||String(c?.remoteJid||"").split("@")[0]||"Conversa"}
function waCSub(c){return waCIsGroup(c?.remoteJid)?"Grupo":waCName(c)?waCPhone(c?.remoteJid):""}
function waCInitial(n){const m=String(n||"").match(/[\p{L}\p{N}]/u);return m?m[0].toUpperCase():""}
function waCNorm(v){return String(v||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim()}
function waCLast(c){return c?.lastMessage||(c?.message&&c?.key?c:null)}
function waCPreview(c){const m=waCLast(c);if(!m)return"";const g=m.message&&typeof m.message=="object"?m.message:{conversation:String(m.message||"")};let x;switch(m.messageType){case"conversation":x=typeof g.conversation=="string"&&g.conversation?g.conversation:g.contactMessage?"Contato":g.locationMessage?"Localização":"Mensagem";break;case"extendedTextMessage":x=g.extendedTextMessage?.text||g.conversation||"Mensagem";break;case"imageMessage":x="Foto"+(g.imageMessage?.caption?": "+g.imageMessage.caption:"");break;case"videoMessage":x="Vídeo"+(g.videoMessage?.caption?": "+g.videoMessage.caption:"");break;case"audioMessage":x="Áudio";break;case"documentMessage":case"documentWithCaptionMessage":x="Documento"+(g.documentMessage?.fileName?": "+g.documentMessage.fileName:"");break;case"stickerMessage":x="Figurinha";break;case"locationMessage":x="Localização";break;case"contactMessage":x="Contato";break;case"reactionMessage":x="Reação"+(g.reactionMessage?.text?" "+g.reactionMessage.text:"");break;default:x=typeof g.conversation=="string"&&g.conversation?g.conversation:"Mensagem"}const p=m.key?.fromMe?"Você: ":waCIsGroup(c?.remoteJid)&&m.pushName?m.pushName+": ":"";return(p+x).replace(/\s+/g," ").trim()}
function waCWhen(c){const m=waCLast(c),d=m&&m.messageTimestamp?Yv(m):c?.updatedAt?new Date(c.updatedAt):null;if(!d||isNaN(d.getTime()))return"";const n=new Date,o=new Date(n);o.setDate(n.getDate()-1);if(d.toDateString()===n.toDateString())return d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});if(d.toDateString()===o.toDateString())return"Ontem";if(n.getTime()-d.getTime()<6*864e5)return d.toLocaleDateString("pt-BR",{weekday:"short"}).replace(".","");return d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"2-digit"})}
function WaChatAvatar({chat:c,size:z}){const n=waCName(c);return i.jsxs(Ei,{className:"wa-chat-avatar"+(z==="lg"?" wa-chat-avatar--lg":""),children:[c?.profilePicUrl?i.jsx(ki,{src:c.profilePicUrl,alt:""}):null,i.jsx(Up,{className:"wa-chat-avatar-fallback",children:n?i.jsx("span",{"aria-hidden":"true",children:waCInitial(n)}):i.jsx(Ap,{className:"h-5 w-5","aria-hidden":"true"})})]})}
function WaChatEmpty({title:t,text:x}){return i.jsxs("div",{className:"wa-chat-empty",role:"status",children:[waCSvg(["M7.9 20A9 9 0 1 0 4 16.1L2 22Z"],28),i.jsx("p",{className:"wa-chat-empty-title",children:t}),x?i.jsx("p",{className:"wa-chat-empty-text",children:x}):null]})}
function WaChatSkeleton(){return i.jsxs("div",{className:"wa-chat-loading","aria-busy":"true",children:[i.jsx("span",{className:"sr-only",role:"status",children:"Carregando conversas…"}),i.jsx("ul",{className:"wa-chat-items","aria-hidden":"true",children:[62,48,70,55,40,66].map((w,k)=>i.jsxs("li",{className:"wa-chat-item wa-chat-item--sk",children:[i.jsx("span",{className:"wa-chat-sk wa-chat-sk--avatar"}),i.jsxs("span",{className:"wa-chat-item-main",children:[i.jsx("span",{className:"wa-chat-sk",style:{width:w+"%"}}),i.jsx("span",{className:"wa-chat-sk wa-chat-sk--thin",style:{width:w+18+"%"}})]})]},k))})]})}
function WaChatList({items:a,kind:k,loading:l,error:e,query:q,active:v,instanceId:h,own:o}){const w=k==="groups"?"@g.us":"@s.whatsapp.net",all=(a||[]).filter(c=>c&&typeof c.remoteJid=="string"&&c.remoteJid.includes(w)).map(c=>waCOwn(c,o)),nq=waCNorm(q),dq=String(q||"").replace(/\D/g,""),list=nq?all.filter(c=>waCNorm(waCTitle(c)+" "+(c.pushName||"")).includes(nq)||dq.length>1&&waCDigits(c.remoteJid).includes(dq)):all;if(!all.length){if(l)return i.jsx(WaChatSkeleton,{});if(e)return i.jsx(WaChatEmpty,{title:"Não foi possível carregar as conversas",text:"Verifique a conexão com o servidor e tente de novo."});return i.jsx(WaChatEmpty,{title:k==="groups"?"Nenhum grupo":"Nenhuma conversa ainda",text:k==="groups"?"Os grupos aparecem aqui quando houver mensagens neles.":"As conversas aparecem aqui quando a instância enviar ou receber mensagens."})}if(!list.length)return i.jsx(WaChatEmpty,{title:"Nada encontrado",text:"Nenhuma conversa corresponde a “"+String(q).trim()+"”."});return i.jsx("ul",{className:"wa-chat-items",children:list.map(c=>{const u=Number(c.unreadCount)||0;return i.jsx("li",{children:i.jsxs(Fu,{to:"/manager/instance/"+h+"/chat/"+c.remoteJid,className:"wa-chat-item","aria-current":v===c.remoteJid?"page":void 0,children:[i.jsx(WaChatAvatar,{chat:c}),i.jsxs("span",{className:"wa-chat-item-main",children:[i.jsxs("span",{className:"wa-chat-item-row",children:[i.jsx("span",{className:"wa-chat-item-name",children:waCTitle(c)}),i.jsx("span",{className:"wa-chat-item-time"+(u?" is-unread":""),children:waCWhen(c)})]}),i.jsxs("span",{className:"wa-chat-item-row",children:[i.jsx("span",{className:"wa-chat-item-preview",children:waCPreview(c)||waCSub(c)}),u?i.jsxs("span",{className:"wa-chat-unread",children:[u>99?"99+":u,i.jsx("span",{className:"sr-only",children:u===1?" mensagem não lida":" mensagens não lidas"})]}):null]})]})]})},c.remoteJid)})})}
function WaChatIdle(){return i.jsx("div",{className:"wa-conv wa-conv-idle",children:i.jsx(WaChatEmpty,{title:"Selecione uma conversa",text:"Escolha um contato na lista para ver as mensagens e responder."})})}
function WaChatMsg({message:m,cont:c,group:g}){const o=!!m?.key?.fromMe,d=Yv(m),t=!isNaN(d.getTime()),a=g&&!o&&!c&&m.pushName?String(m.pushName):"";return i.jsx("div",{className:"wa-msg "+(o?"wa-msg--out":"wa-msg--in")+(c?" wa-msg--cont":""),children:i.jsxs("div",{className:"wa-bubble wa-type-"+String(m?.messageType||"text").replace(/[^\w-]/g,""),children:[i.jsx("span",{className:"sr-only",children:o?"Você: ":(a||"Contato")+": "}),a?i.jsx("span",{className:"wa-bubble-author","aria-hidden":"true",children:a}):null,i.jsx("div",{className:"wa-bubble-body",children:i.jsx(ek,{message:m})}),t?i.jsx("time",{className:"wa-bubble-time",dateTime:d.toISOString(),children:d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}):null]})})}
function WaChatDoc({doc:d,url:u}){const n=String(d?.fileName||d?.title||"Documento"),z=Number(d?.fileLength?.low??d?.fileLength)||0,sz=z?z<1048576?Math.max(1,Math.round(z/1024))+" KB":(z/1048576).toFixed(1).replace(".",",")+" MB":"",x=n.includes(".")?n.split(".").pop().toUpperCase():"",meta=[x.length>0&&x.length<=5?x:"",sz].filter(Boolean).join(" · "),body=[i.jsx("span",{className:"wa-doc-icon",children:waCSvg(["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z","M14 2v4a2 2 0 0 0 2 2h4","M16 13H8","M16 17H8","M10 9H8"],22)},"i"),i.jsxs("span",{className:"wa-doc-text",children:[i.jsx("span",{className:"wa-doc-name",children:n}),meta?i.jsx("span",{className:"wa-doc-meta",children:meta}):null]},"t")];return u?i.jsx("a",{className:"wa-doc",href:u,target:"_blank",rel:"noopener noreferrer",download:n,children:body}):i.jsx("div",{className:"wa-doc",children:body})}
'''


def patch_helpers(s):
    anchor = 'function ZO({textareaRef:e,handleTextareaChange:t,textareaHeight:n,lastMessageRef:r,scrollToBottom:s}){'
    return rep(s, anchor, HELPERS + anchor, 'helpers (before the conversation component)')


# ------------------------------------------------------------------------------------------------ content
DOC_OLD = (
    'case"documentMessage":return i.jsxs("div",{className:"flex items-center gap-2 p-3 bg-muted rounded-lg max-w-xs",'
    'children:[i.jsx("div",{className:"text-2xl",children:"📄"}),i.jsxs("div",{className:"flex-1 min-w-0",children:['
    'i.jsx("p",{className:"font-medium truncate",children:e.message.documentMessage?.fileName||"Document"}),'
    'e.message.documentMessage?.fileLength&&i.jsxs("p",{className:"text-xs text-muted-foreground",children:['
    '(e.message.documentMessage.fileLength/1024/1024).toFixed(2)," MB"]})]})]});'
)
DOC_NEW = 'case"documentMessage":return i.jsx(WaChatDoc,{doc:e.message.documentMessage,url:e.message.mediaUrl});'
DATE_OLD = (
    'cX=({date:e})=>i.jsx("div",{className:"flex items-center justify-center py-4",children:i.jsx("div",'
    '{className:"rounded-full bg-muted px-3 py-1",children:i.jsx("span",{className:"text-sm font-medium '
    'text-muted-foreground",children:e})})})'
)
DATE_NEW = 'cX=({date:e})=>i.jsx("div",{className:"wa-day-sep",children:i.jsx("span",{children:e})})'


def patch_content(s):
    s = rep(s, DOC_OLD, DOC_NEW, 'document message')
    s = rep(s, '"Your browser does not support the audio element."', '"Seu navegador não reproduz este áudio."',
            'audio fallback text')
    s = rep(s, 'i.jsxs("summary",{children:["Unknown message type: ",t]})',
            'i.jsxs("summary",{children:["Mensagem não suportada: ",t]})', 'unknown message type')
    return rep(s, DATE_OLD, DATE_NEW, 'date separator')


# ------------------------------------------------------------------------------------------- conversation
# In ZO: o = instance, l/u = text state, d = sending, h/m = selected media, C = remoteJid, N = chat (findChats),
# O/D = messages query, Q = messages grouped by day, k / j = send text / media, M = send, _ = keydown, R = change.
BUBBLES_OLD = (
    'const pe=G=>i.jsx("div",{className:"bubble-right",children:i.jsx("div",{className:"flex items-start gap-4 '
    'self-end",children:i.jsx("div",{className:"grid gap-1",children:i.jsx("div",{className:"bubble",children:'
    'i.jsx(ek,{message:G})})})})},G.id),V=G=>i.jsx("div",{className:"bubble-left",children:i.jsx("div",'
    '{className:"flex items-start gap-4",children:i.jsx("div",{className:"grid gap-1",children:i.jsx("div",'
    '{className:"bubble",children:i.jsx(ek,{message:G})})})})},G.id);'
)
BUBBLES_NEW = (
    'const waConv=waCOwn(N?{remoteJid:C,...N}:{remoteJid:C},o?.profileName),waSub=waCSub(waConv),'
    'pe=(G,W)=>i.jsx(WaChatMsg,{message:G,cont:W,group:waCIsGroup(C)},G.key?.id||G.id),V=pe;'
)
HEAD_START = ('return i.jsxs("div",{className:"flex h-full flex-col",children:[i.jsx("div",{className:"sticky top-0 '
              'bg-background border-b border-border p-3"')
HEAD_END = 'children:"Ideal para tarefas do dia a dia"})]})]})]})]})]})}),'
HEAD_SHA = '973857d0a7a84f8649e50cb4a75e98641b24da60c688e76c81d43d7a1d383dff'
HEAD_NEW = (
    'return i.jsxs("div",{className:"wa-conv flex h-full flex-col",children:[i.jsxs("header",{className:"wa-conv-head",'
    'children:[waInst?i.jsx(Fu,{to:`/manager/instance/${waInst}/chat`,className:"wa-conv-back",'
    '"aria-label":"Voltar para as conversas",children:waCSvg(["m15 18-6-6 6-6"],22)}):null,'
    'i.jsx(WaChatAvatar,{chat:waConv,size:"lg"}),i.jsxs("div",{className:"wa-conv-head-text",children:['
    'i.jsx("h2",{className:"wa-conv-title",children:waCTitle(waConv)}),'
    'waSub?i.jsx("p",{className:"wa-conv-sub",children:waSub}):null]})]}),'
)
LOG_OLD = (
    'i.jsxs("div",{className:"message-container mx-auto flex max-w-4xl flex-1 flex-col gap-2 overflow-y-auto px-2",'
    'children:[Q.map((G,W)=>i.jsxs("div",{children:[i.jsx(cX,{date:G.date}),i.jsx("div",{className:"flex flex-col '
    'gap-2",children:G.messages.map(ie=>ie.key.fromMe?pe(ie):V(ie))})]},W)),i.jsx("div",{ref:r})]}),'
)
LOG_NEW = (
    'i.jsxs("div",{className:"wa-conv-scroll",role:"log","aria-label":"Mensagens",children:[Q.length?null:'
    'waMsgLoading?i.jsxs("div",{className:"wa-conv-loading","aria-busy":"true",children:[i.jsx("span",'
    '{className:"sr-only",role:"status",children:"Carregando mensagens…"}),[46,32,58,28,50].map((sz,ix)=>'
    'i.jsx("div",{className:"wa-msg "+(ix%2?"wa-msg--out":"wa-msg--in"),"aria-hidden":"true",children:'
    'i.jsx("span",{className:"wa-chat-sk wa-chat-sk--bubble",style:{width:sz+"%"}})},ix))]}):'
    'i.jsx(WaChatEmpty,{title:waMsgError?"Não foi possível carregar as mensagens":"Nenhuma mensagem ainda",'
    'text:waMsgError?"Verifique a conexão com o servidor e tente de novo.":"Envie a primeira mensagem pelo campo '
    'abaixo."}),Q.map((G,W)=>i.jsxs("section",{className:"wa-day","aria-label":G.date,children:[i.jsx(cX,'
    '{date:G.date}),G.messages.map((ie,ix,arr)=>pe(ie,ix>0&&!!arr[ix-1].key?.fromMe===!!ie.key?.fromMe))]},W)),'
    'i.jsx("div",{ref:r,className:"wa-conv-end"})]}),'
)
COMPOSER_OLD = (
    'i.jsxs("div",{className:"sticky bottom-0 mx-auto flex w-full max-w-2xl flex-col gap-1.5 bg-background px-2 py-2",'
    'children:[h&&i.jsx(QO,{selectedMedia:h,setSelectedMedia:m}),i.jsxs("div",{className:"flex items-center '
    'rounded-3xl border border-border bg-background px-2 py-1",children:[o&&i.jsx(JO,{instance:o,setSelectedMedia:m}),'
    'i.jsx(bi,{placeholder:"Enviar mensagem...",name:"message",id:"message",rows:1,ref:e,value:l,onChange:R,'
    'onKeyDown:_,disabled:d,style:{height:n},className:"min-h-0 w-full resize-none border-none p-3 '
    'focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-transparent focus-visible:ring-offset-0 '
    'focus-visible:ring-offset-transparent"}),i.jsxs(se,{type:"button",size:"icon",onClick:M,disabled:!l.trim()&&!h||d,'
    'className:"rounded-full p-2 disabled:opacity-50",children:[i.jsx(Th,{className:"h-6 w-6"}),i.jsx("span",'
    '{className:"sr-only",children:"Enviar"})]})]})]})]})}const dX='
)
COMPOSER_NEW = (
    'i.jsxs("div",{className:"wa-composer",children:[h&&i.jsx(QO,{selectedMedia:h,setSelectedMedia:m}),'
    'i.jsxs("div",{className:"wa-composer-box",children:[o&&i.jsx(JO,{instance:o,setSelectedMedia:m}),'
    'i.jsx(bi,{placeholder:h?"Legenda (opcional)":"Digite uma mensagem","aria-label":h?"Legenda":"Mensagem",'
    'name:"message",id:"message",rows:1,ref:e,value:l,onChange:R,onKeyDown:_,readOnly:d,'
    '"aria-busy":d?"true":void 0,style:{height:n},className:"wa-composer-input min-h-0 w-full resize-none '
    'border-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"}),'
    'i.jsx(se,{type:"button",size:"icon",onClick:M,disabled:!l.trim()&&!h||d,'
    '"aria-label":d?"Enviando…":"Enviar mensagem",title:"Enviar (Enter)",className:"wa-chat-send",'
    'children:waCSvg(' + SEND_PATHS + ',20)})]})]})]})}const dX='
)


def patch_conversation(s):
    s = rep(s, '{remoteJid:C}=ls(),k=async()=>{', '{remoteJid:C,instanceId:waInst}=ls(),k=async()=>{',
            'conversation route params')
    s = rep(s, 'console.error("Error sending message:",G)',
            'console.error("Error sending message:",G),me.error("Não foi possível enviar a mensagem.")', 'send error')
    s = rep(s, 'console.error("Error sending media:",G)',
            'console.error("Error sending media:",G),me.error("Não foi possível enviar o arquivo.")', 'media error')
    s = rep(s, '{data:O,isSuccess:D}=rX({remoteJid:C,instanceName:o?.name})',
            '{data:O,isSuccess:D,isLoading:waMsgLoading,isError:waMsgError}=rX({remoteJid:C,instanceName:o?.name})',
            'messages query state')
    s = rep(s, 'className:"rounded-full p-2",children:[i.jsx(cs,{className:"h-6 w-6",style:{color:n}})',
            'className:"wa-chat-attach rounded-full p-2",children:[i.jsx(cs,{className:"h-6 w-6",style:{color:n}})',
            'attach button')
    s = rep(s, BUBBLES_OLD, BUBBLES_NEW, 'message bubbles')
    s = rep_span(s, HEAD_START, HEAD_END, HEAD_SHA, HEAD_NEW, 'conversation header')
    s = rep(s, LOG_OLD, LOG_NEW, 'message log')
    return rep(s, COMPOSER_OLD, COMPOSER_NEW, 'composer')


# ---------------------------------------------------------------------------------------------------- list
# In tk: s = instance, o/l = websocket chats, u = findChats data, f = merged chats, h = instanceId, m = remoteJid,
# t = last-message ref, r = textarea ref, b = textarea resize, x = scroll to the newest message.
LIST_START = ('i.jsx(Hn,{defaultSize:20,children:i.jsxs("div",{className:"hidden h-full flex-col bg-background '
              'text-foreground md:flex"')
LIST_END = 'scrollToBottom:x})})'
LIST_SHA = '420040c19b0d18eb89a2341826299cf49cc492060b4dc572a3ce213a9874135f'
LIST_NEW = (
    'i.jsx(Hn,{defaultSize:32,minSize:22,maxSize:50,children:i.jsxs("div",{className:"wa-chat-list hidden h-full '
    'flex-col md:flex",children:[i.jsxs("div",{className:"wa-chat-listhead",children:[i.jsx("h2",'
    '{className:"wa-chat-listtitle",children:"Conversas"}),i.jsxs("div",{className:"wa-chat-search",role:"search",'
    'children:[waCSvg(["m21 21-4.3-4.3","M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"],18),i.jsx("input",{type:"search",'
    'value:waQ,onChange:ev=>waSetQ(ev.target.value),placeholder:"Buscar nome ou número",'
    '"aria-label":"Buscar conversa por nome ou número",autoComplete:"off",spellCheck:!1,enterKeyHint:"search"})]})]}),'
    'i.jsxs(Yx,{defaultValue:"contacts",className:"wa-chat-tabs flex min-h-0 flex-1 flex-col",children:['
    'i.jsxs(hg,{className:"tabs-chat wa-chat-tablist flex-shrink-0",children:[i.jsx(Jl,{value:"contacts",'
    'children:"Contatos"}),i.jsx(Jl,{value:"groups",children:"Grupos"})]}),'
    'i.jsx(Ql,{value:"contacts",className:"wa-chat-tabpanel flex-1 overflow-hidden",children:i.jsx("div",'
    '{className:"h-full overflow-auto",children:i.jsx(WaChatList,{items:u,kind:"contacts",loading:waLoading,'
    'error:waError,query:waQ,active:m,instanceId:h,own:s?.profileName})})}),'
    'i.jsx(Ql,{value:"groups",className:"wa-chat-tabpanel flex-1 overflow-hidden",children:i.jsx("div",'
    '{className:"h-full overflow-auto",children:i.jsx(WaChatList,{items:f,kind:"groups",loading:waLoading,'
    'error:waError,query:waQ,active:m,instanceId:h,own:s?.profileName})})})]})]})}),'
    'i.jsx(Bo,{withHandle:!0,className:"wa-chat-handle"}),i.jsx(Hn,{children:m?i.jsx(ZO,{textareaRef:r,'
    'handleTextareaChange:b,textareaHeight:n,lastMessageRef:t,scrollToBottom:x}):i.jsx(WaChatIdle,{})})'
)


def patch_list(s):
    s = rep(s, 'r=y.useRef(null),{instance:s}=ct(),[o,l]=y.useState([]),{data:u,isSuccess:d}=sY({instanceName:s?.name})',
            'r=y.useRef(null),{instance:s}=ct(),[o,l]=y.useState([]),[waQ,waSetQ]=y.useState(""),'
            '{data:u,isSuccess:d,isLoading:waLoading,isError:waError}=sY({instanceName:s?.name})', 'chat list state')
    s = rep(s, 'x=y.useCallback(()=>{t.current&&t.current.scrollIntoView({})},[])',
            'x=y.useCallback(()=>{const el=t.current,sc=el&&el.closest(".wa-conv-scroll");'
            'sc?(sc.scrollTop=sc.scrollHeight):el&&el.scrollIntoView({block:"nearest"})},[])', 'scroll to newest')
    # the field is measured when a conversation opens, before the panels have their width: the placeholder
    # wrapped letter by letter and the empty field grew to ~200px. An empty field keeps its one-line height.
    s = rep(s, 'b=()=>{if(r.current){r.current.style.height="auto";const C=',
            'b=()=>{if(r.current){r.current.style.height="auto";if(!r.current.value)return;const C=', 'field height')
    return rep_span(s, LIST_START, LIST_END, LIST_SHA, LIST_NEW, 'chat list panel')


GROUPS = [('helpers', patch_helpers), ('content', patch_content), ('conversation', patch_conversation),
          ('list', patch_list)]


# -------------------------------------------------------------------------------------------------- html
def patch_html(html):
    anchor = '    <script type="module" crossorigin src="/assets/index-b29a5d7a.js?v='
    return rep(html, anchor, '    ' + html_marker('html') + '\n'
               '    <link rel="stylesheet" href="/assets/chat-ui.css?v=1" />\n' + anchor, 'index.html bundle script')


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
        report.append('index.html written (chat-ui.css ?v=1)')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
