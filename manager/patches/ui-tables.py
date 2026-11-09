#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: database-style lists and tables (instances table, usage chip,
"Primeiros passos" checklist, toasts, settings sidebar sections, contact property table, table skeletons).

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/ui-tables.css (a plain file, edited by hand, only var(--m-*) tokens of
minimal.css, linked after twenty-layout.css). No backend change: only APIs the panel already calls
(GET /instance/fetchInstances, GET /usage/summary/:instance, GET /openai/find/:instance). Nothing here writes to the
API by itself: delete, disconnect and create reuse the existing calls, each behind a confirmation dialog.

Bundle groups (all applied together; the marker comment goes at the top of the bundle):
  component  - WaUt, an isolated component module (IIFE) placed right after WaUsage:
               Instances (instances page as a Twenty-like object page: own sidebar with the "WhatsAI" text
               wordmark + instance switcher, search and collapse icons, sections "Espaço de trabalho" (Instâncias,
               Conversas, Plano e limites, Observabilidade) and "Outros" (Configurações, Manual, Sair with the same
               confirmation as the top bar, which this page hides), drawer below 1024px; top bar "Instâncias" +
               "Nova instância" (existing create dialog) + "Mais"; view bar with the view picker "Todas as
               instâncias · N" and Buscar / Filtro / Ordenar / Opções (visible columns); table with checkbox column
               + selection bar, Nome with initial, Número / Integração / Banco (only when the API sends dbMode) as
               bordered pills, Status chip (Conectada / Desconectada / Conectando), Mensagens / Contatos
               right-aligned with thin-space thousands, Criada em relative ("há 2 meses"), Dono (profile name), row
               menu; disconnected rows dimmed; skeleton rows while loading; horizontal scroll inside the table on
               small screens; view kept in localStorage), the record side panel (tabs Resumo / Configurações / Uso;
               "Abrir" keeps the full instance route), dialogs "Excluir instância" (type the name to confirm) and
               "Desconectar", UsageChip ("Respostas da IA: 1.234 / 3.000"
               + popover Hoje / Este mês / Franquia / Restante / barra / "Uso baixo|moderado|alto" at 60/85 %, "Sem
               limite" when no franchise, hidden when /usage is missing), Checklist ("Primeiros passos" with 5 items
               derived from existing data, "x de 5 concluídos" + bar, collapsible and dismissible per instance in
               localStorage), toastIcon + ToastClose (icon tile and close button of the toasts), navLabel (section
               labels "Atendimento" and "Ajustes da instância" of the instance sidebar) and convStatus (status chip
               of the contact panel).
  instances  - instance list (CZ): its markup (cards + old delete dialog) is replaced by WaUt.Instances, which gets
               the existing delete (b), logout (s), refresh and create dialog; the create dialog gets a compact
               "Nova instância" trigger, a description, the token under "Avançado" and Cancelar + "Criar instância".
  header     - top bar (zM, instance pages only): WaUt.UsageChip before the "Buscar" button (twenty-layout.py).
  dashboard  - "Visão Geral" (PX): WaUt.Checklist right before the metric cards.
  toasts     - toast container (CL): icon tile and close button.
  sidebar    - instance sidebar (j5): section labels.
  panel      - contact side panel (twenty-layout.py): property table class and a "Status" row.
index.html group (marker: an HTML comment in <head>):
  html       - links ui-tables.css?v=1 after twenty-layout.css and bumps the bundle ?v= to CACHE_VERSION (only
               raised, never lowered).

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: when the marker is present nothing is written again.
Order: run after every other script (it needs twenty-layout.py, usage-limits.py and root-redirect.py applied).

Usage (from the repository root):
  python3 -I manager/patches/ui-tables.py           # apply
  python3 -I manager/patches/ui-tables.py --check   # exit 1 unless applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'ui-tables.css')
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CACHE_VERSION = '26'
MARKER = '/*whatsai-patch:ui-tables:v1*/'
HTML_MARKER = '<!-- whatsai-patch:ui-tables:html -->'
CSS_ANCHOR = '    <link rel="stylesheet" href="/assets/twenty-layout.css?v='
REQUIRED = ('/*whatsai-patch:root-redirect:v1*/', '/*whatsai-patch:twenty-layout:component*/',
            '/*whatsai-patch:twenty-layout:header*/', '/*whatsai-patch:usage-limits:component*/',
            '/*whatsai-patch:dashboard-ui:dashboard*/')


class PatchError(Exception):
    pass


# Names of the minified bundle used below (stable across the other patches):
# i = jsx runtime, y = React, Ee = axios (API URL + apikey), me = toast, ct() = instance context ({instance}),
# dn() = navigate, Fu = router Link, ne = Input, Kr / Wr / hr / wt / aM = DropdownMenu root / trigger / content /
# item / checkbox item, waPhoneBR = phone formatter (dashboard-ui.py).
COMPONENT = r'''const WaUt=(()=>{
  const nf=new Intl.NumberFormat('pt-BR'),pf=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1});
  const fmt=v=>v==null||!Number.isFinite(Number(v))?'—':nf.format(Number(v));
  function ls_(k,v){try{if(v===void 0)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){}return null}
  const IC={
    check:['M20 6 9 17l-5-5'],x:['M18 6 6 18','m6 6 12 12'],
    more:['M5 12h.01','M12 12h.01','M19 12h.01'],
    sort:['m3 16 4 4 4-4','M7 20V4','M11 4h10','M11 8h7','M11 12h4'],
    filter:['M3 6h18','M7 12h10','M10 18h4'],
    search:['m21 21-4.3-4.3','M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'],
    refresh:['M3 12a9 9 0 0 1 15-6.7L21 8','M21 3v5h-5','M21 12a9 9 0 0 1-15 6.7L3 16','M8 16H3v5'],
    chev:['m6 9 6 6 6-6'],
    user:['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2','M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'],
    phone:['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z'],
    status:['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z','m9 12 2 2 4-4'],
    plug:['M12 22v-5','M9 8V2','M15 8V2','M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z'],
    db:['M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3Z','M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5','M3 12c0 1.66 4 3 9 3s9-1.34 9-3'],
    msgs:['M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2Z','M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1'],
    users:['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z','M22 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75'],
    chat:['M7.9 20A9 9 0 1 0 4 16.1L2 22Z'],
    info:['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z','M12 16v-4','M12 8h.01'],
    alert:['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z','M12 8v4','M12 16h.01'],
    warn:['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3','M12 9v4','M12 17h.01'],
    grid:['M4 3h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z','M14 3h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z','M14 13h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z','M4 13h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z'],
    qr:['M3 3h6v6H3Z','M15 3h6v6h-6Z','M3 15h6v6H3Z','M15 15h2','M21 15v6h-4','M15 19v2'],
    cog:['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z','M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z'],
    copy:['M10 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z','M4 16V5a1 1 0 0 1 1-1h11'],
    trash:['M3 6h18','M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6','M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
    book:['M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20'],
    arrow:['M5 12h14','m12 5 7 7-7 7'],
    ext:['M15 3h6v6','M10 14 21 3','M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
    panel:['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z','M9 3v18'],
    unplug:['m19 5 3-3','m2 22 3-3','M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z','M7.5 13.5 10 11','M10.5 16.5 13 14','m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z'],
    lock:['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z','M7 11V7a5 5 0 0 1 10 0v4'],
    eye:['M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z','M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
    menu:['M4 6h16','M4 12h16','M4 18h16'],
    list:['M8 6h13','M8 12h13','M8 18h13','M3 6h.01','M3 12h.01','M3 18h.01'],
    pulse:['M22 12h-4l-3 9L9 3l-3 9H2'],
    gauge:['M12 14l4-4','M3.34 19a10 10 0 1 1 17.32 0'],
    cal:['M8 2v4','M16 2v4','M3 10h18','M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'],
    logout:['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4','m16 17 5-5-5-5','M21 12H9']};
  function svg(name,size){const d=IC[name]||[];return i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:size||16,height:size||16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'1.7',strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',children:d.map((p,k)=>i.jsx('path',{d:p},k))});}
  function copyText(t,ok){try{navigator.clipboard.writeText(String(t||'')).then(()=>me.success(ok),()=>me.error('Não foi possível copiar.'))}catch(e){me.error('Não foi possível copiar.')}}

  /* ---------------------------------------------------------------- usage summary, shared and cached 30 s */
  const SUM=new Map();
  function fetchSummary(name,force){const c=SUM.get(name);
    if(c&&c.p)return c.p;if(c&&c.r&&!force&&Date.now()-c.at<3e4)return Promise.resolve(c.r);
    const p=Ee.get('/usage/summary/'+encodeURIComponent(name)).then(r=>({st:r&&r.data&&r.data.month?'ok':'none',data:r&&r.data||null}),e=>({st:e&&e.response&&(e.response.status===404||e.response.status===403)?'none':'error',data:null}))
      .then(r=>{SUM.set(name,{r,at:Date.now(),p:null});return r});
    SUM.set(name,{...(c||{}),p});return p;}
  function useSummary(name){const[s,set]=y.useState(()=>{const c=name&&SUM.get(name);return c&&c.r?c.r:{st:'loading',data:null}});
    const load=y.useCallback(force=>{if(!name)return;fetchSummary(name,force).then(set)},[name]);
    y.useEffect(()=>{let live=!0;if(name)fetchSummary(name).then(r=>{live&&set(r)});return()=>{live=!1}},[name]);
    return{...s,load};}
  function level(pct){return pct==null?null:pct>=85?['bad','Uso alto']:pct>=60?['warn','Uso moderado']:['ok','Uso baixo'];}

  /* ---------------------------------------------------------------- chips */
  function Chip({tone,icon,children}){return i.jsxs('span',{className:'wa-ut-chip','data-tone':tone||'off',children:[icon?svg(icon,12):i.jsx('span',{className:'wa-ut-chip-dot','aria-hidden':'true'}),i.jsx('span',{children})]});}
  function StatusChip({status,busy}){
    if(busy)return i.jsx(Chip,{tone:'off',children:'Excluindo…'});
    if(status==='open')return i.jsx(Chip,{tone:'ok',icon:'check',children:'Conectada'});
    if(status==='connecting')return i.jsx(Chip,{tone:'warn',children:'Conectando'});
    if(status==='close')return i.jsx(Chip,{tone:'bad',icon:'x',children:'Desconectada'});
    return i.jsx(Chip,{tone:'off',children:status||'—'});}
  const INTS={'WHATSAPP-BAILEYS':['baileys','Baileys'],'WHATSAPP-BUSINESS':['cloud','Cloud API'],EVOLUTION:['evo','Evolution']};
  function intOf(x){const v=INTS[x&&x.integration];return v||['other',x&&x.integration?String(x.integration).toLowerCase():'—'];}
  function dbOf(v){const s=String(v==null?'':v).trim();if(!s)return null;
    if(/^(own|own[-_ ]?db|dedicated|private|byo|custom|pr[oó]prio)/i.test(s))return['own','Próprio'];
    if(/^(shared|default|compart)/i.test(s))return['shared','Compartilhado'];return['other',s];}
  function convStatus(chat,u){const lm=chat&&chat.lastMessage,mine=!!(lm&&lm.key&&lm.key.fromMe);
    const v=u>0?['info',u===1?'1 não lida':fmt(u)+' não lidas']:lm?(mine?['ok','Respondida']:['warn','Aguardando resposta']):['off','Sem mensagens'];
    return i.jsx(Chip,{tone:v[0],children:v[1]});}

  /* ---------------------------------------------------------------- instances page (object page: sidebar, view bar, table, record panel) */
  const VIEWS=[['all','Todas as instâncias'],['open','Conectadas'],['connecting','Conectando'],['close','Desconectadas']];
  const SORTS=[['name','Nome (A–Z)'],['recent','Mais recentes'],['msgs','Mais mensagens'],['status','Conectadas primeiro']];
  const COLS=[['num','Número','phone'],['status','Status','status'],['int','Integração','plug'],['db','Banco','db'],['msgs','Mensagens','msgs'],['contacts','Contatos','users'],['created','Criada em','cal'],['owner','Dono','user']];
  const RANK={open:0,connecting:1,close:2};
  const SETTINGS=[['rejectCall','Rejeitar chamadas'],['groupsIgnore','Ignorar grupos'],['alwaysOnline','Sempre online'],['readMessages','Marcar mensagens como lidas'],['readStatus','Marcar status como vistos'],['syncFullHistory','Sincronizar histórico completo']];
  const tn=v=>fmt(v).replace(/\./g,' ');
  const rtf=new Intl.RelativeTimeFormat('pt-BR',{numeric:'auto'});
  function rel(t){const d=t?new Date(t).getTime():NaN;if(!Number.isFinite(d))return'—';const s=(d-Date.now())/1e3,a=Math.abs(s);if(a<45)return'agora há pouco';
    const u=a<3600?[s/60,'minute']:a<86400?[s/3600,'hour']:a<2592e3?[s/86400,'day']:a<31536e3?[s/2592e3,'month']:[s/31536e3,'year'];return rtf.format(Math.round(u[0]),u[1]);}
  function full(t){const d=t?new Date(t):null;return d&&!isNaN(d.getTime())?d.toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'}):'';}
  function readView(){const d={view:'all',sort:'name',ints:[],hide:[],side:'open'};try{const o=JSON.parse(ls_('wa-ut-instances')||'{}')||{};
    return{view:VIEWS.some(t=>t[0]===o.view)?o.view:'all',sort:SORTS.some(t=>t[0]===o.sort)?o.sort:'name',ints:Array.isArray(o.ints)?o.ints.filter(x=>typeof x==='string'):[],hide:Array.isArray(o.hide)?o.hide.filter(x=>typeof x==='string'):[],side:o.side==='closed'?'closed':'open'}}catch(e){return d}}
  function TxtBtn({icon,label,active,count,...p}){return i.jsxs('button',{type:'button',className:'wa-ut-tbtn','data-active':active?'true':void 0,...p,children:[icon?svg(icon,14):null,i.jsx('span',{children:label}),count?i.jsx('span',{className:'wa-ut-tbtn-n',children:count}):null]});}
  function Avatar({x,size}){const t=String(x.name||x.profileName||'?').trim();const[bad,setBad]=y.useState(!1);
    return x.profilePicUrl&&!bad?i.jsx('img',{className:'wa-ut-av','data-size':size,src:x.profilePicUrl,alt:'',loading:'lazy',onError:()=>setBad(!0)}):i.jsx('span',{className:'wa-ut-av','data-size':size,'aria-hidden':'true',children:(t[0]||'?').toUpperCase()});}
  function Pill({mono,children}){return i.jsx('span',{className:'wa-ut-pill'+(mono?' wa-ut-mono':''),children});}
  function phoneOf(x){return x.ownerJid||x.number?waPhoneBR(x.ownerJid||x.number):'';}
  function SkeletonRows({cols,n}){return Array.from({length:n||6},(_,r)=>i.jsx('tr',{className:'wa-ut-skrow','aria-hidden':'true',children:Array.from({length:cols},(_,c)=>i.jsx('td',{className:c===0?'wa-ut-c-check':c===cols-1?'wa-ut-c-menu':void 0,children:c===0||c===cols-1?null:i.jsx('span',{className:'wa-ut-sk',style:{width:(c===1?62:40+((r*13+c*7)%40))+'%'}})},c))},'sk'+r));}
  function cellOf(k,x,busy){const n=x._count||{},it=intOf(x),db=dbOf(x.dbMode),ph=phoneOf(x);
    switch(k){
      case'num':return ph?i.jsx(Pill,{mono:!0,children:ph}):i.jsx('span',{className:'wa-ut-muted',children:'—'});
      case'status':return i.jsx(StatusChip,{status:x.connectionStatus,busy});
      case'int':return i.jsx(Pill,{children:it[1]});
      case'db':return db?i.jsx(Pill,{children:db[1]}):i.jsx('span',{className:'wa-ut-muted',children:'—'});
      case'msgs':return tn(n.Message||0);
      case'contacts':return tn(n.Contact||0);
      case'created':return i.jsx('span',{title:full(x.createdAt)||void 0,children:rel(x.createdAt)});
      case'owner':return x.profileName?i.jsxs('span',{className:'wa-ut-owner',children:[i.jsx('span',{className:'wa-ut-av','data-size':'xs','aria-hidden':'true',children:String(x.profileName).trim().slice(0,1).toUpperCase()}),i.jsx('span',{className:'wa-ut-trunc',children:x.profileName})]}):i.jsx('span',{className:'wa-ut-muted',children:'—'});
    }return null;}

  /* dialogs (Radix Dialog of the bundle: overlay, title, description, close X, Esc, focus trap, aria-modal) */
  function ConfirmDialog({open,onOpenChange,title,desc,children,action,danger,busy,disabled,onAction}){
    return i.jsx(Pt,{open,onOpenChange:o=>{if(!busy)onOpenChange(o)},children:i.jsxs(Nt,{className:'wa-ut-dialog',children:[
      i.jsxs(Mt,{children:[i.jsx(zt,{children:title}),i.jsx(eo,{children:desc})]}),children||null,
      i.jsxs(Yt,{className:'wa-ut-dfoot',children:[i.jsx(se,{type:'button',variant:'outline',disabled:busy,onClick:()=>onOpenChange(!1),children:'Cancelar'}),
        i.jsx(se,{type:'button',variant:danger?'destructive':'default',disabled:busy||disabled,'aria-busy':busy?'true':void 0,onClick:onAction,children:action})]})]})});}
  function DeleteDialog({name,onClose,onConfirm}){const[v,setV]=y.useState(''),ok=v.trim()===name;
    return i.jsx(ConfirmDialog,{open:!0,onOpenChange:o=>{o||onClose()},title:'Excluir a instância '+name+'?',danger:!0,disabled:!ok,action:'Excluir instância',onAction:()=>{ok&&onConfirm()},
      desc:'O WhatsApp deste número é desconectado e a instância sai do WhatsAI junto com as conversas, contatos, mensagens e configurações dela. Não dá para desfazer.',
      children:i.jsxs('form',{className:'wa-ut-dform',onSubmit:e=>{e.preventDefault();ok&&onConfirm()},children:[
        i.jsxs('label',{htmlFor:'wa-ut-del-name',className:'wa-ut-dlabel',children:['Digite ',i.jsx('strong',{children:name}),' para confirmar']}),
        i.jsx('input',{id:'wa-ut-del-name',className:'wa-ut-dinput',autoComplete:'off',spellCheck:'false',value:v,onChange:e=>setV(e.target.value),'aria-invalid':v&&!ok?'true':void 0})]})});}
  function LogoutDialog({name,onClose,onConfirm}){const[busy,setBusy]=y.useState(!1);
    return i.jsx(ConfirmDialog,{open:!0,onOpenChange:o=>{o||onClose()},title:'Desconectar '+name+'?',danger:!0,busy,action:busy?'Desconectando…':'Desconectar',
      desc:'O WhatsApp deste número sai do WhatsAI e a IA para de responder até você conectar de novo pelo QR Code. Conversas e configurações continuam salvas.',
      onAction:async()=>{setBusy(!0);try{await onConfirm()}finally{setBusy(!1)}}});}

  /* record side panel with tabs */
  function Prop({icon,label,children}){return i.jsxs('div',{className:'wa-ut-prop',children:[i.jsxs('dt',{children:[svg(icon,14),i.jsx('span',{children:label})]}),i.jsx('dd',{children})]});}
  function UsageTab({x}){const s=useSummary(x.name);
    if(s.st==='loading')return i.jsxs('div',{className:'wa-ut-tabpane',children:[i.jsx('span',{className:'wa-ut-sk',style:{width:'70%'}}),i.jsx('span',{className:'wa-ut-sk',style:{width:'45%'}})]});
    if(s.st!=='ok')return i.jsx('p',{className:'wa-ut-muted wa-ut-tabpane',children:s.st==='none'?'Esta API ainda não tem Plano e limites.':'Não foi possível ler o uso agora.'});
    const m=s.data.month,t=s.data.today||{},lim=Number(m.limit)||0,used=Number(m.responses)||0,pct=lim?used/lim*100:null,lv=level(pct);
    return i.jsxs('div',{className:'wa-ut-tabpane',children:[
      i.jsxs('dl',{className:'wa-ut-props',children:[
        i.jsx(Prop,{icon:'cal',label:'Hoje',children:fmt(t.responses)+(t.limit?' de '+fmt(t.limit):'')+' respostas'}),
        i.jsx(Prop,{icon:'msgs',label:'Este mês',children:fmt(used)+' respostas'}),
        i.jsx(Prop,{icon:'db',label:'Franquia',children:lim?fmt(lim)+' por mês':'Sem limite'}),
        lim?i.jsx(Prop,{icon:'status',label:used>lim?'Excedente':'Restante',children:i.jsx('span',{className:used>lim?'wa-ut-bad':'wa-ut-good',children:fmt(Math.abs(lim-used))})}):null]}),
      lim?i.jsxs('div',{className:'wa-ut-tabmeter',children:[i.jsxs('div',{className:'wa-ut-pop-pct',children:[i.jsx('span',{children:'Uso'}),i.jsx('span',{children:pf.format(pct)+'%'})]}),
        i.jsx('div',{className:'wa-ut-pop-bar','data-tone':lv[0],role:'progressbar','aria-label':'Uso da franquia do mês','aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':Math.round(Math.min(100,pct)),children:i.jsx('span',{style:{width:Math.min(100,pct)+'%'}})}),
        i.jsxs('p',{className:'wa-ut-pop-status',children:[i.jsx('span',{className:'wa-ut-usage-dot','data-tone':lv[0],'aria-hidden':'true'}),lv[1]]})]}):null,
      i.jsxs(Fu,{to:'/manager/instance/'+x.id+'/usage',className:'wa-ut-pop-link',children:['Plano e limites',svg('arrow',14)]})]});}
  function Panel({x,busy,onClose,onAsk,go}){
    const[tab,setTab]=y.useState('sum'),[show,setShow]=y.useState(!1),ref=y.useRef(null),closeRef=y.useRef(null),n=x._count||{},it=intOf(x),db=dbOf(x.dbMode),ph=phoneOf(x),set_=x.Setting||null;
    y.useEffect(()=>{setTab('sum');setShow(!1);closeRef.current&&closeRef.current.focus()},[x.id]);
    y.useEffect(()=>{const k=e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!document.querySelector('[role="dialog"][data-state="open"].wa-ut-dialog, [role="menu"]')){e.preventDefault();onClose()}};window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[onClose]);
    const TABS_=[['sum','Resumo'],['cfg','Configurações'],['use','Uso']];
    const onTabKey=e=>{const ix=TABS_.findIndex(t=>t[0]===tab);let j=ix;if(e.key==='ArrowRight')j=(ix+1)%3;else if(e.key==='ArrowLeft')j=(ix+2)%3;else return;e.preventDefault();setTab(TABS_[j][0]);const b=document.getElementById('wa-ut-tab-'+TABS_[j][0]);b&&b.focus()};
    const tok=String(x.token||'');
    return i.jsxs(i.Fragment,{children:[i.jsx('div',{className:'wa-ut-backdrop','aria-hidden':'true',onClick:onClose}),
      i.jsxs('aside',{ref,className:'wa-ut-panel',role:'dialog','aria-modal':'false','aria-labelledby':'wa-ut-panel-title',children:[
      i.jsxs('header',{className:'wa-ut-panel-bar',children:[
        i.jsxs('button',{type:'button',className:'wa-ut-tbtn wa-ut-tbtn--line',onClick:()=>go(x),children:[svg('ext',14),i.jsx('span',{children:'Abrir'})]}),
        i.jsxs('div',{className:'wa-ut-panel-bar-end',children:[
          i.jsx('button',{type:'button',className:'wa-ut-ibtn','aria-label':'Copiar token',title:'Copiar token',onClick:()=>copyText(tok,'Token copiado.'),children:svg('copy',15)}),
          i.jsx('button',{ref:closeRef,type:'button',className:'wa-ut-ibtn','aria-label':'Fechar painel',title:'Fechar (Esc)',onClick:onClose,children:svg('x',16)})]})]}),
      i.jsxs('div',{className:'wa-ut-panel-id',children:[i.jsx(Avatar,{x,size:'lg'}),i.jsxs('div',{className:'wa-ut-panel-idtext',children:[i.jsx('h2',{id:'wa-ut-panel-title',className:'wa-ut-panel-title',children:x.name}),i.jsx(StatusChip,{status:x.connectionStatus,busy})]})]}),
      i.jsx('div',{className:'wa-ut-ptabs',role:'tablist','aria-label':'Seções da instância',onKeyDown:onTabKey,children:TABS_.map(([k,lb])=>i.jsx('button',{type:'button',role:'tab',id:'wa-ut-tab-'+k,'aria-selected':tab===k?'true':'false','aria-controls':'wa-ut-tp-'+k,tabIndex:tab===k?0:-1,className:'wa-ut-ptab',onClick:()=>setTab(k),children:lb},k))}),
      i.jsxs('div',{className:'wa-ut-panel-body',role:'tabpanel',id:'wa-ut-tp-'+tab,'aria-labelledby':'wa-ut-tab-'+tab,tabIndex:0,children:[
        tab==='sum'?i.jsxs(i.Fragment,{children:[
          i.jsxs('dl',{className:'wa-ut-props',children:[
            i.jsx(Prop,{icon:'phone',label:'Número',children:ph?i.jsx(Pill,{mono:!0,children:ph}):i.jsx('span',{className:'wa-ut-muted',children:'Ainda sem número'})}),
            i.jsx(Prop,{icon:'user',label:'Perfil',children:x.profileName||i.jsx('span',{className:'wa-ut-muted',children:'—'})}),
            i.jsx(Prop,{icon:'plug',label:'Integração',children:i.jsx(Pill,{children:it[1]})}),
            db?i.jsx(Prop,{icon:'db',label:'Banco',children:i.jsx(Pill,{children:db[1]})}):null,
            i.jsx(Prop,{icon:'cal',label:'Criada em',children:full(x.createdAt)?i.jsxs('span',{children:[full(x.createdAt),i.jsx('span',{className:'wa-ut-muted',children:' · '+rel(x.createdAt)})]}):'—'}),
            i.jsx(Prop,{icon:'msgs',label:'Mensagens',children:tn(n.Message||0)}),
            i.jsx(Prop,{icon:'users',label:'Contatos',children:tn(n.Contact||0)}),
            i.jsx(Prop,{icon:'chat',label:'Chats',children:tn(n.Chat||0)}),
            i.jsx(Prop,{icon:'lock',label:'Token',children:i.jsxs('span',{className:'wa-ut-tok',children:[i.jsx('span',{className:'wa-ut-mono wa-ut-trunc',children:show?tok:'••••••••••••'}),
              i.jsx('button',{type:'button',className:'wa-ut-ibtn','aria-label':show?'Esconder token':'Mostrar token','aria-pressed':show?'true':'false',onClick:()=>setShow(v=>!v),children:svg('eye',14)})]})})]}),
          i.jsxs('div',{className:'wa-ut-panel-actions',children:[
            i.jsx(se,{type:'button',size:'sm',onClick:()=>go(x),children:'Abrir instância'}),
            x.connectionStatus!=='open'?i.jsx(se,{type:'button',size:'sm',variant:'outline',onClick:()=>go(x),children:'Conectar (QR Code)'}):i.jsx(se,{type:'button',size:'sm',variant:'outline',onClick:()=>onAsk('logout',x),children:'Desconectar'}),
            i.jsx(se,{type:'button',size:'sm',variant:'outline',className:'wa-ut-danger-btn',disabled:busy,onClick:()=>onAsk('delete',x),children:'Excluir'})]})]}):null,
        tab==='cfg'?i.jsxs('div',{className:'wa-ut-tabpane',children:[set_?i.jsx('dl',{className:'wa-ut-props',children:SETTINGS.map(([k,lb])=>i.jsx(Prop,{icon:'cog',label:lb,children:set_[k]?i.jsx(Chip,{tone:'ok',icon:'check',children:'Ativado'}):i.jsx(Chip,{tone:'off',children:'Desativado'})},k))}):
            i.jsx('p',{className:'wa-ut-muted',children:'As configurações aparecem quando a instância é aberta.'}),
          i.jsxs('button',{type:'button',className:'wa-ut-pop-link wa-ut-linkbtn',onClick:()=>go(x,'settings'),children:['Editar configurações',svg('arrow',14)]})]}):null,
        tab==='use'?i.jsx(UsageTab,{x}):null]})]})]});
  }

  function Instances({list,loading,refresh,remove,logout,deleting,create}){
    const nav=dn(),[v,setV]=y.useState(readView),[q,setQ]=y.useState(''),[searchOpen,setSearchOpen]=y.useState(!1),[sel,setSel]=y.useState([]),[spin,setSpin]=y.useState(!1),
      [openId,setOpenId]=y.useState(null),[ask,setAsk]=y.useState(null),[drawer,setDrawer]=y.useState(!1),[bye,setBye]=y.useState(!1),inp=y.useRef(null);
    const set=p=>setV(o=>{const n={...o,...p};ls_('wa-ut-instances',JSON.stringify(n));return n});
    const all=Array.isArray(list)?list.filter(Boolean):[],busy=Array.isArray(deleting)?deleting:[];
    const count=k=>k==='all'?all.length:all.filter(x=>x.connectionStatus===k).length;
    const hasDb=all.some(x=>dbOf(x.dbMode));
    const cols=COLS.filter(c=>(c[0]!=='db'||hasDb)&&!v.hide.includes(c[0]));
    const rows=y.useMemo(()=>{const nq=q.trim().toLowerCase(),dq=nq.replace(/\D/g,'');
      let r=all.filter(x=>v.view==='all'||x.connectionStatus===v.view);
      if(v.ints.length)r=r.filter(x=>v.ints.includes(intOf(x)[0]));
      if(nq)r=r.filter(x=>String(x.name||'').toLowerCase().includes(nq)||String(x.profileName||'').toLowerCase().includes(nq)||(dq.length>2&&String(x.ownerJid||x.number||'').includes(dq)));
      const byName=(a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR');
      const cmp=v.sort==='msgs'?(a,b)=>((b._count&&b._count.Message)||0)-((a._count&&a._count.Message)||0)||byName(a,b)
        :v.sort==='status'?(a,b)=>(RANK[a.connectionStatus]??3)-(RANK[b.connectionStatus]??3)||byName(a,b)
        :v.sort==='recent'?(a,b)=>(new Date(b.createdAt).getTime()||0)-(new Date(a.createdAt).getTime()||0)||byName(a,b):byName;
      return r.slice().sort(cmp);},[list,v,q]);
    y.useEffect(()=>{setSel(s=>s.filter(n=>all.some(x=>x.name===n)));openId&&!all.some(x=>x.id===openId)&&list&&setOpenId(null)},[list]);
    y.useEffect(()=>{if(searchOpen&&inp.current)inp.current.focus()},[searchOpen]);
    y.useEffect(()=>{if(!drawer)return;const k=e=>{e.key==='Escape'&&setDrawer(!1)};window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[drawer]);
    const ids=rows.map(x=>x.name),allSel=ids.length>0&&ids.every(n=>sel.includes(n)),someSel=!allSel&&ids.some(n=>sel.includes(n));
    const toggleAll=()=>setSel(allSel?sel.filter(n=>!ids.includes(n)):[...new Set([...sel,...ids])]);
    const toggle=n=>setSel(s=>s.includes(n)?s.filter(x=>x!==n):[...s,n]);
    const go=(x,p)=>nav('/manager/instance/'+x.id+'/'+(p||'dashboard'));
    const doRefresh=async()=>{setSpin(!0);try{await refresh()}finally{setSpin(!1)}};
    const openSearch=()=>{setDrawer(!1);setSearchOpen(!0);setTimeout(()=>inp.current&&inp.current.focus(),0)};
    const cur=(()=>{let id=null;try{id=localStorage.getItem('instanceId')}catch(e){}return all.find(x=>x.id===id)||all.find(x=>x.connectionStatus==='open')||all[0]||null})();
    const sel_=all.find(x=>x.id===openId)||null;
    const onAsk=(kind,x)=>setAsk({kind,x});
    const doDelete=x=>{setAsk(null);openId===x.id&&setOpenId(null);remove(x.name)};
    const doLogout=async x=>{try{await logout(x.name);me.success('Instância desconectada.');setAsk(null);await refresh()}catch(e){const m=e&&e.response&&e.response.data&&e.response.data.response&&e.response.data.response.message;me.error('Não foi possível desconectar.'+(m?' '+[].concat(m).join(' '):''))}};
    const viewLabel=(VIEWS.find(t=>t[0]===v.view)||VIEWS[0])[1];
    const navItem=(icon,label,to,active,extra)=>i.jsx('li',{children:i.jsxs(to?Fu:'button',{...(to?{to}:{type:'button'}),className:'wa-ut-nav-item','aria-current':active?'page':void 0,...extra,children:[svg(icon,15),i.jsx('span',{children:label})]})});
    const nCols=cols.length+3,chipsOn=v.ints.length;
    let body;
    if(!all.length&&loading)body=i.jsx(SkeletonRows,{cols:nCols});
    else body=rows.map(x=>{const st=x.connectionStatus,isBusy=busy.includes(x.name);
      return i.jsxs('tr',{className:'wa-ut-row','data-row-id':x.id,'data-status':st||'unknown','data-selected':sel.includes(x.name)?'true':void 0,'data-open':openId===x.id?'true':void 0,'aria-busy':isBusy?'true':void 0,
        onClick:e=>{if(e.defaultPrevented||e.target.closest('a,button,input,label,[role="menu"],[role="menuitem"]'))return;setOpenId(x.id)},children:[
        i.jsx('td',{className:'wa-ut-c-check',children:i.jsx('input',{type:'checkbox',className:'wa-ut-check',checked:sel.includes(x.name),onChange:()=>toggle(x.name),'aria-label':'Selecionar '+x.name})}),
        i.jsx('td',{className:'wa-ut-c-name',children:i.jsxs('span',{className:'wa-ut-namecell',children:[i.jsx(Avatar,{x}),
          i.jsx('button',{type:'button',className:'wa-ut-name','aria-haspopup':'dialog',onClick:()=>setOpenId(x.id),children:x.name})]})}),
        cols.map(c=>i.jsx('td',{className:'wa-ut-c-'+c[0]+(c[0]==='msgs'||c[0]==='contacts'?' wa-ut-c-n':''),children:cellOf(c[0],x,isBusy)},c[0])),
        i.jsx('td',{className:'wa-ut-c-menu',children:i.jsxs(Kr,{children:[
          i.jsx(Wr,{asChild:!0,children:i.jsx('button',{type:'button',className:'wa-ut-ibtn','data-wu-row-menu':'','aria-label':'Ações de '+x.name,children:svg('more',16)})}),
          i.jsxs(hr,{align:'end',className:'wa-ut-menu',children:[
            i.jsxs(wt,{onSelect:()=>setOpenId(x.id),children:[svg('panel',14),'Ver detalhes']}),
            i.jsxs(wt,{onSelect:()=>go(x),children:[svg('ext',14),'Abrir']}),
            st!=='open'?i.jsxs(wt,{onSelect:()=>go(x),children:[svg('qr',14),'Conectar (QR Code)']}):i.jsxs(wt,{onSelect:()=>onAsk('logout',x),children:[svg('unplug',14),'Desconectar']}),
            i.jsxs(wt,{onSelect:()=>go(x,'chat'),children:[svg('chat',14),'Conversas']}),
            i.jsxs(wt,{onSelect:()=>go(x,'settings'),children:[svg('cog',14),'Configurações']}),
            i.jsxs(wt,{onSelect:()=>copyText(x.token,'Token copiado.'),children:[svg('copy',14),'Copiar token']}),
            i.jsx('div',{role:'separator',className:'wa-ut-menu-sep'}),
            i.jsxs(wt,{className:'wa-ut-danger',disabled:isBusy,onSelect:()=>onAsk('delete',x),children:[svg('trash',14),isBusy?'Excluindo…':'Excluir']})]})]})})]},x.id||x.name)});
    const empty=!loading&&(all.length?!rows.length:!0);
    return i.jsxs('div',{className:'wa-ut-app','data-side':v.side,'data-drawer':drawer?'true':void 0,'data-panel':sel_?'true':void 0,children:[
      drawer?i.jsx('div',{className:'wa-ut-scrim','aria-hidden':'true',onClick:()=>setDrawer(!1)}):null,
      i.jsxs('nav',{className:'wa-ut-side',id:'wa-ut-side','aria-label':'Menu do painel',children:[
        i.jsxs('div',{className:'wa-ut-side-top',children:[
          i.jsxs(Kr,{children:[i.jsx(Wr,{asChild:!0,children:i.jsxs('button',{type:'button',className:'wa-ut-ws','aria-label':'WhatsAI: trocar de instância',children:[i.jsx('span',{className:'wa-wordmark',children:'WhatsAI'}),svg('chev',14)]})}),
            i.jsxs(hr,{align:'start',className:'wa-ut-menu',children:[i.jsx('p',{className:'wa-ut-menu-label',children:'Abrir instância'}),all.length?all.slice(0,12).map(x=>i.jsxs(wt,{onSelect:()=>go(x),children:[i.jsx('span',{className:'wa-ut-chip-dot','data-tone':x.connectionStatus==='open'?'ok':x.connectionStatus==='connecting'?'warn':'bad','aria-hidden':'true'}),x.name]},x.id)):i.jsx('p',{className:'wa-ut-menu-label',children:'Nenhuma instância'})]})]}),
          i.jsxs('div',{className:'wa-ut-side-icons',children:[
            i.jsx('button',{type:'button',className:'wa-ut-ibtn','aria-label':'Buscar instâncias',title:'Buscar',onClick:openSearch,children:svg('search',15)}),
            i.jsx('button',{type:'button',className:'wa-ut-ibtn wa-ut-side-collapse','aria-label':'Recolher menu',title:'Recolher menu',onClick:()=>{setDrawer(!1);set({side:'closed'})},children:svg('panel',15)})]})]}),
        i.jsx('p',{className:'wa-ut-side-label',children:'Espaço de trabalho'}),
        i.jsxs('ul',{className:'wa-ut-nav',children:[
          navItem('db','Instâncias',null,!0,{onClick:()=>setDrawer(!1)}),
          cur?navItem('chat','Conversas','/manager/instance/'+cur.id+'/chat'):null,
          cur?navItem('gauge','Plano e limites','/manager/instance/'+cur.id+'/usage'):null,
          navItem('pulse','Observabilidade','/manager/observability')]}),
        i.jsx('p',{className:'wa-ut-side-label',children:'Outros'}),
        i.jsxs('ul',{className:'wa-ut-nav',children:[
          cur?navItem('cog','Configurações','/manager/instance/'+cur.id+'/settings'):null,
          i.jsx('li',{children:i.jsxs('a',{href:'/readme',className:'wa-ut-nav-item',children:[svg('book',15),i.jsx('span',{children:'Manual'})]})}),
          navItem('logout','Sair',null,!1,{onClick:()=>setBye(!0)})]}),
        cur?i.jsxs('p',{className:'wa-ut-side-note',children:['Atalhos abrem ',i.jsx('strong',{children:cur.name})]}):null]}),
      i.jsxs('section',{className:'wa-ut-main','aria-labelledby':'wa-ut-title',children:[
        i.jsxs('header',{className:'wa-ut-top',children:[
          i.jsx('button',{type:'button',className:'wa-ut-ibtn wa-ut-side-open','aria-label':'Abrir menu','aria-expanded':drawer||v.side==='open'?'true':'false','aria-controls':'wa-ut-side',onClick:()=>{if(window.matchMedia('(min-width: 1024px)').matches)set({side:'open'});else setDrawer(d=>!d)},children:svg('menu',17)}),
          i.jsxs('h1',{id:'wa-ut-title',className:'wa-ut-title',children:[i.jsx('span',{className:'wa-ut-title-ic',children:svg('db',14)}),'Instâncias']}),
          i.jsxs('div',{className:'wa-ut-top-actions',children:[create,
            i.jsxs(Kr,{children:[i.jsx(Wr,{asChild:!0,children:i.jsxs('button',{type:'button',className:'wa-ut-tbtn wa-ut-tbtn--line',children:[svg('more',14),i.jsx('span',{children:'Mais'})]})}),
              i.jsxs(hr,{align:'end',className:'wa-ut-menu',children:[
                i.jsxs(wt,{onSelect:doRefresh,children:[svg('refresh',14),'Atualizar lista']}),
                i.jsxs(wt,{disabled:!sel.length,onSelect:()=>copyText(sel.join('\n'),sel.length===1?'Nome copiado.':'Nomes copiados.'),children:[svg('copy',14),'Copiar nomes selecionados']}),
                i.jsx('div',{role:'separator',className:'wa-ut-menu-sep'}),
                i.jsxs(wt,{onSelect:()=>nav('/manager/observability'),children:[svg('pulse',14),'Observabilidade']}),
                i.jsxs(wt,{onSelect:()=>{window.location.href='/readme'},children:[svg('book',14),'Manual']})]})]})]})]}),
        i.jsxs('div',{className:'wa-ut-viewbar',children:[
          i.jsxs(Kr,{children:[i.jsx(Wr,{asChild:!0,children:i.jsxs('button',{type:'button',className:'wa-ut-viewpick','aria-label':'Visão: '+viewLabel,children:[svg('list',14),i.jsx('span',{className:'wa-ut-viewpick-t',children:viewLabel}),i.jsx('span',{className:'wa-ut-viewpick-n',children:'· '+(all.length||!loading?count(v.view):'…')}),svg('chev',13)]})}),
            i.jsxs(hr,{align:'start',className:'wa-ut-menu',children:[i.jsx('p',{className:'wa-ut-menu-label',children:'Visões'}),VIEWS.map(([k,lb])=>i.jsxs(aM,{checked:v.view===k,onCheckedChange:c=>{c&&set({view:k})},children:[i.jsx('span',{className:'wa-ut-grow',children:lb}),i.jsx('span',{className:'wa-ut-menu-n',children:count(k)})]},k))]})]}),
          i.jsxs('div',{className:'wa-ut-viewtools',children:[
            i.jsx(TxtBtn,{icon:'search',label:'Buscar',active:searchOpen||!!q,'aria-expanded':searchOpen?'true':'false','aria-controls':'wa-ut-search',onClick:()=>{if(searchOpen&&!q)setSearchOpen(!1);else openSearch()}}),
            i.jsxs(Kr,{children:[i.jsx(Wr,{asChild:!0,children:i.jsx(TxtBtn,{label:'Filtro',active:chipsOn>0,count:chipsOn})}),
              i.jsxs(hr,{align:'end',className:'wa-ut-menu',children:[i.jsx('p',{className:'wa-ut-menu-label',children:'Integração'}),[['baileys','Baileys'],['cloud','Cloud API']].map(([k,lb])=>i.jsx(aM,{checked:v.ints.includes(k),onSelect:e=>e.preventDefault(),onCheckedChange:c=>set({ints:c?[...new Set([...v.ints,k])]:v.ints.filter(z=>z!==k)}),children:lb},k)),
                chipsOn?i.jsx('div',{role:'separator',className:'wa-ut-menu-sep'}):null,chipsOn?i.jsx(wt,{onSelect:()=>set({ints:[]}),children:'Limpar filtro'}):null]})]}),
            i.jsxs(Kr,{children:[i.jsx(Wr,{asChild:!0,children:i.jsx(TxtBtn,{label:'Ordenar',active:v.sort!=='name'})}),
              i.jsxs(hr,{align:'end',className:'wa-ut-menu',children:[i.jsx('p',{className:'wa-ut-menu-label',children:'Ordenar por'}),SORTS.map(([k,lb])=>i.jsx(aM,{checked:v.sort===k,onCheckedChange:c=>{c&&set({sort:k})},children:lb},k))]})]}),
            i.jsxs(Kr,{children:[i.jsx(Wr,{asChild:!0,children:i.jsx(TxtBtn,{label:'Opções'})}),
              i.jsxs(hr,{align:'end',className:'wa-ut-menu',children:[i.jsx('p',{className:'wa-ut-menu-label',children:'Colunas visíveis'}),COLS.filter(c=>c[0]!=='db'||hasDb).map(([k,lb])=>i.jsx(aM,{checked:!v.hide.includes(k),onSelect:e=>e.preventDefault(),onCheckedChange:c=>set({hide:c?v.hide.filter(z=>z!==k):[...v.hide,k]}),children:lb},k)),
                i.jsx('div',{role:'separator',className:'wa-ut-menu-sep'}),i.jsxs(wt,{onSelect:doRefresh,children:[svg('refresh',14),spin?'Atualizando…':'Atualizar lista']})]})]})]})]}),
        searchOpen||q?i.jsxs('div',{className:'wa-ut-search',id:'wa-ut-search',children:[svg('search',14),
          i.jsx('input',{ref:inp,type:'search',className:'wa-ut-search-in',placeholder:'Buscar por nome, perfil ou número',value:q,'aria-label':'Buscar instâncias',onChange:e=>setQ(e.target.value),onKeyDown:e=>{if(e.key==='Escape'){setQ('');setSearchOpen(!1)}}}),
          q?i.jsx('button',{type:'button',className:'wa-ut-ibtn','aria-label':'Limpar busca',onClick:()=>{setQ('');inp.current&&inp.current.focus()},children:svg('x',14)}):null]}):null,
        sel.length?i.jsxs('div',{className:'wa-ut-selbar',role:'status',children:[i.jsx('span',{children:sel.length===1?'1 selecionada':sel.length+' selecionadas'}),
          i.jsxs('button',{type:'button',className:'wa-ut-tbtn wa-ut-tbtn--line',onClick:()=>copyText(sel.join('\n'),sel.length===1?'Nome copiado.':'Nomes copiados.'),children:[svg('copy',14),i.jsx('span',{children:'Copiar nomes'})]}),
          i.jsx('button',{type:'button',className:'wa-ut-tbtn',onClick:()=>setSel([]),children:i.jsx('span',{children:'Limpar seleção'})})]}):null,
        i.jsx('div',{className:'wa-ut-tablewrap','data-wa-instances':'','aria-busy':loading?'true':void 0,tabIndex:0,'aria-label':'Tabela de instâncias (role para os lados no celular)',children:i.jsxs('table',{className:'wa-ut-table',children:[
          i.jsx('caption',{className:'sr-only',children:'Instâncias de WhatsApp'}),
          i.jsx('thead',{children:i.jsxs('tr',{children:[
            i.jsx('th',{scope:'col',className:'wa-ut-c-check',children:i.jsx('input',{type:'checkbox',className:'wa-ut-check',checked:allSel,ref:el=>{el&&(el.indeterminate=someSel)},onChange:toggleAll,disabled:!rows.length,'aria-label':'Selecionar todas'})}),
            i.jsx('th',{scope:'col',className:'wa-ut-c-name',children:i.jsxs('span',{className:'wa-ut-th',children:[svg('user',14),'Nome']})}),
            cols.map(c=>i.jsx('th',{scope:'col',className:'wa-ut-c-'+c[0]+(c[0]==='msgs'||c[0]==='contacts'?' wa-ut-c-n':''),children:i.jsxs('span',{className:'wa-ut-th',children:[svg(c[2],14),c[1]]})},c[0])),
            i.jsx('th',{scope:'col',className:'wa-ut-c-menu',children:i.jsx('span',{className:'sr-only',children:'Ações'})})]})}),
          i.jsx('tbody',{children:body})]})}),
        empty?i.jsxs('div',{className:'wa-ut-empty',children:[i.jsx('p',{className:'wa-ut-empty-title',children:all.length?'Nenhuma instância nesta visão':list?'Nenhuma instância ainda':'Não foi possível carregar as instâncias'}),
          i.jsx('p',{className:'wa-ut-muted',children:all.length?'Troque a visão, limpe o filtro ou a busca.':list?'Crie a primeira com o botão “Nova instância”.':'Confira a conexão e use Mais → Atualizar lista.'}),
          all.length&&(q||chipsOn||v.view!=='all')?i.jsx('button',{type:'button',className:'wa-ut-tbtn wa-ut-tbtn--line',onClick:()=>{setQ('');set({view:'all',ints:[]})},children:i.jsx('span',{children:'Mostrar todas'})}):null]}):null,
        all.length?i.jsx('p',{className:'wa-ut-foot','aria-live':'polite',children:fmt(all.length)+(all.length===1?' instância':' instâncias')+' · '+fmt(count('open'))+(count('open')===1?' conectada':' conectadas')+(rows.length!==all.length?' · mostrando '+fmt(rows.length):'')}):null]}),
      sel_?i.jsx(Panel,{x:sel_,busy:busy.includes(sel_.name),onClose:()=>{const id=sel_.id;setOpenId(null);setTimeout(()=>{const b=document.querySelector('tr[data-row-id="'+id+'"] .wa-ut-name');b&&b.focus()},0)},onAsk,go}):null,
      ask&&ask.kind==='delete'?i.jsx(DeleteDialog,{name:ask.x.name,onClose:()=>setAsk(null),onConfirm:()=>doDelete(ask.x)},'del-'+ask.x.id):null,
      ask&&ask.kind==='logout'?i.jsx(LogoutDialog,{name:ask.x.name,onClose:()=>setAsk(null),onConfirm:()=>doLogout(ask.x)},'out-'+ask.x.id):null,
      bye?i.jsx(ConfirmDialog,{open:!0,onOpenChange:setBye,title:'Sair do painel?',desc:'Para entrar de novo você vai precisar da URL do servidor e da chave de API.',danger:!0,action:'Sair',onAction:()=>{Pj();nav('/manager/login')}}):null]});
  }

  /* ---------------------------------------------------------------- usage chip + popover (top bar) */
  function UsageChip(){
    const{instance:g}=ct(),name=g&&g.name,s=useSummary(name),[open,setOpen]=y.useState(!1),ref=y.useRef(null),btn=y.useRef(null);
    y.useEffect(()=>{if(!open)return;const d=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(!1)},k=e=>{if(e.key==='Escape'){setOpen(!1);btn.current&&btn.current.focus()}};
      document.addEventListener('pointerdown',d);window.addEventListener('keydown',k);return()=>{document.removeEventListener('pointerdown',d);window.removeEventListener('keydown',k)}},[open]);
    if(!g||s.st!=='ok'||!s.data||!s.data.month)return null;
    const m=s.data.month,t=s.data.today||{},lim=Number(m.limit)||0,used=Number(m.responses)||0,pct=lim?used/lim*100:null,lv=level(pct),plan=s.data.limits&&s.data.limits.planName;
    const toggle=()=>{setOpen(o=>{!o&&s.load(!0);return!o})};
    return i.jsxs('div',{className:'wa-ut-usage',ref,children:[
      i.jsxs('button',{ref:btn,type:'button',className:'wa-ut-usage-btn','aria-expanded':open?'true':'false','aria-controls':'wa-ut-usage-pop','aria-haspopup':'dialog',onClick:toggle,
        title:'Respostas da IA neste mês',children:[
        i.jsx('span',{className:'wa-ut-usage-dot','data-tone':lv?lv[0]:'off','aria-hidden':'true'}),
        i.jsx('span',{className:'wa-ut-usage-label',children:'Respostas da IA:'}),
        i.jsx('span',{className:'wa-ut-usage-val',children:lim?fmt(used)+' / '+fmt(lim):fmt(used)+' · Sem limite'}),
        i.jsx('span',{className:'wa-ut-usage-ic',children:svg(lv&&lv[0]!=='ok'?'alert':'info',15)})]}),
      open?i.jsxs('div',{id:'wa-ut-usage-pop',className:'wa-ut-pop',role:'dialog','aria-label':'Uso das respostas da IA',children:[
        i.jsx('p',{className:'wa-ut-pop-title',children:'Uso das respostas da IA'}),
        i.jsx('p',{className:'wa-ut-pop-sub',children:(plan?'Plano '+plan+' · ':'')+'mês atual'}),
        i.jsxs('dl',{className:'wa-ut-pop-rows',children:[
          i.jsxs('div',{children:[i.jsx('dt',{children:'Hoje'}),i.jsx('dd',{children:fmt(t.responses)+(t.limit?' de '+fmt(t.limit):'')})]}),
          i.jsxs('div',{children:[i.jsx('dt',{children:'Este mês'}),i.jsx('dd',{children:fmt(used)})]})]}),
        i.jsx('hr',{className:'wa-ut-pop-hr'}),
        lim?i.jsxs(i.Fragment,{children:[
          i.jsxs('dl',{className:'wa-ut-pop-rows',children:[
            i.jsxs('div',{children:[i.jsx('dt',{children:'Franquia do mês'}),i.jsx('dd',{children:fmt(lim)})]}),
            used>lim?i.jsxs('div',{children:[i.jsx('dt',{children:'Excedente'}),i.jsx('dd',{className:'wa-ut-bad',children:fmt(used-lim)})]}):
              i.jsxs('div',{children:[i.jsx('dt',{children:'Restante'}),i.jsx('dd',{className:'wa-ut-good',children:fmt(lim-used)})]})]}),
          i.jsxs('div',{className:'wa-ut-pop-pct',children:[i.jsx('span',{children:'Uso'}),i.jsx('span',{children:pf.format(pct)+'%'})]}),
          i.jsx('div',{className:'wa-ut-pop-bar','data-tone':lv[0],role:'progressbar','aria-label':'Uso da franquia do mês','aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':Math.round(Math.min(100,pct)),children:i.jsx('span',{style:{width:Math.min(100,pct)+'%'}})}),
          i.jsxs('p',{className:'wa-ut-pop-status',children:[i.jsx('span',{className:'wa-ut-usage-dot','data-tone':lv[0],'aria-hidden':'true'}),lv[1]]})]}):
          i.jsx('p',{className:'wa-ut-pop-none',children:'Sem limite: nenhuma franquia mensal definida para esta instância.'}),
        i.jsxs(Fu,{to:'/manager/instance/'+g.id+'/usage',className:'wa-ut-pop-link',onClick:()=>setOpen(!1),children:['Plano e limites',svg('arrow',14)]})]}):null]});
  }

  /* ---------------------------------------------------------------- "Primeiros passos" checklist (Visão Geral) */
  function Checklist({instance}){
    const id=instance&&instance.id,name=instance&&instance.name,key='wa-ut-start:'+id;
    const s=useSummary(name),[mode,setMode]=y.useState(()=>ls_(key)),[bots,setBots]=y.useState(null);
    y.useEffect(()=>{setMode(ls_(key))},[key]);
    y.useEffect(()=>{if(!name)return;let live=!0;setBots(null);
      Ee.get('/openai/find/'+encodeURIComponent(name),{headers:{apikey:instance.token}}).then(r=>{live&&setBots(Array.isArray(r.data)?r.data.length:0)},()=>{live&&setBots(-1)});
      return()=>{live=!1}},[name]);
    if(!instance||mode==='hide'||bots===null||s.st==='loading')return null;
    const lim=s.data&&s.data.limits,bh=lim&&lim.businessHours,cnt=instance._count||{};
    const items=[
      ['Conectar o WhatsApp',instance.connectionStatus==='open',null,'Leia o QR Code no card acima com o WhatsApp do número.'],
      ['Configurar o bot de IA',bots>0,'openai','Crie o assistente que responde aos clientes.'],
      ['Definir horário de atendimento',!!(bh&&bh.enabled&&bh.mode&&bh.mode!=='always'),'usage','Diga em que horários a IA atende.'],
      ['Definir limites do plano',!!(lim&&(lim.monthlyResponses||lim.dailyResponses||lim.planName)),'usage','Franquia do mês e limites por dia.'],
      ['Testar uma conversa',(Number(cnt.Message)||0)>0,'chat','Mande uma mensagem de outro número e veja a resposta.']];
    const done=items.filter(x=>x[1]).length,total=items.length,min=mode?mode==='min':done===total;
    const setM=v=>{setMode(v);ls_(key,v)};
    return i.jsxs('section',{className:'wa-ut-start','aria-labelledby':'wa-ut-start-title','data-min':min?'true':void 0,children:[
      i.jsxs('div',{className:'wa-ut-start-head',children:[
        i.jsxs('div',{children:[i.jsx('h2',{id:'wa-ut-start-title',className:'wa-ut-start-title',children:'Primeiros passos'}),
          i.jsx('p',{className:'wa-ut-start-sub',children:done===total?'Tudo pronto: a IA já pode atender.':'Deixe esta instância pronta para atender.'})]}),
        i.jsxs('div',{className:'wa-ut-start-actions',children:[
          i.jsx('button',{type:'button',className:'wa-ut-ibtn wa-ut-ibtn--round','aria-expanded':min?'false':'true','aria-controls':'wa-ut-start-list','aria-label':min?'Mostrar passos':'Recolher passos',onClick:()=>setM(min?'open':'min'),children:i.jsx('span',{className:'wa-ut-chev','data-up':min?void 0:'true',children:svg('chev',16)})}),
          i.jsx('button',{type:'button',className:'wa-ut-ibtn','aria-label':'Ocultar primeiros passos',title:'Ocultar',onClick:()=>setM('hide'),children:svg('x',15)})]})]}),
      min?null:i.jsxs('div',{id:'wa-ut-start-list',className:'wa-ut-start-body',children:[
        i.jsx('ul',{className:'wa-ut-steps',children:items.map(([t,ok,p,hint])=>i.jsxs('li',{className:'wa-ut-step','data-done':ok?'true':void 0,children:[
          i.jsx('span',{className:'wa-ut-step-ic','aria-hidden':'true',children:ok?svg('check',12):null}),
          i.jsxs('span',{className:'wa-ut-step-text',children:[ok||!p?i.jsx('span',{className:'wa-ut-step-t',children:t}):i.jsx(Fu,{to:'/manager/instance/'+id+'/'+p,className:'wa-ut-step-t wa-ut-step-link',children:t}),
            ok?i.jsx('span',{className:'sr-only',children:' (concluído)'}):i.jsx('span',{className:'wa-ut-step-hint',children:hint})]})]},t))}),
        i.jsxs('a',{className:'wa-ut-start-btn',href:'/readme',children:[svg('book',15),'Abrir o Manual']})]}),
      i.jsxs('div',{className:'wa-ut-start-foot',children:[i.jsx('span',{className:'wa-ut-start-count',children:done+' de '+total+' concluídos'}),
        i.jsx('div',{className:'wa-ut-start-bar',role:'progressbar','aria-label':'Primeiros passos concluídos','aria-valuemin':0,'aria-valuemax':total,'aria-valuenow':done,children:i.jsx('span',{style:{width:done/total*100+'%'}})})]})]});
  }

  /* ---------------------------------------------------------------- toasts, sidebar labels */
  const TT={success:['ok','check'],error:['bad','x'],warning:['warn','warn'],info:['info','info'],default:['info','info']};
  function toastIcon({type,isLoading}){const v=TT[type]||TT.default;return i.jsx('span',{className:'wa-ut-toast-ic','data-tone':isLoading?'info':v[0],children:isLoading?i.jsx('span',{className:'wa-ut-spin'}):svg(v[1],14)});}
  function ToastClose({closeToast}){return i.jsx('button',{type:'button',className:'wa-ut-toast-x','aria-label':'Fechar aviso',onClick:e=>{e.stopPropagation();closeToast(e)},children:svg('x',14)});}
  function navLabel(l,ix){const u=l[ix],p=ix>0?l[ix-1]:null;
    if(ix===0)return i.jsx('li',{className:'wa-nav-label wa-ut-navlabel',role:'none',children:'Atendimento'},'wa-ut-nav-main');
    if(u&&u.children&&!(p&&p.children))return i.jsx('li',{className:'wa-nav-label wa-ut-navlabel',role:'none',children:'Ajustes da instância'},'wa-ut-nav-cfg');
    return null;}
  return{Instances,UsageChip,Checklist,toastIcon,ToastClose,navLabel,convStatus};
})();
'''

LIST_START = 'return i.jsxs("div",{className:"wa-home my-4 px-4","data-wa-home":"instances",children:['
LIST_END = ']})}const{createElement:Gl,createContext:EZ'
LIST_NEW = ('return i.jsx("div",{className:"wa-home wa-ut-page","data-wa-home":"instances",children:'
            'i.jsx(WaUt.Instances,{list:o,loading:waListLoading,refresh:x,remove:b,logout:s,deleting:u,'
            'create:i.jsx(dQ,{resetTable:x})})})}')
CREATE_GROUPS = [
    ('create dialog trigger',
     'i.jsxs(se,{variant:"default",size:"sm",children:[t("instance.button.create")," ",i.jsx(cs,{size:"18"})]})',
     'i.jsxs("button",{type:"button",className:"wa-ut-tbtn wa-ut-tbtn--line wa-ut-new",children:[i.jsx(cs,{size:"14",'
     '"aria-hidden":"true"}),i.jsx("span",{children:"Nova instância"})]})'),
    ('create dialog header',
     '"aria-describedby":void 0,children:[i.jsx(Mt,{children:i.jsx(zt,{children:t("instance.modal.title")})}),',
     'children:[i.jsxs(Mt,{children:[i.jsx(zt,{children:"Nova instância"}),i.jsx(eo,{children:"Dê um nome e escolha a '
     'integração. Depois de criar, leia o QR Code na página da instância para conectar o WhatsApp."})]}),'),
    ('create dialog token field',
     'i.jsx(le,{required:!0,name:"token",label:t("instance.form.token"),children:i.jsx(ne,{})}),',
     'i.jsxs("details",{className:"wa-ut-adv",children:[i.jsx("summary",{children:"Avançado: token da instância"}),'
     'i.jsx(le,{required:!0,name:"token",label:t("instance.form.token"),children:i.jsx(ne,{})})]}),'),
    ('create dialog footer',
     'i.jsx(Yt,{children:i.jsx(se,{type:"submit",children:t("instance.button.save")})})',
     'i.jsxs(Yt,{className:"wa-ut-dfoot",children:[i.jsx(se,{type:"button",variant:"outline",onClick:()=>s(!1),'
     'children:"Cancelar"}),i.jsx(se,{type:"submit",children:"Criar instância"})]})'),
]

def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


def patch_component(s):
    return rep(s, '})();\n\nconst WaTw=(()=>{', '})();\n\n' + COMPONENT + '\nconst WaTw=(()=>{',
               'module slot after WaUsage (run twenty-layout.py first)')


def patch_instances(s):
    if s.count(LIST_START) != 1:
        raise PatchError(f'instance list: start anchor expected once, got {s.count(LIST_START)}')
    a = s.index(LIST_START)
    b = s.find(LIST_END, a)
    if b < 0 or b - a > 9000:
        raise PatchError('instance list: end anchor not found right after the start')
    old = s[a:b]
    for probe in ('wa-instance-grid', 'WaListSkeleton()', 'i.jsx(dQ,{resetTable:x})', 'onClick:()=>b(t)'):
        if probe not in old:
            raise PatchError(f'instance list: expected {probe} inside the replaced block')
    s = s[:a] + LIST_NEW + s[b + len(']})}'):]
    for label, old, new in CREATE_GROUPS:
        s = rep(s, old, new, label)
    return s

def patch_header(s):
    old = 'children:[e&&i.jsx(WaTw.CmdButton,{}),'
    return rep(s, old, 'children:[e&&i.jsx(WaUt.UsageChip,{}),e&&i.jsx(WaTw.CmdButton,{}),', 'top bar actions')


def patch_dashboard(s):
    old = 'i.jsxs("dl",{className:"wa-metrics","aria-label":"Números da instância",children:['
    return rep(s, old, 'i.jsx(WaUt.Checklist,{instance:g}),' + old, 'dashboard metric cards')


def patch_toasts(s):
    return rep(s, 'i.jsx(CL,{theme:"colored"})',
               'i.jsx(CL,{theme:"colored",icon:WaUt.toastIcon,closeButton:WaUt.ToastClose})', 'toast container')


def patch_sidebar(s):
    return rep(s, 'l.map((u,waIx)=>[', 'l.map((u,waIx)=>[WaUt.navLabel(l,waIx),', 'instance sidebar items')


def patch_panel(s):
    s = rep(s, "i.jsxs('dl',{className:'wa-tw-fields',children:[",
            "i.jsxs('dl',{className:'wa-tw-fields wa-ut-props',children:[", 'contact panel fields')
    old = "i.jsx(Field,{icon:'spark',label:'IA neste contato',stack:!0,children:ai}),"
    return rep(s, old, "i.jsx(Field,{icon:'dot',label:'Status',children:WaUt.convStatus(chat,unread(chat))})," + old,
               'contact panel AI row')


GROUPS = [('component', patch_component), ('instances', patch_instances), ('header', patch_header),
          ('dashboard', patch_dashboard), ('toasts', patch_toasts), ('sidebar', patch_sidebar), ('panel', patch_panel)]


def patch_html(html):
    pos = html.find(CSS_ANCHOR)
    if pos < 0 or html.count(CSS_ANCHOR) != 1:
        raise PatchError('index.html: twenty-layout.css link not found exactly once (run twenty-layout.py first)')
    end = html.index('\n', pos) + 1
    return html[:end] + '    ' + HTML_MARKER + '\n    <link rel="stylesheet" href="/assets/ui-tables.css?v=1" />\n' + html[end:]


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

    missing = []
    if MARKER not in bundle:
        missing.append('bundle')
    if HTML_MARKER not in html:
        missing.append('html')
    if bump_cache(html) != html:
        missing.append('index.html cache version')
    if not os.path.isfile(CSS):
        missing.append('ui-tables.css')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/ui-tables.css is missing')
    for required in REQUIRED:
        if required not in bundle:
            raise PatchError(f'run the patch that adds {required} first')

    report = []
    new_bundle = bundle
    if 'bundle' in missing:
        for name, fn in GROUPS:
            new_bundle = fn(new_bundle)
            report.append(f'{name}: applied')
        new_bundle = MARKER + new_bundle
    else:
        report.append('bundle: already applied')
    new_html = html
    if 'html' in missing:
        new_html = patch_html(new_html)
        report.append('html: applied')
    else:
        report.append('html: already applied')
    new_html = bump_cache(new_html)

    # everything validated: write
    if new_bundle != bundle:
        with open(BUNDLE, 'w', encoding='utf-8') as f:
            f.write(new_bundle)
    if new_html != html:
        with open(INDEX, 'w', encoding='utf-8') as f:
            f.write(new_html)
    report.append(f'index.html: bundle ?v={CACHE_VERSION}, ui-tables.css ?v=1')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
