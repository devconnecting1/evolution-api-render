#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: minimal light theme (reference: OpenAI gpt-oss playground) plus
on-demand media and older-message paging in "Conversas".

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The look lives in manager/dist/assets/minimal.css (a plain file, edited by hand, linked after every other
stylesheet). This script only does what CSS cannot:

Bundle groups (each one is applied once and leaves a marker comment at the top of the bundle):
  chat-title  - the "Conversas" list title is the page <h1> (it was an <h2>: the chat page had no h1).
  chat-start  - the empty conversation area (desktop, no conversation open) is a playground-like start screen:
                "Selecione uma conversa" and four real links of the panel (OpenAI bots and sessions,
                instance overview, behaviour settings, Observabilidade).
  composer    - a small note under the pill-shaped message field ("Enter envia · Shift+Enter quebra a linha").
  older       - paging of the conversation. POST /chat/findMessages returns the 50 newest messages (page 1) with
                messages.total / pages / currentPage; the panel never asked for more, so long conversations looked
                cut. findMessages now records pages per instance+chat (waMsgMeta) and the conversation shows a
                "Carregar mensagens anteriores" pill at the top while currentPage < pages: it asks for the next
                page, merges it above (dedup by key.id) and keeps the scroll position; small spinner while
                loading; a toast on failure. The state is tied to the open chat, so switching chats starts again
                at page 1 (a late answer for another chat is ignored).
  media       - media without storage: in production there is no S3/MinIO, so image/audio/video/document/sticker
                messages have no message.mediaUrl nor base64 and the WhatsApp URLs are encrypted (.enc).
                The bubbles now ask POST /chat/getBase64FromMediaMessage/:instance (body {message:{key}},
                convertToMp4:false) on demand and show the result as a Blob URL:
                  image / sticker - jpegThumbnail first (if the message has one), real image when the bubble
                                    comes near the screen (IntersectionObserver);
                  audio / video   - "Carregar áudio" / "Carregar vídeo" button, then the player (autoplay);
                  document        - card with name/size and a "Baixar" button that downloads the file.
                At most 2 requests at a time (queue), results cached in memory by message id, loading spinner,
                error state "Mídia indisponível — pode ter expirado no WhatsApp." with "Tentar de novo".
                message.mediaUrl / base64, when present (storage enabled), are used directly.
  lid         - newer backends return one chat per contact with remoteJid = phone JID and remoteJidAlt = LID.
                The open conversation keeps that LID and also accepts WebSocket messages that arrive under it
                (key.remoteJid = LID, or key.remoteJidAlt = phone JID); the chat list maps such an event to the
                listed chat instead of adding a second row. Without remoteJidAlt (older backend) nothing changes.
                (Requests always use remoteJid.)
index.html group (marker: an HTML comment in <head>):
  html        - minimal.css?v=1 linked last (right before the bundle script), theme-color #ffffff, bundle ?v=17.
  css-cache   - new ?v= for the stylesheets whose token blocks moved to minimal.css (home.css 3, render-style.css 3,
                dashboard-ui.css 2, chat-ui.css 2).

Every anchor must match exactly once, otherwise the script stops without writing anything. The media cases of
the message renderer are replaced by span and checked by SHA-256.
Re-running is safe: groups whose marker is present are skipped.
Order: run after chat-ui.py (it provides WaChatIdle, WaChatDoc, waCSvg and the wa-* chat markup).

Usage (from the repository root):
  python3 -I manager/patches/minimal.py           # apply
  python3 -I manager/patches/minimal.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import hashlib
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'minimal.css')
REQUIRED = ('/*whatsai-patch:chat-ui:helpers*/', '/*whatsai-patch:chat-ui:content*/',
            '/*whatsai-patch:chat-ui:conversation*/', '/*whatsai-patch:chat-ui:list*/')
CACHE_VERSION = '17'
SCRIPT_TAG = '<script type="module" crossorigin src="/assets/index-b29a5d7a.js?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:minimal:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:minimal:' + name + ' -->'


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


# Minified names (bundle index-b29a5d7a.js): i = jsx runtime, y = React, Ee = axios instance of the API (adds the
# base URL and the apikey), me = toast, Fu = react-router Link, ls = useParams, UM = instance context,
# ZO = conversation component, nX = findMessages request, ek = message content renderer, WaChatDoc / WaChatEmpty /
# waCSvg = helpers of chat-ui.py.

# ------------------------------------------------------------------------------------------------ chat-title
def patch_chat_title(s):
    return rep(s, 'i.jsx("h2",{className:"wa-chat-listtitle",children:"Conversas"})',
               'i.jsx("h1",{className:"wa-chat-listtitle",children:"Conversas"})', 'chat list title')


# ------------------------------------------------------------------------------------------------ chat-start
IDLE_OLD = ('function WaChatIdle(){return i.jsx("div",{className:"wa-conv wa-conv-idle",children:i.jsx(WaChatEmpty,'
            '{title:"Selecione uma conversa",text:"Escolha um contato na lista para ver as mensagens e responder."})})}')
IDLE_NEW = (
    'function WaChatIdle(){const{instanceId:h}=ls(),b="/manager/instance/"+h+"/",s=['
    '["openai","Configurar a IA","bots, credenciais e sessões pausadas",["M12 8V4H8","M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z","M2 14h2","M20 14h2","M15 13v2","M9 13v2"]],'
    '["dashboard","Ver a visão geral","conexão, token e números da instância",["M3 3h7v7H3z","M14 3h7v7h-7z","M14 14h7v7h-7z","M3 14h7v7H3z"]],'
    '["settings","Ajustar o comportamento","chamadas, grupos e leitura de mensagens",["M4 21v-7","M4 10V3","M12 21v-9","M12 8V3","M20 21v-5","M20 12V3","M2 14h4","M10 8h4","M18 16h4"]],'
    '["observability","Acompanhar a observabilidade","uso e limites dos provedores",["M22 12h-4l-3 9L9 3l-3 9H2"]]];'
    'return i.jsx("div",{className:"wa-conv wa-conv-idle",children:i.jsxs("div",{className:"wa-start",children:['
    'i.jsx("h2",{className:"wa-start-title",children:"Selecione uma conversa"}),'
    'i.jsx("p",{className:"wa-start-text",children:"Escolha um contato na lista para ver as mensagens e responder, ou vá direto para:"}),'
    'i.jsx("ul",{className:"wa-start-list",children:s.map(([p,t,x,d])=>i.jsx("li",{children:i.jsxs(Fu,{to:b+p,className:"wa-start-link",'
    'children:[waCSvg(d,18),i.jsxs("span",{children:[t,i.jsx("span",{className:"wa-start-hint",children:" · "+x})]})]})},p))})]})})}')


def patch_chat_start(s):
    return rep(s, IDLE_OLD, IDLE_NEW, 'empty conversation area')


# ------------------------------------------------------------------------------------------------ composer
def patch_composer(s):
    return rep(s, ',20)})]})]})]})}const dX=',
               ',20)})]}),i.jsx("p",{className:"wa-composer-note",children:"Enter envia · Shift+Enter quebra a linha"})]})]})}const dX=',
               'composer end')


# ------------------------------------------------------------------------------------------------ older
OLDER_STATE = (
    '[waOlder,waSetOlder]=y.useState({j:"",l:[],p:1,n:1}),[waMore,waSetMore]=y.useState(""),waScRef=y.useRef(null),'
    'waRestore=y.useRef(null),waSkip=y.useRef(!1),'
    'z=y.useMemo(()=>{if(!O)return g;const G=new Map;return(waOlder.j===C?waOlder.l:[]).forEach(W=>{W?.key?.id&&G.set(W.key.id,W)}),'
    'O.forEach(W=>G.set(W.key.id,W)),g.forEach(W=>{G.set(W.key.id,W)}),Array.from(G.values())},[O,g,waOlder,C]),'
    'waCur=waOlder.j===C?waOlder.p:1,waPages=Math.max(waOlder.j===C?waOlder.n:1,waMsgMeta.get((o?.name||"")+"|"+C)?.pages||1),'
    'waLoadMore=async()=>{if(waMore===C||!o?.name||!C)return;const jid=C,next=waCur+1;waSetMore(jid);try{'
    'const res=await Ee.post(`/chat/findMessages/${o.name}`,{where:{key:{remoteJid:jid}},page:next}),mm=res.data?.messages||{},'
    'rec=Array.isArray(mm.records)?mm.records:[],sc=waScRef.current;waRestore.current=sc?sc.scrollHeight-sc.scrollTop:null;'
    'waSetOlder(p=>({j:jid,l:[...rec,...(p.j===jid?p.l:[])],p:next,n:Number(mm.pages)||next}))}'
    'catch(err){console.error("Error loading older messages:",err),me.error("Não foi possível carregar as mensagens anteriores.")}'
    'finally{waSetMore(v=>v===jid?"":v)}};'
    'y.useLayoutEffect(()=>{const sc=waScRef.current;if(sc&&waRestore.current!=null){sc.scrollTop=sc.scrollHeight-waRestore.current,'
    'waRestore.current=null,waSkip.current=!0}},[waOlder]);')
MORE_BUTTON = (
    'Q.length&&waCur<waPages?i.jsx("div",{className:"wa-conv-more",children:i.jsxs("button",{type:"button",className:"wa-more-btn",'
    'onClick:waLoadMore,disabled:waMore===C,"aria-busy":waMore===C?"true":void 0,children:[waMore===C?i.jsx("span",'
    '{className:"wa-spin","aria-hidden":"true"}):null,waMore===C?"Carregando mensagens…":"Carregar mensagens anteriores"]})}):null,')


def patch_older(s):
    s = rep(s, 'return n.data?.messages?.records?n.data.messages.records:n.data}',
            'return n.data?.messages?.records?(waMsgMeta.set(e+"|"+t,{pages:Number(n.data.messages.pages)||1,'
            'total:Number(n.data.messages.total)||0}),n.data.messages.records):n.data}', 'findMessages request')
    s = rep(s, 'z=y.useMemo(()=>{if(!O)return g;const G=new Map;return O.forEach(W=>G.set(W.key.id,W)),g.forEach(W=>{G.set(W.key.id,W)}),'
               'Array.from(G.values())},[O,g]);', OLDER_STATE, 'conversation messages memo')
    s = rep(s, 'y.useEffect(()=>{D&&z&&s()},[D,z,s])',
            'y.useEffect(()=>{if(waSkip.current){waSkip.current=!1;return}D&&z&&s()},[D,z,s])', 'scroll to newest')
    return rep(s, 'i.jsxs("div",{className:"wa-conv-scroll",role:"log","aria-label":"Mensagens",children:[',
               'i.jsxs("div",{ref:waScRef,className:"wa-conv-scroll",role:"log","aria-label":"Mensagens",children:[' + MORE_BUTTON,
               'message log')


# ------------------------------------------------------------------------------------------------ media
MEDIA_HELPERS = r'''var waMsgMeta=new Map,waMedCache=new Map,waMedQ=[],waMedRun=0;
function waMedPump(){for(;waMedRun<2&&waMedQ.length;){const t=waMedQ.shift();waMedRun++,t().finally(()=>{waMedRun--,waMedPump()})}}
function waMedFetch(inst,m){const id=m?.key?.id;if(!id||!inst)return Promise.reject(new Error("media: no message id"));const hit=waMedCache.get(id);if(hit)return hit;const p=new Promise((res,rej)=>{waMedQ.push(()=>Ee.post(`/chat/getBase64FromMediaMessage/${inst}`,{message:{key:{id,remoteJid:m.key.remoteJid,fromMe:!!m.key.fromMe}},convertToMp4:!1}).then(r=>{const d=r.data||{};if(!d.base64)throw new Error("media: empty answer");const mt=String(d.mimetype||"application/octet-stream").split(";")[0].trim(),b=atob(String(d.base64).replace(/^data:[^,]*,/,"")),u=new Uint8Array(b.length);for(let k=0;k<b.length;k++)u[k]=b.charCodeAt(k);res({url:URL.createObjectURL(new Blob([u],{type:mt})),mime:mt,name:String(d.fileName||"")})}).catch(e=>{waMedCache.delete(id),rej(e)}));waMedPump()});return waMedCache.set(id,p),p}
function waMedThumb(x){if(!x)return"";if(typeof x=="string")return x.startsWith("data:")?x:"data:image/jpeg;base64,"+x;if(typeof x=="object"){const v=Array.isArray(x)?x:Object.values(x);if(!v.length)return"";let s="";for(const c of v)s+=String.fromCharCode(Number(c)&255);return"data:image/jpeg;base64,"+btoa(s)}return""}
function waMedDirect(m,kind){const x=m?.message||{};if(x.mediaUrl)return String(x.mediaUrl);if(x.base64){const b=String(x.base64);return b.startsWith("data:")?b:"data:"+(String(x[kind+"Message"]?.mimetype||"").split(";")[0]||{image:"image/jpeg",video:"video/mp4",audio:"audio/ogg",sticker:"image/webp",document:"application/octet-stream"}[kind])+";base64,"+b}return""}
function useWaMedia(m,kind,auto){const ctx=y.useContext(UM),inst=ctx?.instance?.name||new URLSearchParams(window.location.search).get("instanceName")||"",direct=waMedDirect(m,kind),[st,setSt]=y.useState(direct?{s:"ok",url:direct}:{s:"idle"}),ref=y.useRef(null),id=m?.key?.id,load=y.useCallback(()=>direct?Promise.resolve({url:direct}):(setSt({s:"loading"}),waMedFetch(inst,m).then(r=>(setSt({s:"ok",...r}),r),e=>{throw setSt({s:"err"}),e})),[inst,id,direct]);y.useEffect(()=>{if(!auto||st.s!=="idle")return;const el=ref.current;if(!el)return;if(typeof IntersectionObserver=="undefined"){load().catch(()=>{});return}const io=new IntersectionObserver(es=>{es.some(v=>v.isIntersecting)&&(io.disconnect(),load().catch(()=>{}))},{rootMargin:"200px 0px"});return io.observe(el),()=>io.disconnect()},[auto,st.s,load]);return{st,load,ref}}
function WaMedSpin(){return i.jsx("span",{className:"wa-spin","aria-hidden":"true"})}
function WaMedErr({onRetry:r}){return i.jsxs("div",{className:"wa-media-err",children:[i.jsx("p",{children:"Mídia indisponível — pode ter expirado no WhatsApp."}),i.jsx("button",{type:"button",className:"wa-media-btn",onClick:r,children:"Tentar de novo"})]})}
function WaMedImage({m,kind:k}){const x=m?.message?.[k+"Message"]||{},{st,load,ref}=useWaMedia(m,k,!0),th=waMedThumb(x.jpegThumbnail||x.pngThumbnail),w=Number(x.width)||0,h=Number(x.height)||0,cap=k==="image"?String(x.caption||""):"",alt=k==="sticker"?"Figurinha":cap?"Imagem: "+cap.slice(0,80):"Imagem",fp={ref,className:"wa-media-frame","data-state":st.s,style:w&&h&&st.s!=="err"?{aspectRatio:w+" / "+h}:void 0},fr=st.s==="ok"?i.jsx("div",{...fp,children:i.jsx("img",{src:st.url,alt,decoding:"async"})}):st.s==="err"?i.jsx("div",{...fp,children:i.jsx(WaMedErr,{onRetry:()=>{load().catch(()=>{})}})}):i.jsxs("div",{...fp,children:[th?i.jsx("img",{src:th,alt:"",className:"wa-media-thumb"}):waCSvg(["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z","M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z","m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"],24),st.s==="loading"?i.jsx(WaMedSpin,{}):null,i.jsx("span",{className:"sr-only",children:k==="sticker"?"Figurinha carregando":"Imagem carregando"})]});return i.jsxs("div",{className:"wa-media wa-media--"+k,children:[fr,cap?i.jsx("p",{className:"wa-media-cap",children:cap}):null]})}
function WaMedPlay({m,kind:k}){const x=m?.message?.[k+"Message"]||{},{st,load}=useWaMedia(m,k,!1),auto=!waMedDirect(m,k),sec=Number(x.seconds)||0,dur=sec?Math.floor(sec/60)+":"+String(sec%60).padStart(2,"0"):"",cap=k==="video"?String(x.caption||""):"",lb=k==="audio"?"áudio":"vídeo",busy=st.s==="loading",md=st.s==="ok"?k==="audio"?i.jsx("audio",{controls:!0,autoPlay:auto,preload:"metadata",src:st.url,className:"wa-media-audio",children:"Seu navegador não reproduz este áudio."}):i.jsx("video",{controls:!0,autoPlay:auto,preload:"metadata",playsInline:!0,src:st.url,className:"wa-media-video"}):st.s==="err"?i.jsx(WaMedErr,{onRetry:()=>{load().catch(()=>{})}}):i.jsxs("button",{type:"button",className:"wa-media-load",onClick:()=>{load().catch(()=>{})},disabled:busy,"aria-busy":busy?"true":void 0,children:[busy?i.jsx(WaMedSpin,{}):waCSvg(["M6 4v16l14-8Z"],16),i.jsx("span",{children:busy?"Carregando "+lb+"…":"Carregar "+lb}),dur?i.jsx("span",{className:"wa-media-dur",children:dur}):null]});return i.jsxs("div",{className:"wa-media wa-media--"+k,children:[md,cap?i.jsx("p",{className:"wa-media-cap",children:cap}):null]})}
function WaMedDoc({m}){const x=m?.message?.documentMessage||{},{st,load}=useWaMedia(m,"document",!1),name=String(x.fileName||x.title||"documento"),busy=st.s==="loading",save=u=>{const a=document.createElement("a");a.href=u,a.download=name,a.rel="noopener",document.body.appendChild(a),a.click(),a.remove()},get=()=>{(st.s==="ok"?Promise.resolve(st):load()).then(r=>save(r.url)).catch(()=>{})};if(waMedDirect(m,"document"))return i.jsx(WaChatDoc,{doc:x,url:waMedDirect(m,"document")});return i.jsxs("div",{className:"wa-media wa-media--doc",children:[i.jsx(WaChatDoc,{doc:x}),st.s==="err"?i.jsx(WaMedErr,{onRetry:get}):i.jsxs("button",{type:"button",className:"wa-media-load",onClick:get,disabled:busy,"aria-busy":busy?"true":void 0,children:[busy?i.jsx(WaMedSpin,{}):waCSvg(["M12 15V3","M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4","m7 10 5 5 5-5"],16),i.jsx("span",{children:busy?"Baixando…":"Baixar"}),i.jsx("span",{className:"sr-only",children:" "+name})]})]})}
'''
EK_START = 'case"imageMessage":const r='
EK_END = 'alt:"Figurinha",className:"max-w-32 max-h-32 object-contain"});'
EK_SHA = 'ebde7089bbd3aea5fbafb548b5e77cad0be79e47f012c59c3c282fb3b12484cf'
EK_NEW = ('case"imageMessage":return i.jsx(WaMedImage,{m:e,kind:"image"});'
          'case"videoMessage":return i.jsx(WaMedPlay,{m:e,kind:"video"});'
          'case"audioMessage":return i.jsx(WaMedPlay,{m:e,kind:"audio"});'
          'case"documentMessage":return i.jsx(WaMedDoc,{m:e});'
          'case"stickerMessage":return i.jsx(WaMedImage,{m:e,kind:"sticker"});')


def patch_media(s):
    s = rep_span(s, EK_START, EK_END, EK_SHA, EK_NEW, 'media cases of the message renderer')
    return rep(s, 'function waCSvg(d,z){', MEDIA_HELPERS + 'function waCSvg(d,z){', 'chat helpers (waCSvg)')


# ------------------------------------------------------------------------------------------------ lid
def patch_lid(s):
    # conversation: remember the LID of the open chat (findChats returns remoteJidAlt) and accept WebSocket
    # messages whose key carries that LID, or the phone JID as key.remoteJidAlt
    s = rep(s, 'waSkip=y.useRef(!1),',
            'waSkip=y.useRef(!1),waAltRef=y.useRef(""),waAltSet=(waAltRef.current=String(N?.remoteJidAlt||"")),',
            'conversation refs (run the older group first)')
    s = rep(s, 'ie=(Y,H)=>{if(!o||H.instance!==o.name||H?.data?.key?.remoteJid!==C)return;',
            'ie=(Y,H)=>{const waK=H?.data?.key||{},waA=waAltRef.current;if(!o||H.instance!==o.name||!(waK.remoteJid===C||'
            'waK.remoteJidAlt===C||waA&&(waK.remoteJid===waA||waK.remoteJidAlt===waA)))return;', 'conversation socket filter')
    # chat list: a socket event under the LID of a listed chat updates that chat instead of adding a second row
    s = rep(s, '{data:u,isSuccess:d,isLoading:waLoading,isError:waError}=sY({instanceName:s?.name}),',
            '{data:u,isSuccess:d,isLoading:waLoading,isError:waError}=sY({instanceName:s?.name}),waChatsRef=y.useRef([]),'
            'waChatsSet=(waChatsRef.current=Array.isArray(u)?u:[]),', 'chat list query')
    return rep(s, 'const R=_?.data?.key?.remoteJid;R&&l(',
               'const waK=_?.data?.key||{},waR=waK.remoteJid,waHit=waR?waChatsRef.current.find(c=>c&&c.remoteJidAlt===waR):null,'
               'R=waHit?waHit.remoteJid:String(waR||"").endsWith("@lid")&&waK.remoteJidAlt&&!String(waK.remoteJidAlt).endsWith("@lid")'
               '?waK.remoteJidAlt:waR;R&&l(', 'chat list socket handler')


# the media group defines waMsgMeta, used by the older group: media goes first; lid needs older
GROUPS = [('chat-title', patch_chat_title), ('chat-start', patch_chat_start), ('composer', patch_composer),
          ('media', patch_media), ('older', patch_older), ('lid', patch_lid)]


# -------------------------------------------------------------------------------------------------- html
def patch_html(html):
    anchor = '    ' + SCRIPT_TAG
    html = rep(html, '<meta name="theme-color" content="#f6ffff" />', '<meta name="theme-color" content="#ffffff" />',
               'index.html theme-color')
    return rep(html, anchor, '    ' + html_marker('html') + '\n'
               '    <link rel="stylesheet" href="/assets/minimal.css?v=1" />\n' + anchor,
               'index.html bundle script (run chat-ui.py first)')


CSS_CACHE = [('/assets/home.css?v=2"', '/assets/home.css?v=3"'),
             ('/assets/render-style.css?v=2"', '/assets/render-style.css?v=3"'),
             ('/assets/dashboard-ui.css?v=1"', '/assets/dashboard-ui.css?v=2"'),
             ('/assets/chat-ui.css?v=1"', '/assets/chat-ui.css?v=2"')]


def patch_css_cache(html):
    """the older stylesheets lost their token blocks (now in minimal.css): new ?v= so no old copy is mixed in"""
    for old, new in CSS_CACHE:
        html = rep(html, old, new, 'index.html ' + old.split('?')[0])
    return rep(html, '    ' + html_marker('html') + '\n', '    ' + html_marker('html') + '\n    ' + html_marker('css-cache') + '\n',
               'index.html minimal marker')


def bump_index(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag not found exactly once')
    end = html.index('"', pos + len(SCRIPT_TAG))
    current = html[pos + len(SCRIPT_TAG):end]
    if not current.isdigit():
        raise PatchError(f'index.html: unexpected bundle version ?v={current}')
    if int(current) >= int(CACHE_VERSION):
        return html
    return html[:pos + len(SCRIPT_TAG)] + CACHE_VERSION + html[end:]


def main():
    check = '--check' in sys.argv[1:]
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    missing = [name for name, _ in GROUPS if marker(name) not in s]
    if html_marker('html') not in html:
        missing.append('html')
    elif bump_index(html) != html:
        missing.append('index.html cache version')
    if html_marker('css-cache') not in html:
        missing.append('css-cache')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/minimal.css is missing')
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
    if 'css-cache' in missing:
        new_html = patch_css_cache(new_html)
        report.append('css-cache: applied')
    else:
        report.append('css-cache: already applied')
    new_html = bump_index(new_html)

    # everything validated: write
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        report.append(f'index.html written (minimal.css ?v=1, bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
