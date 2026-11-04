#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: Twenty CRM component layout (view bar, record side panel, command
menu, breadcrumb page header, small buttons, empty states).

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/twenty-layout.css (a plain file, edited by hand, only var(--m-*) tokens of
minimal.css, linked last). Reference: twentyhq/twenty packages/twenty-front (ViewBar, RecordTable, RecordShowPage
side panel, CommandMenu) and packages/twenty-ui (IconButton 24px, Button small 28px, LightButton, Chip).

Data: only APIs the panel already calls. Sessions of the OpenAI bots (human pause) come from
GET /openai/fetchSessions/all/:instance (the sessions dialog of openai-fields.py), fetched once per instance and
cached for 60 s in memory; chats and messages reuse the react-query caches of the chat page (findChats /
findMessages). The only write is the explicit "Pausar IA" / "Retomar IA" button of the side panel, after a
confirmation dialog: POST /openai/changeStatus/:instance {remoteJid, status: "paused" | "opened"}, the same call
as the sessions dialog.

Bundle groups (each one is applied once and leaves a marker comment at the top of the bundle):
  component - WaTw, an isolated component module (IIFE) placed before the route table (after WaUsage):
              View (Conversas list: segmented "Todas · Não lidas · IA pausada · Grupos" with counts, view bar with
              "N conversas", "Filtro" popover (period of the last message: hoje / 7 / 30 dias; com mídia;
              aguardando resposta), "Ordenar" popover (mais recentes / não lidas primeiro / nome), active filter
              chips with ×, "IA pausada" badge on the rows, Twenty-like empty states; view kept in localStorage),
              Shell + HeadExtra + Panel (open conversation: 24px info toggle in the chat header, contact panel on
              the right, 320px on desktop, drawer/bottom sheet below 1024px: name/number, AI state "Ativa" /
              "Pausada até HH:MM" with the Pausar/Retomar button, message count, first/last message, unread, copy
              number, wa.me link), Crumbs (breadcrumb page header "Instâncias / <instância> / <página>"), Cmd +
              CmdButton (command menu on Ctrl/⌘+K and the "Buscar" button of the top bar: conversations by name or
              number, pages Visão Geral, Conversas, Plano e limites, OpenAI, Observabilidade, Comportamento, Manual;
              arrows/Home/End/Enter, Escape closes, focus returns to where it was).
  list      - chat page (tk): the Contatos/Grupos tabs are replaced by WaTw.View ("Grupos" is one of the views,
              "Todas" lists contacts and groups together); refetch of findChats for "Tentar de novo"; the open
              conversation is wrapped in WaTw.Shell.
  conv-head - conversation header: WaTw.HeadExtra ("IA pausada" badge + panel toggle) at the right.
  header    - top bar (zM, instance pages only): WaTw.Crumbs after the wordmark, WaTw.CmdButton before the avatar.
  layout    - instance layout (un): WaTw.Cmd mounted once (it needs the instance context).
index.html group (marker: an HTML comment in <head>):
  html      - links twenty-layout.css?v=1 after usage-limits.css and bumps the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.
Order: run after every other script (it needs chat-ui.py, minimal.py, chat-guards.py and usage-limits.py applied).

Usage (from the repository root):
  python3 -I manager/patches/twenty-layout.py           # apply
  python3 -I manager/patches/twenty-layout.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'twenty-layout.css')
REQUIRED = ('/*whatsai-patch:chat-ui:list*/', '/*whatsai-patch:chat-ui:conversation*/', '/*whatsai-patch:minimal:older*/',
            '/*whatsai-patch:chat-guards:v1*/', '/*whatsai-patch:usage-limits:component*/',
            '/*whatsai-patch:openai-fields:pause*/', '/*whatsai-patch:responsive:drawer*/')
CACHE_VERSION = '21'
SCRIPT_TAG = '<script type="module" crossorigin src="/assets/index-b29a5d7a.js?v='
CSS_ANCHOR = '    <link rel="stylesheet" href="/assets/usage-limits.css?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:twenty-layout:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:twenty-layout:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# Minified names (bundle index-b29a5d7a.js): i = jsx runtime, y = React, Ee = axios instance of the API, me = toast,
# Fu = react-router Link, dn = useNavigate, Pi = useLocation, Ve = useTranslation, ct = useInstance,
# Pt / Nt / Mt / zt / eo / Yt = Dialog / Content / Header / Title / Description / Footer, se = Button,
# sY = findChats query, rX = findMessages query, Yv = message timestamp -> Date, waMsgMeta = pages/total per chat
# (minimal.py), waC* / WaChatAvatar / WaChatSkeleton = chat helpers (chat-ui.py).
# tk = chat page (u = findChats, f = chats merged with WebSocket events, s = instance, h = instanceId,
# m = open remoteJid, waQ = search), ZO = conversation, zM = top bar (e = instanceId), un = instance layout.

COMPONENT = r'''const WaTw=(()=>{
  const nf=new Intl.NumberFormat('pt-BR');
  const MAC=typeof navigator!=='undefined'&&/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent||'');
  function ls_(k,v){try{if(v===void 0)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){}return null}
  function wide(){try{return window.matchMedia('(min-width: 1024px)').matches}catch(e){return!0}}
  const IC={
    panel:['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z','M15 3v18'],
    x:['M18 6 6 18','m6 6 12 12'],
    filter:['M3 6h18','M7 12h10','M10 18h4'],
    sort:['m3 16 4 4 4-4','M7 20V4','M11 4h10','M11 8h7','M11 12h4'],
    check:['M20 6 9 17l-5-5'],
    copy:['M10 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z','M4 16V5a1 1 0 0 1 1-1h11'],
    ext:['M15 3h6v6','M10 14 21 3','M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
    search:['m21 21-4.3-4.3','M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'],
    chat:['M7.9 20A9 9 0 1 0 4 16.1L2 22Z'],
    grid:['M4 3h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z','M14 3h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z','M14 13h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z','M4 13h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z'],
    gauge:['M12 14l4-4','M3.34 19a10 10 0 1 1 17.32 0'],
    bot:['M12 8V4H8','M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z','M2 14h2','M20 14h2','M15 13v2','M9 13v2'],
    pulse:['M22 12h-4l-3 9L9 3l-3 9H2'],
    book:['M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20'],
    cog:['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z','M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z'],
    phone:['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z'],
    users:['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z','M22 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75'],
    cal:['M8 2v4','M16 2v4','M3 10h18','M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'],
    msgs:['M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2Z','M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1'],
    spark:['M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2Z'],
    clock:['M12 6v6l4 2','M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],
    dot:['M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z','M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],
    pause:['M10 15V9','M14 15V9','M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],
    play:['m10 8 6 4-6 4V8Z','M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z']};
  function svg(name,size){const d=IC[name]||[];return i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:size||16,height:size||16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'1.6',strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',children:d.map((p,k)=>i.jsx('path',{d:p},k))});}
  function plural(n,one,many){return nf.format(n)+' '+(n===1?one:many);}

  /* ---------------------------------------------------------------- OpenAI sessions (IA pausada), cached 60 s */
  const S=new Map(),OV=new Map(),subs=new Set(),IDX=new WeakMap();
  const emit=()=>subs.forEach(f=>{try{f()}catch(e){}});
  function loadSessions(inst,force){
    const k=inst&&inst.name;if(!k)return null;
    const cur=S.get(k)||{status:'idle',list:[],at:0,p:null};
    if(cur.p)return cur.p;
    if(!force&&cur.status!=='idle'&&Date.now()-cur.at<6e4)return null;
    const started=Date.now();
    const p=Ee.get('/openai/fetchSessions/all/'+encodeURIComponent(k),{headers:{apikey:inst.token}}).then(r=>{
      for(const[key,v]of OV)if(key.startsWith(k+'|')&&v.at<started)OV.delete(key);
      S.set(k,{status:'ok',list:Array.isArray(r.data)?r.data:[],at:Date.now(),p:null});emit()},
      ()=>{const o=S.get(k)||cur;S.set(k,{...o,status:o.status==='ok'?'ok':'error',at:Date.now(),p:null});emit()});
    S.set(k,{...cur,status:cur.status==='ok'?'ok':'loading',p});emit();return p;
  }
  function useSessions(inst){const[,tick]=y.useState(0);const name=inst&&inst.name;
    y.useEffect(()=>{const f=()=>tick(n=>n+1);subs.add(f);loadSessions(inst);return()=>{subs.delete(f)}},[name]);
    return S.get(name)||{status:name?'loading':'idle',list:[]};}
  function rank(x){return(x.status==='closed'?0:1e15)+(Date.parse(x.updatedAt)||0)}
  function index(list){if(!list)return null;let m=IDX.get(list);if(m)return m;m=new Map();
    for(const x of list){if(!x||!x.remoteJid)continue;const s=String(x.remoteJid),d=waCDigits(s),ks=s.endsWith('@s.whatsapp.net')&&d?[s,'d:'+d]:[s];
      for(const key of ks){const prev=m.get(key);if(!prev||rank(x)>rank(prev))m.set(key,x)}}
    IDX.set(list,m);return m;}
  function sessionFor(m,chat){if(!m||!chat)return null;for(const k of[chat.remoteJid,chat.remoteJidAlt]){if(k&&m.has(k))return m.get(k)}
    const j=String(chat.remoteJid||'');return j.endsWith('@s.whatsapp.net')?m.get('d:'+waCDigits(j))||null:null;}
  function aiState(name,x){if(!x)return{k:'none'};const o=OV.get(name+'|'+x.remoteJid);
    if(o)x=o.status==='opened'?{...x,status:'opened',humanPause:null}:{...x,status:'paused',humanPause:{reason:'manual',autoResume:!1}};
    if(x.status==='closed')return{k:'closed',s:x};if(x.humanPause||x.status==='paused')return{k:'paused',s:x,p:x.humanPause||null};return{k:'active',s:x};}
  function hm(d){return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
  function pausedText(st){const p=st.p;if(!p)return'Pausada';if(p.reason==='manual'||!p.autoResume)return'Pausada até você retomar';
    const d=new Date(p.resumesAt);if(isNaN(d.getTime())||d.getTime()<=Date.now())return'Pausada · volta na próxima mensagem';
    return'Pausada até '+(d.toDateString()===new Date().toDateString()?hm(d):d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})+' '+hm(d));}
  function Badge({tone,children}){return i.jsxs('span',{className:'wa-tw-badge','data-tone':tone,children:[i.jsx('span',{className:'wa-tw-badge-dot','aria-hidden':'true'}),children]})}

  /* ---------------------------------------------------------------- small building blocks */
  function IconBtn({icon,label,onClick,pressed,expanded,controls,id,className}){return i.jsx('button',{type:'button',id,className:'wa-tw-ibtn'+(className?' '+className:''),'aria-label':label,title:label,'aria-pressed':pressed,'aria-expanded':expanded,'aria-controls':controls,onClick,children:svg(icon,16)})}
  function Empty({icon,title,text,action,onAction}){return i.jsxs('div',{className:'wa-tw-empty',role:'status',children:[i.jsx('span',{className:'wa-tw-empty-icon',children:svg(icon||'chat',20)}),i.jsx('p',{className:'wa-tw-empty-title',children:title}),text?i.jsx('p',{className:'wa-tw-empty-text',children:text}):null,action?i.jsx('button',{type:'button',className:'wa-tw-sbtn',onClick:onAction,children:action}):null]})}
  function copy(text,ok){const bad=()=>me.error('Não foi possível copiar. Selecione e copie manualmente.');try{navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(text).then(()=>me.success(ok),bad):bad()}catch(e){bad()}}
  function Pop({id,label,icon,count,align,children}){
    const[open,setOpen]=y.useState(!1),btn=y.useRef(null),box=y.useRef(null);
    y.useEffect(()=>{if(!open)return;
      const down=e=>{if(box.current&&!box.current.contains(e.target)&&btn.current&&!btn.current.contains(e.target))setOpen(!1)};
      const key=e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();setOpen(!1);btn.current&&btn.current.focus()}};
      document.addEventListener('mousedown',down);document.addEventListener('keydown',key,!0);
      const f=box.current&&box.current.querySelector('input:checked,input,button');f&&f.focus();
      return()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key,!0)}},[open]);
    return i.jsxs('div',{className:'wa-tw-popwrap',children:[
      i.jsxs('button',{ref:btn,type:'button',className:'wa-tw-lbtn','data-active':count?'true':void 0,'aria-haspopup':'dialog','aria-expanded':open?'true':'false','aria-controls':open?id:void 0,onClick:()=>setOpen(o=>!o),children:[svg(icon,14),i.jsx('span',{children:label}),count?i.jsx('span',{className:'wa-tw-lbtn-n','aria-label':count+' ativo(s)',children:count}):null]}),
      open?i.jsx('div',{ref:box,id,role:'dialog','aria-label':label,className:'wa-tw-pop'+(align==='end'?' wa-tw-pop--end':''),children:children(()=>{setOpen(!1);btn.current&&btn.current.focus()})}):null]});
  }
  function Opt({type,name,checked,onChange,label,hint}){return i.jsxs('label',{className:'wa-tw-opt','data-checked':checked?'true':void 0,children:[i.jsx('input',{type,name,checked,onChange}),i.jsxs('span',{className:'wa-tw-opt-text',children:[i.jsx('span',{children:label}),hint?i.jsx('span',{className:'wa-tw-opt-hint',children:hint}):null]}),i.jsx('span',{className:'wa-tw-opt-check','aria-hidden':'true',children:checked?svg('check',14):null})]})}

  /* ---------------------------------------------------------------- Conversas: view bar + dense list */
  const SEGS=[['all','Todas'],['unread','Não lidas'],['paused','IA pausada'],['groups','Grupos']];
  const PERIODS=[['any','Qualquer data'],['today','Hoje'],['7d','Últimos 7 dias'],['30d','Últimos 30 dias']];
  const SORTS=[['recent','Mais recentes'],['unread','Não lidas primeiro'],['name','Nome (A–Z)']];
  const MEDIA=new Set(['imageMessage','videoMessage','audioMessage','documentMessage','documentWithCaptionMessage','stickerMessage','ptvMessage']);
  const DEF={seg:'all',period:'any',media:!1,waiting:!1,sort:'recent'};
  const has=(list,v)=>list.some(x=>x[0]===v);
  function readView(){try{const o=JSON.parse(ls_('wa-tw-view')||'{}')||{};return{seg:has(SEGS,o.seg)?o.seg:'all',period:has(PERIODS,o.period)?o.period:'any',media:o.media===!0,waiting:o.waiting===!0,sort:has(SORTS,o.sort)?o.sort:'recent'}}catch(e){return{...DEF}}}
  function ts(c){const m=waCLast(c);if(m&&m.messageTimestamp){const t=Yv(m).getTime();if(!isNaN(t))return t}const u=Date.parse(c&&c.updatedAt);return isNaN(u)?0:u}
  function unread(c){return Number(c&&c.unreadCount)||0}
  const lbl=(list,v)=>(list.find(x=>x[0]===v)||['',''])[1];

  function View({contacts,merged,loading,error,refetch,query,active,instanceId,instance}){
    const[v,setV]=y.useState(readView);
    const set=p=>setV(o=>{const n={...o,...p};ls_('wa-tw-view',JSON.stringify(n));return n});
    const ses=useSessions(instance),sIdx=ses.status==='ok'?index(ses.list):null,name=instance&&instance.name,own=instance&&instance.profileName;
    const base=y.useMemo(()=>{const c=(contacts||[]).filter(x=>x&&typeof x.remoteJid=='string'&&x.remoteJid.includes('@s.whatsapp.net'));
      const g=(merged||[]).filter(x=>x&&typeof x.remoteJid=='string'&&x.remoteJid.endsWith('@g.us'));
      return c.concat(g).map(x=>waCOwn(x,own))},[contacts,merged,own]);
    const nq=waCNorm(query),dq=String(query||'').replace(/\D/g,'');
    const searched=nq?base.filter(c=>waCNorm(waCTitle(c)+' '+(c.pushName||'')).includes(nq)||dq.length>1&&waCDigits(c.remoteJid).includes(dq)):base;
    const st=c=>aiState(name,sessionFor(sIdx,c));
    const segOk={all:()=>!0,unread:c=>unread(c)>0,paused:c=>st(c).k==='paused',groups:c=>waCIsGroup(c.remoteJid)};
    const counts={all:searched.length,unread:searched.filter(segOk.unread).length,paused:sIdx?searched.filter(segOk.paused).length:null,groups:searched.filter(segOk.groups).length};
    const now=Date.now(),day0=new Date();day0.setHours(0,0,0,0);
    const minT=v.period==='today'?day0.getTime():v.period==='7d'?now-7*864e5:v.period==='30d'?now-30*864e5:0;
    let list=searched.filter(segOk[v.seg]);
    if(minT)list=list.filter(c=>ts(c)>=minT);
    if(v.media)list=list.filter(c=>{const m=waCLast(c);return!!m&&MEDIA.has(m.messageType)});
    if(v.waiting)list=list.filter(c=>{const m=waCLast(c);return!!m&&!(m.key&&m.key.fromMe)});
    const byRecent=(a,b)=>ts(b)-ts(a);
    list=list.slice().sort(v.sort==='name'?(a,b)=>waCTitle(a).localeCompare(waCTitle(b),'pt-BR',{sensitivity:'base',numeric:!0}):v.sort==='unread'?(a,b)=>(unread(b)>0)-(unread(a)>0)||byRecent(a,b):byRecent);
    const chips=[];
    if(v.period!=='any')chips.push(['period','Período: '+lbl(PERIODS,v.period).toLowerCase(),()=>set({period:'any'})]);
    if(v.media)chips.push(['media','Com mídia',()=>set({media:!1})]);
    if(v.waiting)chips.push(['waiting','Aguardando resposta',()=>set({waiting:!1})]);
    if(v.sort!=='recent')chips.push(['sort','Ordem: '+lbl(SORTS,v.sort).toLowerCase(),()=>set({sort:'recent'})]);
    const nFilters=(v.period!=='any')+v.media+v.waiting;
    const clear=()=>set({period:'any',media:!1,waiting:!1,sort:'recent'});
    let body;
    if(!base.length){
      if(loading)body=i.jsx(WaChatSkeleton,{});
      else if(error)body=i.jsx(Empty,{icon:'chat',title:'Não foi possível carregar as conversas',text:'Verifique a conexão com o servidor e tente de novo.',action:refetch?'Tentar de novo':null,onAction:()=>refetch&&refetch()});
      else body=i.jsx(Empty,{icon:'chat',title:'Nenhuma conversa ainda',text:'As conversas aparecem aqui quando a instância enviar ou receber mensagens.'});
    }else if(!list.length){
      if(v.seg==='paused'&&!sIdx)body=ses.status==='error'?i.jsx(Empty,{icon:'bot',title:'Não foi possível ler o estado da IA',text:'O painel não conseguiu buscar as sessões da OpenAI desta instância.',action:'Tentar de novo',onAction:()=>loadSessions(instance,!0)}):i.jsx(WaChatSkeleton,{});
      else if(nq&&!searched.length)body=i.jsx(Empty,{icon:'search',title:'Nada encontrado',text:'Nenhuma conversa corresponde a “'+String(query).trim()+'”.'});
      else if(chips.length)body=i.jsx(Empty,{icon:'filter',title:'Nenhuma conversa com esses filtros',text:'Remova um filtro ou volte para todas as conversas.',action:'Limpar filtros',onAction:clear});
      else if(v.seg==='paused')body=i.jsx(Empty,{icon:'pause',title:'Nenhuma conversa com a IA pausada',text:'Quando alguém da equipe assumir uma conversa, ela aparece aqui.'});
      else if(v.seg==='unread')body=i.jsx(Empty,{icon:'check',title:'Tudo lido',text:'Nenhuma conversa com mensagens não lidas.'});
      else body=i.jsx(Empty,{icon:'users',title:'Nenhum grupo',text:'Os grupos aparecem aqui quando houver mensagens neles.'});
    }else body=i.jsx('ul',{className:'wa-chat-items wa-tw-items','aria-label':'Conversas',children:list.map(c=>{const u=unread(c),a=st(c);
      return i.jsx('li',{children:i.jsxs(Fu,{to:'/manager/instance/'+instanceId+'/chat/'+c.remoteJid,className:'wa-chat-item wa-tw-row','aria-current':active===c.remoteJid?'page':void 0,children:[
        i.jsx(WaChatAvatar,{chat:c}),
        i.jsxs('span',{className:'wa-chat-item-main',children:[
          i.jsxs('span',{className:'wa-chat-item-row',children:[i.jsx('span',{className:'wa-chat-item-name',children:waCTitle(c)}),i.jsx('span',{className:'wa-chat-item-time'+(u?' is-unread':''),children:waCWhen(c)})]}),
          i.jsxs('span',{className:'wa-chat-item-row',children:[i.jsx('span',{className:'wa-chat-item-preview',children:waCPreview(c)||waCSub(c)}),
            a.k==='paused'?i.jsx(Badge,{tone:'warn',children:'IA pausada'}):null,
            u?i.jsxs('span',{className:'wa-chat-unread',children:[u>99?'99+':u,i.jsx('span',{className:'sr-only',children:u===1?' mensagem não lida':' mensagens não lidas'})]}):null]})]})]})},c.remoteJid)})});
    return i.jsxs('div',{className:'wa-tw-view',children:[
      i.jsx('div',{className:'wa-tw-segs',role:'group','aria-label':'Visão da lista',children:SEGS.map(([k,lb])=>i.jsxs('button',{type:'button',className:'wa-tw-seg','aria-pressed':v.seg===k?'true':'false',onClick:()=>set({seg:k}),children:[
        i.jsx('span',{children:lb}),k!=='all'&&counts[k]?i.jsx('span',{className:'wa-tw-seg-n',children:counts[k]>999?'999+':counts[k]}):null]},k))}),
      i.jsxs('div',{className:'wa-tw-bar',children:[
        i.jsx('p',{className:'wa-tw-count','aria-live':'polite',children:base.length?plural(list.length,'conversa','conversas'):loading?'Carregando…':''}),
        i.jsxs('div',{className:'wa-tw-bar-actions',children:[
          i.jsx(Pop,{id:'wa-tw-filter',label:'Filtro',icon:'filter',count:nFilters,children:close=>i.jsxs('div',{className:'wa-tw-pop-body',children:[
            i.jsxs('fieldset',{className:'wa-tw-pop-sec',children:[i.jsx('legend',{className:'wa-tw-pop-label',children:'Última mensagem'}),
              PERIODS.map(([k,lb])=>i.jsx(Opt,{type:'radio',name:'wa-tw-period',checked:v.period===k,onChange:()=>set({period:k}),label:lb},k))]}),
            i.jsxs('fieldset',{className:'wa-tw-pop-sec',children:[i.jsx('legend',{className:'wa-tw-pop-label',children:'Mostrar só'}),
              i.jsx(Opt,{type:'checkbox',checked:v.media,onChange:e=>set({media:e.target.checked}),label:'Com mídia',hint:'Última mensagem é foto, áudio, vídeo ou documento'}),
              i.jsx(Opt,{type:'checkbox',checked:v.waiting,onChange:e=>set({waiting:e.target.checked}),label:'Aguardando resposta',hint:'Última mensagem é do cliente'})]}),
            i.jsxs('div',{className:'wa-tw-pop-foot',children:[i.jsx('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',disabled:!nFilters,onClick:()=>set({period:'any',media:!1,waiting:!1}),children:'Limpar'}),i.jsx('button',{type:'button',className:'wa-tw-sbtn',onClick:close,children:'Pronto'})]})]})}),
          i.jsx(Pop,{id:'wa-tw-sort',label:'Ordenar',icon:'sort',align:'end',children:close=>i.jsx('div',{className:'wa-tw-pop-body',children:i.jsxs('fieldset',{className:'wa-tw-pop-sec',children:[i.jsx('legend',{className:'wa-tw-pop-label',children:'Ordenar por'}),
            SORTS.map(([k,lb])=>i.jsx(Opt,{type:'radio',name:'wa-tw-sort',checked:v.sort===k,onChange:()=>{set({sort:k});close()},label:lb},k))]})})})]})]}),
      chips.length?i.jsxs('div',{className:'wa-tw-chips',role:'list','aria-label':'Filtros ativos',children:[chips.map(([k,t,rm])=>i.jsxs('span',{className:'wa-tw-chip',role:'listitem',children:[i.jsx('span',{children:t}),i.jsx('button',{type:'button',className:'wa-tw-chip-x','aria-label':'Remover '+t,onClick:rm,children:svg('x',12)})]},k)),
        chips.length>1?i.jsx('button',{type:'button',className:'wa-tw-chip-clear',onClick:clear,children:'Limpar tudo'}):null]}):null,
      i.jsx('div',{className:'wa-tw-scroll',children:body})]});
  }

  /* ---------------------------------------------------------------- open conversation: shell + contact panel */
  let Ctx=null;const ctx=()=>Ctx||(Ctx=y.createContext(null));
  function Shell({instance,contacts,merged,jid,children}){
    const[open,setOpen]=y.useState(()=>wide()&&ls_('wa-tw-panel')==='1');
    const toggle=y.useCallback(v=>setOpen(o=>{const n=typeof v==='boolean'?v:!o;wide()&&ls_('wa-tw-panel',n?'1':'0');return n}),[]);
    y.useEffect(()=>{wide()||setOpen(!1)},[jid]);
    const chat=y.useMemo(()=>{const a=(contacts||[]).find(c=>c&&c.remoteJid===jid)||(merged||[]).find(c=>c&&c.remoteJid===jid);return waCOwn(a?{...a}:{remoteJid:jid},instance&&instance.profileName)},[contacts,merged,jid,instance&&instance.profileName]);
    const value=y.useMemo(()=>({open,toggle,chat,instance}),[open,toggle,chat,instance]);
    return i.jsx(ctx().Provider,{value,children:i.jsxs('div',{className:'wa-tw-shell','data-open':open?'true':void 0,children:[i.jsx('div',{className:'wa-tw-shell-main',children}),open?i.jsx(Panel,{chat,instance,onClose:()=>{toggle(!1);setTimeout(()=>{const b=document.getElementById('wa-tw-info');b&&b.focus()},0)}},jid):null]})});
  }
  function HeadExtra(){const c=y.useContext(ctx());const ses=useSessions(c&&c.instance);if(!c)return null;
    const a=aiState(c.instance&&c.instance.name,sessionFor(ses.status==='ok'?index(ses.list):null,c.chat));
    return i.jsxs('div',{className:'wa-tw-head-extra',children:[a.k==='paused'?i.jsx(Badge,{tone:'warn',children:'IA pausada'}):null,
      i.jsx(IconBtn,{id:'wa-tw-info',icon:'panel',label:c.open?'Fechar detalhes do contato':'Ver detalhes do contato',expanded:c.open?'true':'false',controls:'wa-tw-panel',pressed:c.open?'true':'false',onClick:()=>c.toggle()})]});}
  const OLD=new Map();
  function fmtDate(t){if(!t)return'—';const d=new Date(t),n=new Date(),o=new Date(n);o.setDate(n.getDate()-1);
    const day=d.toDateString()===n.toDateString()?'Hoje':d.toDateString()===o.toDateString()?'Ontem':d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});return day+', '+hm(d);}
  function Field({icon,label,stack,children}){return i.jsxs('div',{className:'wa-tw-field'+(stack?' wa-tw-field--stack':''),children:[i.jsxs('dt',{children:[svg(icon,14),i.jsx('span',{children:label})]}),i.jsx('dd',{children})]})}
  function Panel({chat,instance,onClose}){
    const jid=String(chat.remoteJid||''),name=instance&&instance.name,group=waCIsGroup(jid),phone=jid.endsWith('@s.whatsapp.net')?waCDigits(jid):'';
    const modal=!wide(),ref=y.useRef(null),closeRef=y.useRef(null);
    const[confirm,setConfirm]=y.useState(null),[busy,setBusy]=y.useState(!1),[,tick]=y.useState(0);
    const ses=useSessions(instance),a=aiState(name,sessionFor(ses.status==='ok'?index(ses.list):null,chat));
    const{data:msgs}=rX({remoteJid:jid,instanceName:name,staleTime:1/0,refetchOnMount:!1,refetchOnWindowFocus:!1});
    const meta=waMsgMeta.get((name||'')+'|'+jid),list=Array.isArray(msgs)?msgs:[];
    const times=list.filter(m=>m&&m.messageTimestamp).map(m=>Yv(m).getTime()).filter(t=>!isNaN(t));
    const last=times.length?Math.max(...times):0,firstLoaded=times.length?Math.min(...times):0,pages=meta?meta.pages:1,key=name+'|'+jid,old=OLD.get(key);
    y.useEffect(()=>{if(!name||!jid||pages<=1||OLD.has(key))return;let live=!0;OLD.set(key,{t:0,p:!0});
      Ee.post('/chat/findMessages/'+encodeURIComponent(name),{where:{key:{remoteJid:jid}},page:pages}).then(r=>{const rec=r.data&&r.data.messages&&Array.isArray(r.data.messages.records)?r.data.messages.records:[];
        const ts2=rec.filter(m=>m&&m.messageTimestamp).map(m=>Yv(m).getTime()).filter(t=>!isNaN(t));OLD.set(key,{t:ts2.length?Math.min(...ts2):0});live&&tick(n=>n+1)},()=>{OLD.delete(key)});
      return()=>{live=!1}},[key,pages]);
    const first=pages<=1?firstLoaded:old&&old.t?old.t:0;
    y.useEffect(()=>{if(modal&&closeRef.current)closeRef.current.focus()},[modal]);
    y.useEffect(()=>{const k=e=>{if(e.key==='Escape'&&!confirm&&!e.defaultPrevented){const inside=ref.current&&ref.current.contains(document.activeElement);if(modal||inside){e.preventDefault();onClose()}}};window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[modal,confirm,onClose]);
    const title=waCTitle(chat);
    const doIt=async()=>{if(!a.s||!confirm)return;setBusy(!0);
      try{await Ee.post('/openai/changeStatus/'+encodeURIComponent(name),{remoteJid:a.s.remoteJid,status:confirm},{headers:{apikey:instance.token}});
        OV.set(name+'|'+a.s.remoteJid,{status:confirm,at:Date.now()});emit();me.success(confirm==='paused'?'IA pausada para este contato.':'IA retomada para este contato.');setConfirm(null);setTimeout(()=>loadSessions(instance,!0),1500)}
      catch(e){const m=e&&e.response&&e.response.data&&e.response.data.response&&e.response.data.response.message;me.error('Não foi possível mudar o estado da IA.'+(m?' '+[].concat(m).join(' '):''))}
      finally{setBusy(!1)}};
    let ai;
    if(ses.status==='loading'||ses.status==='idle')ai=i.jsx('span',{className:'wa-tw-muted',children:'Carregando…'});
    else if(ses.status==='error')ai=i.jsxs('span',{className:'wa-tw-ai',children:[i.jsx('span',{className:'wa-tw-muted',children:'Não foi possível ler o estado da IA.'}),i.jsx('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:()=>loadSessions(instance,!0),children:'Tentar de novo'})]});
    else if(a.k==='none')ai=i.jsxs('span',{className:'wa-tw-ai',children:[i.jsx(Badge,{tone:'ok',children:'Ativa'}),i.jsx('span',{className:'wa-tw-hint',children:'Ainda sem sessão: a IA cria a sessão na primeira mensagem do contato. Depois dá para pausar aqui.'})]});
    else ai=i.jsxs('span',{className:'wa-tw-ai',children:[
      a.k==='paused'?i.jsx(Badge,{tone:'warn',children:pausedText(a)}):a.k==='closed'?i.jsx(Badge,{tone:'off',children:'Sessão encerrada'}):i.jsx(Badge,{tone:'ok',children:'Ativa'}),
      i.jsxs('button',{type:'button',className:'wa-tw-sbtn'+(a.k==='active'?' wa-tw-sbtn--ghost':''),onClick:()=>setConfirm(a.k==='active'?'paused':'opened'),children:[svg(a.k==='active'?'pause':'play',14),a.k==='active'?'Pausar IA':'Retomar IA']})]});
    const total=meta&&meta.total?meta.total:list.length;
    const panel=i.jsxs('aside',{ref,id:'wa-tw-panel',className:'wa-tw-panel'+(modal?' wa-tw-panel--sheet':''),role:modal?'dialog':'complementary','aria-modal':modal?'true':void 0,'aria-labelledby':'wa-tw-panel-title',children:[
      i.jsxs('header',{className:'wa-tw-panel-head',children:[i.jsx('h2',{id:'wa-tw-panel-title',className:'wa-tw-panel-kicker',children:group?'Grupo':'Contato'}),
        i.jsx('button',{ref:closeRef,type:'button',className:'wa-tw-ibtn','aria-label':'Fechar detalhes',title:'Fechar (Esc)',onClick:onClose,children:svg('x',16)})]}),
      i.jsxs('div',{className:'wa-tw-panel-id',children:[i.jsx(WaChatAvatar,{chat,size:'lg'}),i.jsxs('div',{className:'wa-tw-panel-idtext',children:[i.jsx('p',{className:'wa-tw-panel-name',children:title}),waCSub(chat)?i.jsx('p',{className:'wa-tw-muted',children:waCSub(chat)}):null]})]}),
      i.jsxs('div',{className:'wa-tw-panel-body',children:[
        i.jsxs('dl',{className:'wa-tw-fields',children:[
          group?null:i.jsx(Field,{icon:'phone',label:'Telefone',children:phone?i.jsxs('span',{className:'wa-tw-val',children:[i.jsx('span',{className:'wa-tw-mono',children:waCPhone(jid)}),i.jsx(IconBtn,{icon:'copy',label:'Copiar número',onClick:()=>copy('+'+phone,'Número copiado.')})]}):i.jsx('span',{className:'wa-tw-muted',children:'Oculto pelo WhatsApp'})}),
          i.jsx(Field,{icon:'spark',label:'IA neste contato',stack:!0,children:ai}),
          i.jsx(Field,{icon:'msgs',label:'Mensagens',children:msgs?i.jsx('span',{children:nf.format(total)+(meta&&meta.total?'':list.length>=50?'+':'')}):i.jsx('span',{className:'wa-tw-muted',children:'—'})}),
          i.jsx(Field,{icon:'dot',label:'Não lidas',children:i.jsx('span',{children:nf.format(unread(chat))})}),
          i.jsx(Field,{icon:'cal',label:'Primeira mensagem',children:i.jsx('span',{children:first?fmtDate(first):pages>1?'Carregando…':'—'})}),
          i.jsx(Field,{icon:'clock',label:'Última mensagem',children:i.jsx('span',{children:last?fmtDate(last):fmtDate(ts(chat))})})]}),
        phone?i.jsxs('div',{className:'wa-tw-panel-sec',children:[i.jsx('p',{className:'wa-tw-panel-label',children:'Ações rápidas'}),
          i.jsxs('div',{className:'wa-tw-actions',children:[
            i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:()=>copy('+'+phone,'Número copiado.'),children:[svg('copy',14),'Copiar número']}),
            i.jsxs('a',{className:'wa-tw-sbtn wa-tw-sbtn--ghost',href:'https://wa.me/'+phone,target:'_blank',rel:'noopener noreferrer',children:[svg('ext',14),'Abrir no WhatsApp',i.jsx('span',{className:'sr-only',children:' (abre em nova aba)'})]})]})]}):null,
        i.jsx('p',{className:'wa-tw-hint wa-tw-panel-note',children:'Somente leitura. O único botão que muda algo é Pausar/Retomar IA, e ele pede confirmação.'})]}),
      confirm?i.jsx(Pt,{open:!0,onOpenChange:o=>{if(!o&&!busy)setConfirm(null)},children:i.jsxs(Nt,{className:'wa-confirm',children:[
        i.jsxs(Mt,{children:[i.jsx(zt,{children:(confirm==='paused'?'Pausar a IA para ':'Retomar a IA para ')+title+'?'}),
          i.jsx(eo,{children:confirm==='paused'?'A IA para de responder este contato até alguém retomar. A equipe continua atendendo pelo WhatsApp normalmente.':'A IA volta a responder as próximas mensagens deste contato.'})]}),
        i.jsxs(Yt,{className:'wa-confirm-foot',children:[i.jsx(se,{variant:'outline',onClick:()=>setConfirm(null),disabled:busy,children:'Cancelar'}),
          i.jsx(se,{onClick:doIt,disabled:busy,'aria-busy':busy?'true':void 0,children:busy?'Aplicando…':confirm==='paused'?'Pausar IA':'Retomar IA'})]})]})}):null]});
    return modal?i.jsxs(i.Fragment,{children:[i.jsx('div',{className:'wa-tw-backdrop','aria-hidden':'true',onClick:onClose}),panel]}):panel;
  }

  /* ---------------------------------------------------------------- breadcrumb page header + command menu */
  const PAGES=[['dashboard','Visão Geral','grid'],['chat','Conversas','chat'],['usage','Plano e limites','gauge'],['openai','OpenAI','bot'],['observability','Observabilidade','pulse'],['settings','Comportamento','cog'],['readme','Manual','book']];
  function pageLabel(seg,t){const p=PAGES.find(x=>x[0]===seg);if(p&&seg!=='settings')return p[1];const k='sidebar.'+seg,tx=seg?t(k):'';return tx&&tx!==k?tx:p?p[1]:'';}
  function Crumbs(){const{instance:g}=ct(),{pathname:p}=Pi(),{t}=Ve();
    const m=String(p||'').match(/\/manager\/instance\/([^/]+)\/([^/]+)(\/.+)?/),seg=m?m[2]:'',deep=!!(m&&m[3]),label=pageLabel(seg,t);
    const sep=k=>i.jsx('li',{className:'wa-tw-crumb-sep','aria-hidden':'true',children:'/'},k);
    return i.jsx('nav',{className:'wa-tw-crumbs','aria-label':'Você está em',children:i.jsxs('ol',{children:[
      i.jsx('li',{children:i.jsx(Fu,{to:'/manager/',children:'Instâncias'})}),sep('s1'),
      i.jsx('li',{className:'wa-tw-crumb-inst',children:g?i.jsx(Fu,{to:'/manager/instance/'+g.id+'/dashboard',children:g.name}):i.jsx('span',{className:'wa-tw-muted',children:'…'})}),
      label?sep('s2'):null,
      label?i.jsx('li',{children:deep&&g?i.jsx(Fu,{to:'/manager/instance/'+g.id+'/'+seg,children:label}):i.jsx('span',{'aria-current':'page',children:label})}):null]})});}
  function CmdButton(){return i.jsxs('button',{type:'button',className:'wa-tw-cmdbtn','aria-label':'Buscar conversas e páginas','aria-keyshortcuts':MAC?'Meta+K':'Control+K',title:'Buscar ('+(MAC?'⌘':'Ctrl')+'+K)',onClick:()=>window.dispatchEvent(new Event('wa-tw-cmdk')),children:[svg('search',14),i.jsx('span',{className:'wa-tw-cmdbtn-text',children:'Buscar'}),i.jsx('kbd',{className:'wa-tw-kbd',children:(MAC?'⌘':'Ctrl')+' K'})]})}
  function Cmd(){
    const{instance:g}=ct(),nav=dn(),{t}=Ve(),[open,setOpen]=y.useState(!1),[q,setQ]=y.useState(''),[ix,setIx]=y.useState(0),inp=y.useRef(null),ret=y.useRef(null),listRef=y.useRef(null);
    y.useEffect(()=>{const k=e=>{if((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&String(e.key).toLowerCase()==='k'){e.preventDefault();setOpen(o=>!o)}},o=()=>setOpen(!0);
      window.addEventListener('keydown',k);window.addEventListener('wa-tw-cmdk',o);return()=>{window.removeEventListener('keydown',k);window.removeEventListener('wa-tw-cmdk',o)}},[]);
    y.useEffect(()=>{if(open){ret.current=document.activeElement;setQ('');setIx(0);const f=setTimeout(()=>inp.current&&inp.current.focus(),0);return()=>clearTimeout(f)}
      const r=ret.current;ret.current=null;r&&r.focus&&document.contains(r)&&r.focus()},[open]);
    const{data:chats,isLoading}=sY({instanceName:open?g&&g.name:void 0,staleTime:6e4});
    const nq=waCNorm(q),dq=q.replace(/\D/g,'');
    const pages=PAGES.map(([k,lb,ic])=>({kind:'page',id:'p-'+k,k,label:pageLabel(k,t)||lb,ic})).filter(p=>!nq||waCNorm(p.label).includes(nq));
    const all=(Array.isArray(chats)?chats:[]).filter(c=>c&&typeof c.remoteJid=='string'&&(c.remoteJid.includes('@s.whatsapp.net')||c.remoteJid.endsWith('@g.us'))).map(c=>waCOwn(c,g&&g.profileName));
    const found=(nq?all.filter(c=>waCNorm(waCTitle(c)+' '+(c.pushName||'')).includes(nq)||dq.length>1&&waCDigits(c.remoteJid).includes(dq)):all).slice().sort((a,b)=>ts(b)-ts(a)).slice(0,nq?8:5);
    const convs=found.map(c=>({kind:'chat',id:'c-'+c.remoteJid.replace(/[^\w]/g,'_'),c}));
    const items=nq?convs.concat(pages):pages.concat(convs),cur=Math.min(ix,Math.max(0,items.length-1));
    y.useEffect(()=>{const el=listRef.current&&listRef.current.querySelector('[aria-selected="true"]');el&&el.scrollIntoView&&el.scrollIntoView({block:'nearest'})},[cur,open,q]);
    if(!open||!g)return null;
    const close=()=>setOpen(!1);
    const run=it=>{if(!it)return;close();if(it.kind==='chat')nav('/manager/instance/'+g.id+'/chat/'+it.c.remoteJid);else if(it.k==='readme')window.location.href='/readme';else nav('/manager/instance/'+g.id+'/'+it.k)};
    const key=e=>{const n=items.length;if(e.key==='ArrowDown'){e.preventDefault();n&&setIx((cur+1)%n)}else if(e.key==='ArrowUp'){e.preventDefault();n&&setIx((cur-1+n)%n)}
      else if(e.key==='Home'&&n){e.preventDefault();setIx(0)}else if(e.key==='End'&&n){e.preventDefault();setIx(n-1)}
      else if(e.key==='Enter'){e.preventDefault();run(items[cur])}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}else if(e.key==='Tab')e.preventDefault()};
    const opt=(it,k)=>i.jsxs('div',{id:'wa-tw-cmd-'+it.id,role:'option','aria-selected':k===cur?'true':'false',className:'wa-tw-cmd-opt',onMouseMove:()=>k!==cur&&setIx(k),onMouseDown:e=>e.preventDefault(),onClick:()=>run(it),children:it.kind==='page'?[
        i.jsx('span',{className:'wa-tw-cmd-ic',children:svg(it.ic,16)},'i'),i.jsx('span',{className:'wa-tw-cmd-lb',children:it.label},'l'),i.jsx('span',{className:'wa-tw-cmd-meta',children:it.k==='readme'?'Abre o manual':'Página'},'m')]:[
        i.jsx(WaChatAvatar,{chat:it.c},'a'),i.jsx('span',{className:'wa-tw-cmd-lb',children:waCTitle(it.c)},'l'),i.jsx('span',{className:'wa-tw-cmd-meta',children:waCIsGroup(it.c.remoteJid)?'Grupo':waCName(it.c)?waCPhone(it.c.remoteJid):waCWhen(it.c)},'m')]},it.id);
    const group=(title,arr,off,gid)=>arr.length?i.jsxs('div',{role:'group','aria-labelledby':gid,className:'wa-tw-cmd-group',children:[i.jsx('div',{id:gid,className:'wa-tw-cmd-gtitle',children:title}),arr.map((it,k)=>opt(it,off+k))]},gid):null;
    const convTitle=nq?'Conversas':'Conversas recentes';
    const blocks=nq?[group(convTitle,convs,0,'wa-tw-cmd-gc'),group('Ir para',pages,convs.length,'wa-tw-cmd-gp')]:[group('Ir para',pages,0,'wa-tw-cmd-gp'),group(convTitle,convs,pages.length,'wa-tw-cmd-gc')];
    return i.jsx('div',{className:'wa-tw-cmd-backdrop',onMouseDown:e=>{e.target===e.currentTarget&&close()},children:i.jsxs('div',{className:'wa-tw-cmd',role:'dialog','aria-modal':'true','aria-label':'Menu de comandos',children:[
      i.jsxs('div',{className:'wa-tw-cmd-search',children:[svg('search',16),i.jsx('input',{ref:inp,type:'text',className:'wa-tw-cmd-input',value:q,onChange:e=>{setQ(e.target.value);setIx(0)},onKeyDown:key,placeholder:'Buscar conversa por nome ou número, ou ir para uma página…',
        role:'combobox','aria-expanded':'true','aria-controls':'wa-tw-cmd-list','aria-autocomplete':'list','aria-activedescendant':items[cur]?'wa-tw-cmd-'+items[cur].id:void 0,'aria-label':'Buscar',autoComplete:'off',spellCheck:!1}),
        i.jsx('button',{type:'button',className:'wa-tw-kbd wa-tw-kbd-btn',onClick:close,'aria-label':'Fechar menu de comandos',children:'Esc'})]}),
      i.jsxs('div',{ref:listRef,id:'wa-tw-cmd-list',role:'listbox','aria-label':'Resultados',className:'wa-tw-cmd-list',children:[...blocks,
        !items.length?i.jsx('p',{className:'wa-tw-cmd-none',children:isLoading?'Carregando conversas…':'Nada encontrado para “'+q.trim()+'”.'}):null,
        nq&&isLoading&&items.length?i.jsx('p',{className:'wa-tw-cmd-none',children:'Carregando conversas…'}):null]}),
      i.jsxs('div',{className:'wa-tw-cmd-foot','aria-hidden':'true',children:[i.jsx('span',{children:'↑ ↓ navegar'}),i.jsx('span',{children:'Enter abrir'}),i.jsx('span',{children:'Esc fechar'})]})]})});
  }
  return{View,Shell,HeadExtra,Crumbs,Cmd,CmdButton};
})();
'''

TABS_START = 'i.jsxs(Yx,{defaultValue:"contacts",className:"wa-chat-tabs flex min-h-0 flex-1 flex-col",children:['
TABS_END = 'kind:"groups",loading:waLoading,error:waError,query:waQ,active:m,instanceId:h,own:s?.profileName})})})]})'
VIEW = ('i.jsx(WaTw.View,{contacts:u,merged:f,loading:waLoading,error:waError,refetch:waRefetch,query:waQ,'
        'active:m,instanceId:h,instance:s})')
CONV_OLD = ('i.jsx(Hn,{children:m?i.jsx(ZO,{textareaRef:r,handleTextareaChange:b,textareaHeight:n,lastMessageRef:t,'
            'scrollToBottom:x}):i.jsx(WaChatIdle,{})})')
CONV_NEW = ('i.jsx(Hn,{children:m?i.jsx(WaTw.Shell,{instance:s,contacts:u,merged:f,jid:m,children:i.jsx(ZO,'
            '{textareaRef:r,handleTextareaChange:b,textareaHeight:n,lastMessageRef:t,scrollToBottom:x})}):'
            'i.jsx(WaChatIdle,{})})')


def patch_component(s):
    return rep(s, '})();\n\nconst Lse=Z2([', '})();\n\n' + COMPONENT + '\nconst Lse=Z2([', 'route table (after WaUsage)')


def patch_list(s):
    s = rep(s, '{data:u,isSuccess:d,isLoading:waLoading,isError:waError}=sY({instanceName:s?.name})',
            '{data:u,isSuccess:d,isLoading:waLoading,isError:waError,refetch:waRefetch}=sY({instanceName:s?.name})',
            'chat list query (run chat-ui.py first)')
    if s.count(TABS_START) != 1:
        raise PatchError(f'Contatos/Grupos tabs: start anchor expected once, got {s.count(TABS_START)}')
    a = s.index(TABS_START)
    b = s.find(TABS_END, a)
    if b < 0 or b - a > 1500:
        raise PatchError('Contatos/Grupos tabs: end anchor not found right after the start')
    s = s[:a] + VIEW + s[b + len(TABS_END):]
    return rep(s, CONV_OLD, CONV_NEW, 'conversation panel')


def patch_conv_head(s):
    old = ('i.jsx("h2",{className:"wa-conv-title",children:waCTitle(waConv)}),waSub?i.jsx("p",{className:"wa-conv-sub",'
           'children:waSub}):null]})')
    return rep(s, old, old + ',i.jsx(WaTw.HeadExtra,{})', 'conversation header (run chat-ui.py first)')


def patch_header(s):
    word = ('i.jsx(Fu,{to:"/manager",onClick:l,className:"flex h-8 items-center gap-4",children:i.jsx("span",'
            '{className:"wa-wordmark",children:"WhatsAI"})}),')
    s = rep(s, word, word + 'e?i.jsx(WaTw.Crumbs,{}):null,', 'top bar wordmark')
    right = 'i.jsxs("div",{className:"flex items-center gap-4",children:[e&&i.jsx(Ei,{className:"h-8 w-8"'
    return rep(s, right, right.replace('children:[', 'children:[e&&i.jsx(WaTw.CmdButton,{}),'), 'top bar actions')


def patch_layout(s):
    old = 'i.jsx(zM,{instanceId:t,onMenu:()=>waSetOpen(v=>!v),menuOpen:waOpen}),'
    return rep(s, old, old + 'i.jsx(WaTw.Cmd,{}),', 'instance layout top bar (run responsive.py first)')


GROUPS = [('component', patch_component), ('list', patch_list), ('conv-head', patch_conv_head),
          ('header', patch_header), ('layout', patch_layout)]


def patch_html(html):
    pos = html.find(CSS_ANCHOR)
    if pos < 0 or html.count(CSS_ANCHOR) != 1:
        raise PatchError('index.html: usage-limits.css link not found exactly once (run usage-limits.py first)')
    end = html.index('\n', pos) + 1
    return html[:end] + '    ' + html_marker('html') + '\n    <link rel="stylesheet" href="/assets/twenty-layout.css?v=1" />\n' + html[end:]


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
    if bump_index(html) != html:
        missing.append('index.html cache version')
    if not os.path.isfile(CSS):
        missing.append('twenty-layout.css')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/twenty-layout.css is missing')
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
    new_html = bump_index(new_html)

    # everything validated: write
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        report.append(f'index.html written (twenty-layout.css ?v=1, bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
