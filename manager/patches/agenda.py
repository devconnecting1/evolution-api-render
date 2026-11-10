#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Agenda" page (week and list views, appointment side panel, create
dialog, settings drawer) and the next appointment in the contact panel of Conversas.

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/agenda.css (a plain file, edited by hand, only var(--m-*) tokens of
minimal.css, linked after the last stylesheet of the patches).

Backend (same release): GET /agenda/:instance?from&to, GET/POST /agenda/settings/:instance,
POST /agenda/settings/:instance/ics-token, POST /agenda/:instance, PATCH and DELETE /agenda/:instance/:id.
Requests go through the bundle's axios instance (Ee: API URL + apikey of the instance or of the login).
Times are shown and typed in the agenda time zone (settings.timezone); the API reads "YYYY-MM-DDTHH:MM" in it.

Bundle groups (each one is applied once and leaves a marker comment at the top of the bundle):
  component - WaAgenda, an isolated component module (IIFE) placed right before the route table (const Lse=...):
              Page, Next (contact panel row) and Icon.
  route     - /manager/instance/:instanceId/agenda inside the instance layout, after the "Plano e limites" route.
  sidebar   - "Agenda" item right before "Plano e limites" (so it lands after Conversas and after any item other
              patches added between them, e.g. Leads).
  cmd       - "Agenda" in the command menu of twenty-layout.py (before "Plano e limites").
  panel     - next appointment in the contact side panel of Conversas (twenty-layout.py), after "IA neste contato".
index.html group (marker: an HTML comment in <head>):
  html      - links agenda.css?v=1 after the last patch stylesheet and raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.
Order: run after root-redirect.py (the newest patch it depends on).

Usage (from the repository root):
  python3 -I manager/patches/agenda.py           # apply
  python3 -I manager/patches/agenda.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'agenda.css')
REQUIRED = ('/*whatsai-patch:root-redirect:v1*/',)
CACHE_VERSION = '27'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_LINK = '    <link rel="stylesheet" href="/assets/agenda.css?v=1" />\n'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:agenda:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:agenda:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# Minified names (bundle index-b29a5d7a.js): i = jsx runtime, y = React, Ee = axios instance of the API, me = toast,
# Fu = react-router Link, ct = useInstance, dr/jn = localStorage getter / keys (API URL), tn = protected route,
# un = instance layout.

COMPONENT = r'''const WaAgenda=(()=>{
  const h=(t,p,...c)=>{const{key,...r}=p||{};const kids=c.flat().filter(x=>x!==null&&x!==void 0&&x!==!1);return kids.length>1?i.jsxs(t,{...r,children:kids},key):i.jsx(t,kids.length?{...r,children:kids[0]}:r,key)};
  const DAYS=[['mon','Segunda','seg'],['tue','Terça','ter'],['wed','Quarta','qua'],['thu','Quinta','qui'],['fri','Sexta','sex'],['sat','Sábado','sáb'],['sun','Domingo','dom']];
  const WD=['dom','seg','ter','qua','qui','sex','sáb'];
  const STATUS=[['pendente','Pendente (aprovar)'],['agendado','Agendado'],['confirmado','Confirmado'],['realizado','Realizado'],['faltou','Faltou'],['cancelado','Cancelado']];
  const SL=Object.fromEntries(STATUS);
  const MODES=[['presencial','Presencial'],['online','Online'],['telefone','Telefone']];
  const SOURCES={ia:'IA no WhatsApp',manual:'Painel',mcp:'MCP'};
  const ZONES=['America/Sao_Paulo','America/Manaus','America/Cuiaba','America/Fortaleza','America/Recife','America/Belem','America/Porto_Velho','America/Rio_Branco','America/Noronha'];
  const PPM=1.2;
  const IC={cal:['M8 2v4','M16 2v4','M3 10h18','M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'],left:['m15 18-6-6 6-6'],right:['m9 18 6-6-6-6'],plus:['M5 12h14','M12 5v14'],x:['M18 6 6 18','m6 6 12 12'],cog:['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z','M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z'],list:['M8 6h13','M8 12h13','M8 18h13','M3 6h.01','M3 12h.01','M3 18h.01'],grid:['M3 3h18v18H3z','M3 9h18','M9 3v18'],chat:['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],ext:['M15 3h6v6','M10 14 21 3','M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],copy:['M8 8h12v12H8z','M4 16V4h12']};
  function svg(n,s){return i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:s||16,height:s||16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'1.75',strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',children:(IC[n]||[]).map((d,k)=>i.jsx('path',{d},k))});}
  function Icon({size}){return svg('cal',Number(size)||15);}
  const pad=n=>String(n).padStart(2,'0');
  const fmtCache={};
  function parts(iso,tz){const k=tz||'America/Sao_Paulo';const f=fmtCache[k]||(fmtCache[k]=new Intl.DateTimeFormat('en-US',{timeZone:k,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));const o={};for(const p of f.formatToParts(new Date(iso)))o[p.type]=p.value;return{day:o.year+'-'+o.month+'-'+o.day,min:(Number(o.hour)%24)*60+Number(o.minute)};}
  const hm=m=>pad(Math.floor(m/60))+':'+pad(m%60);
  const toMin=t=>{const[a,b]=String(t||'0:0').split(':').map(Number);return a*60+b};
  const addDays=(d,n)=>{const[a,b,c]=d.split('-').map(Number);return new Date(Date.UTC(a,b-1,c+n)).toISOString().slice(0,10)};
  const wd=d=>{const[a,b,c]=d.split('-').map(Number);return new Date(Date.UTC(a,b-1,c)).getUTCDay()};
  const monday=d=>addDays(d,-((wd(d)+6)%7));
  const ddmm=d=>d.slice(8,10)+'/'+d.slice(5,7);
  const dayLabel=d=>WD[wd(d)]+', '+ddmm(d);
  const todayIn=tz=>parts(new Date().toISOString(),tz).day;
  const digits=j=>String(j||'').split('@')[0].split(':')[0].replace(/\D/g,'');
  function errText(e){const m=e?.response?.data?.response?.message??e?.response?.data?.message;const flat=[].concat(m??[]).flat(4).map(x=>typeof x==='string'?x:x&&x.message?String(x.message):'').filter(Boolean);if(flat.length)return flat.join(' ');if(e?.response?.status===404)return 'A API ainda não tem a Agenda: atualize o backend.';return 'Não foi possível falar com a API. Tente de novo em instantes.';}
  const enc=encodeURIComponent;

  function Field({id,label,hint,children}){return h('div',{className:'wag-field'},h('label',{htmlFor:id,className:'wag-label'},label),children,hint?h('p',{className:'wag-hint'},hint):null);}
  function Drawer({title,onClose,children,footer,wide}){
    const ref=y.useRef(null);
    y.useEffect(()=>{const prev=document.activeElement;ref.current&&ref.current.focus();const k=e=>{if(e.key==='Escape'){e.preventDefault();onClose()}};window.addEventListener('keydown',k);return()=>{window.removeEventListener('keydown',k);prev&&prev.focus&&prev.focus()}},[]);
    return h('div',{className:'wag-overlay',onMouseDown:e=>{if(e.target===e.currentTarget)onClose()}},
      h('aside',{ref,tabIndex:-1,role:'dialog','aria-modal':'true','aria-label':title,className:'wag-drawer'+(wide?' wag-drawer--wide':'')},
        h('header',{className:'wag-drawer-head'},h('h2',{className:'wag-drawer-title'},title),h('button',{type:'button',className:'wag-ibtn','aria-label':'Fechar',onClick:onClose},svg('x',16))),
        h('div',{className:'wag-drawer-body'},children),
        footer?h('footer',{className:'wag-drawer-foot'},footer):null));
  }

  function useData(name,from,to){
    const[st,set]=y.useState({list:null,settings:null,error:'',loading:!0});
    const load=y.useCallback(async()=>{if(!name)return;set(p=>({...p,loading:!0}));
      try{const[s,a]=await Promise.all([Ee.get('/agenda/settings/'+enc(name)),Ee.get('/agenda/'+enc(name),{params:{from,to}})]);set({settings:s.data?.settings,configured:s.data?.configured,list:a.data?.appointments||[],error:'',loading:!1})}
      catch(e){set(p=>({...p,error:errText(e),loading:!1}))}},[name,from,to]);
    y.useEffect(()=>{load()},[load]);
    return{...st,reload:load};
  }

  function Week({days,list,settings,onSlot,onOpen,today}){
    const tz=settings.timezone,step=settings.slotMinutes||30,av=settings.availability||{};
    let lo=24*60,hi=0;for(const[k]of DAYS)for(const[a,b]of av[k]||[]){lo=Math.min(lo,toMin(a));hi=Math.max(hi,toMin(b))}
    for(const a of list){const p=parts(a.startsAt,tz),q=parts(a.endsAt,tz);lo=Math.min(lo,p.min);hi=Math.max(hi,q.day===p.day?q.min:1440)}
    if(lo>=hi){lo=8*60;hi=18*60}lo=Math.floor(lo/60)*60;hi=Math.min(1440,Math.ceil(hi/60)*60);
    const hours=[];for(let m=lo;m<hi;m+=60)hours.push(m);
    const height=(hi-lo)*PPM;
    const blockedRanges=d=>{const out=[];for(const b of settings.blocks||[]){if(d<b.start||d>b.end)continue;out.push(b.from&&b.to?[toMin(b.from),toMin(b.to),b.reason]:[0,1440,b.reason])}return out};
    const keyOf=d=>DAYS[(wd(d)+6)%7][0];
    return h('div',{className:'wag-week',style:{'--wag-cols':days.length},role:'grid','aria-label':'Semana'},
      h('div',{className:'wag-week-head',role:'row'},h('span',{className:'wag-corner'}),days.map(d=>h('div',{key:d,role:'columnheader',className:'wag-dayhead','data-today':d===today?'true':void 0},h('span',{className:'wag-dayname'},WD[wd(d)]),h('span',{className:'wag-daynum'},ddmm(d))))),
      h('div',{className:'wag-week-body',style:{height:height+'px'}},
        h('div',{className:'wag-hours','aria-hidden':'true'},hours.map(m=>h('span',{key:m,style:{top:(m-lo)*PPM+'px'}},hm(m)))),
        days.map(d=>{const open=av[keyOf(d)]||[],blocks=blockedRanges(d),items=list.filter(a=>parts(a.startsAt,tz).day===d);
          const closed=[];let cur=lo;for(const[a,b]of open.map(r=>[toMin(r[0]),toMin(r[1])]).sort((x,z)=>x[0]-z[0])){if(a>cur)closed.push([cur,Math.min(a,hi)]);cur=Math.max(cur,b)}if(cur<hi)closed.push([cur,hi]);
          const click=e=>{if(e.target.closest('.wag-appt'))return;const r=e.currentTarget.getBoundingClientRect();const m=lo+Math.floor((e.clientY-r.top)/PPM/step)*step;onSlot(d,Math.max(lo,Math.min(hi-step,m)))};
          return h('div',{key:d,className:'wag-col',role:'gridcell','data-today':d===today?'true':void 0,onClick:click,'aria-label':dayLabel(d)},
            hours.map(m=>h('span',{key:'l'+m,className:'wag-line',style:{top:(m-lo)*PPM+'px'}})),
            closed.map(([a,b],k)=>h('span',{key:'c'+k,className:'wag-closed',style:{top:(a-lo)*PPM+'px',height:(b-a)*PPM+'px'}})),
            blocks.map(([a,b,why],k)=>h('span',{key:'b'+k,className:'wag-blocked',title:why||'Bloqueado',style:{top:(Math.max(a,lo)-lo)*PPM+'px',height:(Math.min(b,hi)-Math.max(a,lo))*PPM+'px'}},why?h('span',{className:'wag-blocked-text'},why):null)),
            items.map(a=>{const p=parts(a.startsAt,tz),q=parts(a.endsAt,tz),end=q.day===p.day?q.min:hi,top=(p.min-lo)*PPM,hgt=Math.max(18,(end-p.min)*PPM-2);
              return h('button',{key:a.id,type:'button',className:'wag-appt','data-status':a.status,style:{top:top+'px',height:hgt+'px'},onClick:()=>onOpen(a),'aria-label':a.label+', '+(a.contactName||digits(a.remoteJid))+', '+SL[a.status]},
                h('span',{className:'wag-appt-line'},h('span',{className:'wag-appt-time'},hm(p.min)),h('span',{className:'wag-appt-name'},a.contactName||'+'+digits(a.remoteJid))),hgt>44?h('span',{className:'wag-appt-type'},a.typeName):null)}))})));
  }

  function List({list,settings,onOpen}){
    const tz=settings.timezone;
    if(!list.length)return h('div',{className:'wag-empty'},h('span',{className:'wag-empty-ico'},svg('cal',20)),h('p',{className:'wag-empty-title'},'Nenhum agendamento neste período'),h('p',{className:'wag-hint'},'Clique em um horário livre na semana para criar, ou deixe a IA agendar pelo WhatsApp.'));
    const groups=[];for(const a of list){const d=parts(a.startsAt,tz).day;let g=groups.find(x=>x.d===d);if(!g)groups.push(g={d,items:[]});g.items.push(a)}
    return h('div',{className:'wag-list'},groups.map(g=>h('section',{key:g.d,className:'wag-list-day'},h('h3',{className:'wag-list-title'},dayLabel(g.d)),
      h('ul',{className:'wag-rows'},g.items.map(a=>h('li',{key:a.id},h('button',{type:'button',className:'wag-row','data-status':a.status,onClick:()=>onOpen(a)},
        h('span',{className:'wag-row-time'},hm(parts(a.startsAt,tz).min)+'–'+hm(parts(a.endsAt,tz).min)),
        h('span',{className:'wag-row-main'},h('span',{className:'wag-row-name'},a.contactName||'+'+digits(a.remoteJid)),h('span',{className:'wag-hint'},a.typeName+' · '+(SOURCES[a.source]||a.source))),
        h('span',{className:'wag-chip','data-status':a.status},SL[a.status]||a.status))))))));
  }

  function Create({instance,settings,initial,onClose,onDone}){
    const name=instance.name,types=settings.appointmentTypes||[];
    const[chats,setChats]=y.useState([]),[q,setQ]=y.useState(''),[jid,setJid]=y.useState(''),[contactName,setName]=y.useState(''),[number,setNumber]=y.useState('');
    const[type,setType]=y.useState(types[0]?.name||''),[date,setDate]=y.useState(initial.day),[time,setTime]=y.useState(hm(initial.min)),[notes,setNotes]=y.useState(''),[notify,setNotify]=y.useState(!0),[busy,setBusy]=y.useState(!1),[err,setErr]=y.useState('');
    y.useEffect(()=>{let live=!0;Ee.post('/chat/findChats/'+enc(name),{where:{}}).then(r=>{live&&setChats((Array.isArray(r.data)?r.data:[]).filter(c=>c&&c.remoteJid&&!String(c.remoteJid).endsWith('@g.us')))},()=>{});return()=>{live=!1}},[name]);
    const term=q.trim().toLowerCase(),found=term?chats.filter(c=>String(c.pushName||'').toLowerCase().includes(term)||digits(c.remoteJid).includes(term.replace(/\D/g,'')||'§')).slice(0,8):[];
    const pick=c=>{setJid(c.remoteJid);setName(c.pushName||'');setQ(c.pushName||'+'+digits(c.remoteJid));setNumber('')};
    const save=async ev=>{ev.preventDefault();setErr('');const target=jid||number.replace(/\D/g,'');if(!target){setErr('Escolha um contato das conversas ou digite o número com DDI e DDD.');return}if(!date||!time){setErr('Informe data e hora.');return}
      setBusy(!0);try{await Ee.post('/agenda/'+enc(name),{remoteJid:jid||void 0,number:jid?void 0:target,contactName:contactName||null,typeName:type,startsAt:date+'T'+time,notes:notes||null,notifyClient:notify});me.success('Agendamento criado.');onDone()}catch(e){setErr(errText(e))}finally{setBusy(!1)}};
    return h(Drawer,{title:'Novo agendamento',onClose,footer:[h('button',{key:'c',type:'button',className:'wag-btn wag-btn-ghost',onClick:onClose},'Cancelar'),h('button',{key:'s',type:'submit',form:'wag-create',className:'wag-btn wag-btn-primary',disabled:busy},busy?'Salvando…':'Criar agendamento')]},
      h('form',{id:'wag-create',className:'wag-form',onSubmit:save,noValidate:!0},
        h(Field,{id:'wag-c-q',label:'Contato',hint:'Busque nas conversas pelo nome ou número.'},
          h('input',{id:'wag-c-q',className:'wag-input',autoComplete:'off',value:q,placeholder:'Nome ou número',onChange:e=>{setQ(e.target.value);setJid('')}}),
          found.length&&!jid?h('ul',{className:'wag-suggest',role:'listbox'},found.map(c=>h('li',{key:c.remoteJid},h('button',{type:'button',className:'wag-suggest-item',onClick:()=>pick(c)},h('span',null,c.pushName||'Sem nome'),h('span',{className:'wag-hint wag-mono'},'+'+digits(c.remoteJid)))))):null),
        jid?null:h(Field,{id:'wag-c-n',label:'Ou o número (DDI + DDD)'},h('input',{id:'wag-c-n',className:'wag-input',inputMode:'tel',placeholder:'5511999998888',value:number,onChange:e=>setNumber(e.target.value)})),
        h(Field,{id:'wag-c-name',label:'Nome do cliente'},h('input',{id:'wag-c-name',className:'wag-input',value:contactName,maxLength:120,onChange:e=>setName(e.target.value)})),
        h(Field,{id:'wag-c-type',label:'Tipo de atendimento'},h('select',{id:'wag-c-type',className:'wag-input',value:type,onChange:e=>setType(e.target.value)},types.map(t=>h('option',{key:t.name,value:t.name},t.name+' ('+t.minutes+' min)')))),
        h('div',{className:'wag-grid2'},h(Field,{id:'wag-c-d',label:'Data'},h('input',{id:'wag-c-d',type:'date',className:'wag-input',value:date,onChange:e=>setDate(e.target.value)})),h(Field,{id:'wag-c-t',label:'Hora ('+String(settings.timezone).replace('America/','').replace(/_/g,' ')+')'},h('input',{id:'wag-c-t',type:'time',step:300,className:'wag-input',value:time,onChange:e=>setTime(e.target.value)}))),
        h(Field,{id:'wag-c-notes',label:'Observações internas',hint:'Só a equipe vê. Não vão para o cliente nem para o calendário assinado.'},h('textarea',{id:'wag-c-notes',className:'wag-input wag-textarea',rows:3,maxLength:2000,value:notes,onChange:e=>setNotes(e.target.value)})),
        h('label',{className:'wag-check'},h('input',{type:'checkbox',checked:notify,onChange:e=>setNotify(e.target.checked)}),h('span',null,'Enviar a confirmação ao cliente pelo WhatsApp (dia, hora, tipo e local ou link)')),
        err?h('p',{className:'wag-error',role:'alert'},err):null));
  }

  function Detail({instance,settings,appt,onClose,onDone}){
    const name=instance.name,tz=settings.timezone,p=parts(appt.startsAt,tz);
    const[status,setStatus]=y.useState(appt.status),[date,setDate]=y.useState(p.day),[time,setTime]=y.useState(hm(p.min)),[notes,setNotes]=y.useState(appt.notes||''),[notify,setNotify]=y.useState(!0),[busy,setBusy]=y.useState(''),[err,setErr]=y.useState(''),[confirm,setConfirm]=y.useState(!1);
    const patch=async(body,what,ok)=>{setBusy(what);setErr('');try{await Ee.patch('/agenda/'+enc(name)+'/'+enc(appt.id),body);me.success(ok);onDone()}catch(e){setErr(errText(e))}finally{setBusy('')}};
    const cancel=async()=>{setBusy('cancel');setErr('');try{await Ee.delete('/agenda/'+enc(name)+'/'+enc(appt.id),{params:{notifyClient:notify?'true':'false'}});me.success('Agendamento cancelado.');onDone()}catch(e){setErr(errText(e))}finally{setBusy('');setConfirm(!1)}};
    const moved=date!==p.day||time!==hm(p.min),phone=digits(appt.remoteJid);
    return h(Drawer,{title:'Agendamento',onClose},
      h('div',{className:'wag-detail'},
        h('p',{className:'wag-detail-name'},appt.contactName||'+'+phone),
        h('p',{className:'wag-hint'},appt.label+' · '+appt.typeName+(appt.mode?' · '+appt.mode:'')),
        h('dl',{className:'wag-fields'},
          h('div',null,h('dt',null,'Telefone'),h('dd',{className:'wag-mono'},appt.remoteJid.endsWith('@lid')?'Oculto pelo WhatsApp':'+'+phone)),
          h('div',null,h('dt',null,'Origem'),h('dd',null,SOURCES[appt.source]||appt.source)),
          h('div',null,h('dt',null,'Lembretes'),h('dd',null,Object.entries(appt.remindersSent||{}).filter(([,v])=>v&&v.ok).map(([k])=>k+' h').join(', ')||'Nenhum enviado ainda'))),
        h('div',{className:'wag-actions-row'},
          h(Fu,{to:'/manager/instance/'+instance.id+'/chat/'+enc(appt.remoteJid),className:'wag-btn wag-btn-ghost'},svg('chat',14),'Abrir conversa'),
          phone&&!appt.remoteJid.endsWith('@lid')?h('a',{href:'https://wa.me/'+phone,target:'_blank',rel:'noopener noreferrer',className:'wag-btn wag-btn-ghost'},svg('ext',14),'Abrir no WhatsApp'):null),
        appt.status==='pendente'?h('div',{className:'wag-callout',role:'status'},h('p',null,'Pedido feito pela IA: aguarda aprovação da equipe. Ao aprovar, o cliente recebe a confirmação pelo WhatsApp.'),
          h('button',{type:'button',className:'wag-btn wag-btn-primary wag-btn-sm',disabled:!!busy,onClick:()=>patch({status:'agendado',notifyClient:!0},'approve','Agendamento aprovado.')},busy==='approve'?'Aprovando…':'Aprovar')):null,
        h(Field,{id:'wag-d-status',label:'Status'},h('div',{className:'wag-inline'},h('select',{id:'wag-d-status',className:'wag-input',value:status,onChange:e=>setStatus(e.target.value)},STATUS.filter(s=>s[0]!=='cancelado'||appt.status==='cancelado').map(([v,l])=>h('option',{key:v,value:v},l))),
          h('button',{type:'button',className:'wag-btn',disabled:status===appt.status||!!busy,onClick:()=>patch({status},'status','Status atualizado.')},busy==='status'?'Salvando…':'Salvar'))),
        appt.status==='cancelado'?null:h('fieldset',{className:'wag-fieldset'},h('legend',{className:'wag-label'},'Remarcar'),
          h('div',{className:'wag-grid2'},h('input',{type:'date',className:'wag-input','aria-label':'Nova data',value:date,onChange:e=>setDate(e.target.value)}),h('input',{type:'time',step:300,className:'wag-input','aria-label':'Novo horário',value:time,onChange:e=>setTime(e.target.value)})),
          h('label',{className:'wag-check'},h('input',{type:'checkbox',checked:notify,onChange:e=>setNotify(e.target.checked)}),h('span',null,'Avisar o cliente pelo WhatsApp')),
          h('button',{type:'button',className:'wag-btn',disabled:!moved||!!busy,onClick:()=>patch({startsAt:date+'T'+time,notifyClient:notify},'move','Agendamento remarcado.')},busy==='move'?'Salvando…':'Remarcar')),
        h(Field,{id:'wag-d-notes',label:'Observações internas'},h('textarea',{id:'wag-d-notes',className:'wag-input wag-textarea',rows:3,maxLength:2000,value:notes,onChange:e=>setNotes(e.target.value)}),
          h('button',{type:'button',className:'wag-btn wag-btn-ghost',disabled:notes===(appt.notes||'')||!!busy,onClick:()=>patch({notes:notes||null},'notes','Observações salvas.')},busy==='notes'?'Salvando…':'Salvar observações')),
        err?h('p',{className:'wag-error',role:'alert'},err):null,
        appt.status==='cancelado'?null:confirm?h('div',{className:'wag-confirm',role:'alertdialog','aria-label':'Confirmar cancelamento'},h('p',null,'Cancelar este agendamento?'+(notify?' O cliente recebe o aviso pelo WhatsApp.':'')),
          h('div',{className:'wag-inline'},h('button',{type:'button',className:'wag-btn wag-btn-ghost',onClick:()=>setConfirm(!1)},'Voltar'),h('button',{type:'button',className:'wag-btn wag-btn-danger',disabled:!!busy,onClick:cancel},busy==='cancel'?'Cancelando…':'Cancelar agendamento'))):
          h('button',{type:'button',className:'wag-btn wag-btn-danger-ghost',onClick:()=>setConfirm(!0)},'Cancelar agendamento')));
  }

  function toForm(s){
    const week={};for(const[k]of DAYS){const r=(s.availability||{})[k]||[];week[k]={open:r.length>0,a:r[0]?r[0][0]:'09:00',b:r[0]?r[0][1]:'12:00',c:r[1]?r[1][0]:'',d:r[1]?r[1][1]:''}}
    return{enabled:!!s.enabled,timezone:s.timezone,slotMinutes:String(s.slotMinutes),bufferMinutes:String(s.bufferMinutes),minNoticeHours:String(s.minNoticeHours),maxDaysAhead:String(s.maxDaysAhead),week,
      blocks:(s.blocks||[]).map(b=>({...b,end:b.end||b.start,from:b.from||'',to:b.to||'',reason:b.reason||''})),types:(s.appointmentTypes||[]).map(t=>({...t,minutes:String(t.minutes),location:t.location||'',instructions:t.instructions||''})),
      remOn:s.reminders?.enabled!==!1,hours:(s.reminders?.hoursBefore||[]).join(', '),confirm:s.confirmation?.enabled!==!1,allowBook:s.aiPermissions?.allowBook!==!1,allowCancel:s.aiPermissions?.allowCancel!==!1,allowReschedule:s.aiPermissions?.allowReschedule!==!1,requireTeamApproval:s.aiPermissions?.requireTeamApproval===!0,showOtherEventDetails:s.aiPermissions?.showOtherEventDetails===!0,provider:s.provider||'internal',numbers:(s.notifyNumbers||[]).join(', ')};
  }
  function toBody(f){
    return{enabled:f.enabled,timezone:f.timezone,slotMinutes:Number(f.slotMinutes),bufferMinutes:Number(f.bufferMinutes)||0,minNoticeHours:Number(f.minNoticeHours)||0,maxDaysAhead:Number(f.maxDaysAhead)||30,
      availability:Object.fromEntries(DAYS.map(([k])=>{const d=f.week[k];return[k,d.open?[[d.a,d.b],...(d.c&&d.d?[[d.c,d.d]]:[])]:[]]})),
      blocks:f.blocks.filter(b=>b.start).map(b=>({start:b.start,end:b.end||b.start,from:b.from||null,to:b.to||null,reason:b.reason||null})),
      appointmentTypes:f.types.map(t=>({name:t.name.trim(),minutes:Number(t.minutes),mode:t.mode||'presencial',location:t.location.trim()||null,instructions:t.instructions.trim()||null})),
      reminders:{enabled:f.remOn,hoursBefore:f.hours.split(/[,;\s]+/).filter(Boolean).map(Number)},confirmation:{enabled:f.confirm},aiPermissions:{allowBook:f.allowBook,allowCancel:f.allowCancel,allowReschedule:f.allowReschedule,requireTeamApproval:f.requireTeamApproval,showOtherEventDetails:f.showOtherEventDetails},provider:f.provider,
      notifyNumbers:f.numbers.split(/[,;\s]+/).map(x=>x.replace(/\D/g,'')).filter(Boolean)};
  }
  function problems(f){const e=[];
    if(!f.types.length)e.push('Cadastre pelo menos um tipo de atendimento.');
    for(const t of f.types){if(!t.name.trim())e.push('Cada tipo precisa de um nome.');if(!(Number(t.minutes)>=5&&Number(t.minutes)<=480))e.push((t.name||'Tipo')+': duração de 5 a 480 minutos.')}
    for(const[k,l]of DAYS){const d=f.week[k];if(!d.open)continue;if(!d.a||!d.b||d.a>=d.b)e.push(l+': o fim precisa ser depois do início.');if((d.c||d.d)&&(!d.c||!d.d||d.c>=d.d||d.c<d.b))e.push(l+': a segunda faixa precisa começar depois da primeira e terminar depois de começar.')}
    if(f.enabled&&!DAYS.some(([k])=>f.week[k].open))e.push('Para ligar a agenda, abra pelo menos um dia.');
    if(f.hours.split(/[,;\s]+/).filter(Boolean).some(x=>!(Number(x)>=1&&Number(x)<=72&&/^\d+$/.test(x))))e.push('Lembretes: horas inteiras de 1 a 72, separadas por vírgula.');
    if(f.numbers.split(/[,;\s]+/).filter(Boolean).some(x=>!/^\d{10,15}$/.test(x.replace(/\D/g,''))))e.push('Números da equipe: use DDI + DDD + número.');
    for(const b of f.blocks)if(!b.start||(b.end&&b.end<b.start))e.push('Bloqueio: a data final precisa ser igual ou depois da inicial.');
    return e;}

  function Settings({instance,settings,onClose,onDone}){
    const name=instance.name;
    const[f,setF]=y.useState(()=>toForm(settings)),[busy,setBusy]=y.useState(!1),[err,setErr]=y.useState(''),[token,setToken]=y.useState(settings.icsToken),[tried,setTried]=y.useState(!1);
    const set=p=>setF(x=>({...x,...p}));const setDay=(k,p)=>setF(x=>({...x,week:{...x.week,[k]:{...x.week[k],...p}}}));
    const copyAll=k=>setF(x=>{const s=x.week[k],w={};for(const[d]of DAYS)w[d]={...s};return{...x,week:w}});
    const setList=(key,idx,p)=>setF(x=>({...x,[key]:x[key].map((v,n)=>n===idx?{...v,...p}:v)}));
    const errors=problems(f);
    const save=async()=>{setTried(!0);if(errors.length)return;setBusy(!0);setErr('');try{await Ee.post('/agenda/settings/'+enc(name),toBody(f));me.success('Agenda salva.');onDone()}catch(e){setErr(errText(e))}finally{setBusy(!1)}};
    const base=String(dr(jn.API_URL)||'').replace(/\/+$/,''),ics=token?base+'/agenda/ics/'+token+'.ics':'';
    const regen=async()=>{try{const r=await Ee.post('/agenda/settings/'+enc(name)+'/ics-token');setToken(r.data?.icsToken);me.success(token?'Link novo gerado: o anterior parou de funcionar.':'Link do calendário gerado.')}catch(e){me.error(errText(e))}};
    const copy=async()=>{try{await navigator.clipboard.writeText(ics);me.success('Link copiado.')}catch{me.error('Não foi possível copiar.')}};
    const num=(id,label,key,min,max,hint)=>h(Field,{id,label,hint},h('input',{id,className:'wag-input',type:'number',min,max,step:1,value:f[key],onChange:e=>set({[key]:e.target.value})}));
    return h(Drawer,{title:'Configurações da agenda',wide:!0,onClose,footer:[h('button',{key:'c',type:'button',className:'wag-btn wag-btn-ghost',onClick:onClose},'Fechar'),h('button',{key:'s',type:'button',className:'wag-btn wag-btn-primary',disabled:busy,onClick:save},busy?'Salvando…':'Salvar')]},
      h('div',{className:'wag-form'},
        h('label',{className:'wag-switch'},h('input',{type:'checkbox',role:'switch',checked:f.enabled,onChange:e=>set({enabled:e.target.checked})}),h('span',null,h('strong',null,'Agenda ligada'),h('span',{className:'wag-hint'},'Ligada: a IA consulta horários e agenda pelo WhatsApp, e os lembretes saem automaticamente. Desligada: nada disso acontece (a equipe ainda pode usar esta página).'))),
        h('section',{className:'wag-sec'},h('h3',{className:'wag-sec-title'},'Horários'),
          h('div',{className:'wag-grid2'},
            h(Field,{id:'wag-s-tz',label:'Fuso horário'},h('select',{id:'wag-s-tz',className:'wag-input',value:f.timezone,onChange:e=>set({timezone:e.target.value})},(ZONES.includes(f.timezone)?ZONES:[f.timezone,...ZONES]).map(z=>h('option',{key:z,value:z},z.replace('America/','').replace(/_/g,' '))))),
            h(Field,{id:'wag-s-slot',label:'Intervalo entre horários'},h('select',{id:'wag-s-slot',className:'wag-input',value:f.slotMinutes,onChange:e=>set({slotMinutes:e.target.value})},[10,15,20,30,40,45,60,90,120].map(n=>h('option',{key:n,value:String(n)},n+' min')))),
            num('wag-s-buf','Pausa entre atendimentos (min)','bufferMinutes',0,240),
            num('wag-s-notice','Antecedência mínima (horas)','minNoticeHours',0,720,'A IA não oferece horários antes disso.'),
            num('wag-s-ahead','Agendar até (dias à frente)','maxDaysAhead',1,365)),
          h('div',{className:'wag-days',role:'group','aria-label':'Disponibilidade por dia'},DAYS.map(([k,l])=>{const d=f.week[k];return h('div',{key:k,className:'wag-day','data-open':d.open?'true':void 0},
            h('label',{className:'wag-day-name'},h('input',{type:'checkbox',checked:d.open,onChange:e=>setDay(k,{open:e.target.checked})}),h('span',null,l)),
            d.open?h('span',{className:'wag-day-times'},h('input',{type:'time',className:'wag-input wag-time','aria-label':l+': início',value:d.a,onChange:e=>setDay(k,{a:e.target.value})}),h('span',{className:'wag-hint'},'às'),h('input',{type:'time',className:'wag-input wag-time','aria-label':l+': fim',value:d.b,onChange:e=>setDay(k,{b:e.target.value})}),
              h('span',{className:'wag-hint'},'e'),h('input',{type:'time',className:'wag-input wag-time','aria-label':l+': início da tarde (opcional)',value:d.c,onChange:e=>setDay(k,{c:e.target.value})}),h('span',{className:'wag-hint'},'às'),h('input',{type:'time',className:'wag-input wag-time','aria-label':l+': fim da tarde (opcional)',value:d.d,onChange:e=>setDay(k,{d:e.target.value})})):h('span',{className:'wag-hint'},'Fechado'),
            h('button',{type:'button',className:'wag-btn wag-btn-ghost wag-btn-sm',onClick:()=>copyAll(k),'aria-label':'Copiar o horário de '+l+' para todos os dias'},'Copiar para todos'))}))),
        h('section',{className:'wag-sec'},h('h3',{className:'wag-sec-title'},'Datas bloqueadas'),h('p',{className:'wag-hint'},'Feriados, férias, audiências. Deixe o horário vazio para bloquear o dia inteiro.'),
          f.blocks.map((b,n)=>h('div',{key:n,className:'wag-blockrow'},h('input',{type:'date',className:'wag-input','aria-label':'De',value:b.start,onChange:e=>setList('blocks',n,{start:e.target.value})}),h('input',{type:'date',className:'wag-input','aria-label':'Até',value:b.end,onChange:e=>setList('blocks',n,{end:e.target.value})}),
            h('input',{type:'time',className:'wag-input wag-time','aria-label':'Das (opcional)',value:b.from,onChange:e=>setList('blocks',n,{from:e.target.value})}),h('input',{type:'time',className:'wag-input wag-time','aria-label':'Às (opcional)',value:b.to,onChange:e=>setList('blocks',n,{to:e.target.value})}),
            h('input',{className:'wag-input','aria-label':'Motivo',placeholder:'Motivo',maxLength:120,value:b.reason,onChange:e=>setList('blocks',n,{reason:e.target.value})}),h('button',{type:'button',className:'wag-ibtn','aria-label':'Remover bloqueio',onClick:()=>set({blocks:f.blocks.filter((_,m)=>m!==n)})},svg('x',14)))),
          h('button',{type:'button',className:'wag-btn wag-btn-ghost wag-btn-sm',onClick:()=>set({blocks:[...f.blocks,{start:todayIn(f.timezone),end:todayIn(f.timezone),from:'',to:'',reason:''}]})},svg('plus',14),'Adicionar bloqueio')),
        h('section',{className:'wag-sec'},h('h3',{className:'wag-sec-title'},'Tipos de atendimento'),
          f.types.map((t,n)=>h('div',{key:n,className:'wag-typerow'},
            h('div',{className:'wag-grid3'},h('input',{className:'wag-input','aria-label':'Nome',placeholder:'Nome',maxLength:80,value:t.name,onChange:e=>setList('types',n,{name:e.target.value})}),
              h('input',{className:'wag-input',type:'number',min:5,max:480,step:5,'aria-label':'Duração (min)',value:t.minutes,onChange:e=>setList('types',n,{minutes:e.target.value})}),
              h('select',{className:'wag-input','aria-label':'Modo',value:t.mode,onChange:e=>setList('types',n,{mode:e.target.value})},MODES.map(([v,l])=>h('option',{key:v,value:v},l)))),
            h('input',{className:'wag-input','aria-label':'Endereço ou link',placeholder:t.mode==='online'?'Link da reunião':t.mode==='telefone'?'(não usado por telefone)':'Endereço',maxLength:300,value:t.location,onChange:e=>setList('types',n,{location:e.target.value})}),
            h('input',{className:'wag-input','aria-label':'O que levar',placeholder:'O que levar (opcional), ex.: documento com foto',maxLength:500,value:t.instructions,onChange:e=>setList('types',n,{instructions:e.target.value})}),
            f.types.length>1?h('button',{type:'button',className:'wag-btn wag-btn-danger-ghost wag-btn-sm',onClick:()=>set({types:f.types.filter((_,m)=>m!==n)})},'Remover tipo'):null)),
          f.types.length<10?h('button',{type:'button',className:'wag-btn wag-btn-ghost wag-btn-sm',onClick:()=>set({types:[...f.types,{name:'',minutes:String(f.slotMinutes||30),mode:'presencial',location:'',instructions:''}]})},svg('plus',14),'Adicionar tipo'):null),
        h('section',{className:'wag-sec'},h('h3',{className:'wag-sec-title'},'Lembretes e confirmação'),
          h('label',{className:'wag-check'},h('input',{type:'checkbox',checked:f.remOn,onChange:e=>set({remOn:e.target.checked})}),h('span',null,'Enviar lembretes pelo WhatsApp')),
          h(Field,{id:'wag-s-hours',label:'Horas antes',hint:'Até 3, separadas por vírgula. Nunca entre 21h e 8h: o lembrete de um horário antes das 10h vai na véspera às 20h.'},h('input',{id:'wag-s-hours',className:'wag-input',value:f.hours,onChange:e=>set({hours:e.target.value})})),
          h('label',{className:'wag-check'},h('input',{type:'checkbox',checked:f.confirm,onChange:e=>set({confirm:e.target.checked})}),h('span',null,'Pedir confirmação no lembrete ("Responda 1 para confirmar ou 2 para remarcar/cancelar")'))),
        h('section',{className:'wag-sec'},h('h3',{className:'wag-sec-title'},'O que a IA pode fazer'),
          h('p',{className:'wag-hint'},'Valem no servidor: o que estiver desligado nem é oferecido à IA, e ela diz que a equipe vai cuidar disso.'),
          [['allowBook','Agendar'],['allowReschedule','Remarcar'],['allowCancel','Cancelar'],['requireTeamApproval','Pedidos da IA precisam de aprovação da equipe (ficam "Pendente" até aprovar aqui)'],['showOtherEventDetails','A IA pode ver horário e tipo dos outros agendamentos (nunca nomes, números ou observações)']].map(([k,l])=>h('label',{key:k,className:'wag-check'},h('input',{type:'checkbox',checked:f[k],onChange:e=>set({[k]:e.target.checked})}),h('span',null,l))),
          h('label',{className:'wag-check'},h('input',{type:'checkbox',checked:!0,disabled:!0}),h('span',null,'O cliente só vê e altera os próprios agendamentos (sempre ligado)')),
          h('p',{className:'wag-hint'},'A IA sempre confirma dia e hora com o cliente antes e nunca fala de valores.')),
        h('section',{className:'wag-sec'},h('h3',{className:'wag-sec-title'},'Onde a agenda fica'),
          h(Field,{id:'wag-s-prov',label:'Provedor',hint:'Hoje só a agenda interna do WhatsAI. O Google Calendar entra como outro provedor em uma próxima versão.'},h('select',{id:'wag-s-prov',className:'wag-input',value:f.provider,onChange:e=>set({provider:e.target.value})},h('option',{value:'internal'},'Agenda do WhatsAI (interna)')))),
        h('section',{className:'wag-sec'},h('h3',{className:'wag-sec-title'},'Avisos para a equipe'),
          h(Field,{id:'wag-s-num',label:'Números da equipe',hint:'Recebem um aviso quando a IA agenda, remarca ou cancela. Vazio: usa os números dos avisos de Leads, se houver.'},h('input',{id:'wag-s-num',className:'wag-input',inputMode:'tel',placeholder:'5511999998888, 5511988887777',value:f.numbers,onChange:e=>set({numbers:e.target.value})}))),
        h('section',{className:'wag-sec'},h('h3',{className:'wag-sec-title'},'Calendário (Google, Apple, Outlook)'),
          h('p',{className:'wag-hint'},'Assine este link no seu calendário para ver os agendamentos (somente leitura, atualiza a cada poucos minutos). Quem tiver o link vê nomes e telefones: trate como senha.'),
          ics?h('div',{className:'wag-inline'},h('input',{className:'wag-input wag-mono',readOnly:!0,value:ics,'aria-label':'Link do calendário',onFocus:e=>e.target.select()}),h('button',{type:'button',className:'wag-btn',onClick:copy},svg('copy',14),'Copiar')):null,
          h('button',{type:'button',className:'wag-btn wag-btn-ghost wag-btn-sm',onClick:regen},ics?'Gerar link novo':'Gerar link do calendário')),
        (tried&&errors.length)||err?h('div',{className:'wag-error',role:'alert'},h('ul',null,(err?[err]:errors).map((t,k)=>h('li',{key:k},t)))):null));
  }

  function Page(){
    const{instance:g}=ct();
    const narrow=typeof window!=='undefined'&&window.innerWidth<720;
    const[view,setView]=y.useState(()=>{try{return localStorage.getItem('wag-view')||'week'}catch{return 'week'}});
    const[anchor,setAnchor]=y.useState(()=>todayIn('America/Sao_Paulo'));
    const[dlg,setDlg]=y.useState(null);
    const span=view==='list'?14:narrow?1:7,start=view==='week'&&!narrow?monday(anchor):anchor,end=addDays(start,span);
    const data=useData(g?.name,start,end);
    y.useEffect(()=>{try{localStorage.setItem('wag-view',view)}catch{}},[view]);
    if(!g)return null;
    const s=data.settings,tz=s?.timezone||'America/Sao_Paulo',today=todayIn(tz);
    const days=Array.from({length:view==='week'?span:0},(_,n)=>addDays(start,n));
    const move=n=>setAnchor(addDays(anchor,n*(view==='week'&&!narrow?7:span)));
    const range=span===1?dayLabel(start):ddmm(start)+' – '+ddmm(addDays(end,-1));
    const done=()=>{setDlg(null);data.reload()};
    const list=(data.list||[]).filter(a=>view==='list'||a.status!=='cancelado');
    return h('main',{className:'wag-page'},
      h('header',{className:'wag-head'},h('div',null,h('h1',{className:'wag-title'},'Agenda'),h('p',{className:'wag-hint'},'Horários do escritório. A IA agenda pelo WhatsApp com estas regras; a equipe cria, remarca e cancela aqui.')),
        h('div',{className:'wag-head-actions'},h('button',{type:'button',className:'wag-btn wag-btn-ghost',disabled:!s,onClick:()=>setDlg({kind:'settings'})},svg('cog',14),'Configurações'),
          h('button',{type:'button',className:'wag-btn wag-btn-primary',disabled:!s,onClick:()=>setDlg({kind:'create',day:today>=start&&today<end?today:start,min:9*60})},svg('plus',14),'Novo agendamento'))),
      s&&!s.enabled?h('div',{className:'wag-callout',role:'status'},h('p',null,h('strong',null,'Agenda desligada. '),'A IA não consulta nem marca horários e nenhum lembrete é enviado. A equipe pode usar esta página normalmente.'),h('button',{type:'button',className:'wag-btn wag-btn-sm',onClick:()=>setDlg({kind:'settings'})},'Configurar e ligar')):null,
      h('div',{className:'wag-bar',role:'toolbar','aria-label':'Navegação da agenda'},
        h('div',{className:'wag-seg',role:'group','aria-label':'Visualização'},h('button',{type:'button','aria-pressed':view==='week',onClick:()=>setView('week')},svg('grid',14),'Semana'),h('button',{type:'button','aria-pressed':view==='list',onClick:()=>setView('list')},svg('list',14),'Lista')),
        h('div',{className:'wag-nav'},h('button',{type:'button',className:'wag-ibtn','aria-label':'Anterior',onClick:()=>move(-1)},svg('left',16)),h('button',{type:'button',className:'wag-btn wag-btn-ghost wag-btn-sm',onClick:()=>setAnchor(today)},'Hoje'),h('button',{type:'button',className:'wag-ibtn','aria-label':'Próximo',onClick:()=>move(1)},svg('right',16)),h('span',{className:'wag-range','aria-live':'polite'},range)),
        h('span',{className:'wag-count'},data.list?list.length+' agendamento'+(list.length===1?'':'s'):'')),
      data.error?h('div',{className:'wag-callout','data-tone':'bad',role:'alert'},h('p',null,data.error),h('button',{type:'button',className:'wag-btn wag-btn-sm',onClick:data.reload},'Tentar de novo')):
      !s||!data.list?h('div',{className:'wag-skeleton','aria-busy':'true'},h('span',{className:'sr-only'},'Carregando a agenda…')):
      view==='week'?h(Week,{days,list,settings:s,today,onSlot:(day,min)=>setDlg({kind:'create',day,min}),onOpen:a=>setDlg({kind:'detail',appt:a})}):h(List,{list,settings:s,onOpen:a=>setDlg({kind:'detail',appt:a})}),
      dlg&&dlg.kind==='create'?h(Create,{instance:g,settings:s,initial:dlg,onClose:()=>setDlg(null),onDone:done}):null,
      dlg&&dlg.kind==='detail'?h(Detail,{instance:g,settings:s,appt:dlg.appt,onClose:()=>setDlg(null),onDone:done}):null,
      dlg&&dlg.kind==='settings'?h(Settings,{instance:g,settings:s,onClose:()=>setDlg(null),onDone:done}):null);
  }

  const NEXT=new Map();
  function Next({instance,jid}){
    const name=instance&&instance.name,key=name+'|'+jid;
    const[st,set]=y.useState(()=>{const c=NEXT.get(key);return c&&Date.now()-c.at<6e4?c.v:null});
    y.useEffect(()=>{if(!name||!jid)return;const c=NEXT.get(key);if(c&&Date.now()-c.at<6e4){set(c.v);return}let live=!0;
      Ee.get('/agenda/'+enc(name),{params:{contact:jid,from:new Date().toISOString(),status:'agendado,confirmado',limit:1}}).then(r=>{const v={enabled:!!r.data?.enabled,a:(r.data?.appointments||[])[0]||null};NEXT.set(key,{at:Date.now(),v});live&&set(v)},()=>{live&&set({enabled:!1,a:null})});return()=>{live=!1}},[key]);
    if(!st||(!st.enabled&&!st.a))return null;
    return i.jsxs('div',{className:'wa-tw-field',children:[i.jsxs('dt',{children:[svg('cal',14),i.jsx('span',{children:'Próximo agendamento'})]}),
      i.jsx('dd',{children:st.a?i.jsx(Fu,{to:'/manager/instance/'+instance.id+'/agenda',className:'wag-next',children:st.a.label+' · '+st.a.typeName}):i.jsx('span',{className:'wa-tw-muted',children:'Nenhum'})})]});
  }

  return {Page,Next,Icon};
})();

'''

ROUTE_ANCHOR = '{path:"/manager/instance/:instanceId/usage",element:i.jsx(tn,{children:i.jsx(un,{children:i.jsx(WaUsage.Page,{})})})},'
ROUTE_NEW = '{path:"/manager/instance/:instanceId/agenda",element:i.jsx(tn,{children:i.jsx(un,{children:i.jsx(WaAgenda.Page,{})})})},'
SIDEBAR_ANCHOR = '{id:"usage",title:"Plano e limites",icon:WaUsage.Icon,path:"usage"}'
CMD_ANCHOR = "['usage','Plano e limites','gauge'],"
PANEL_ANCHOR = "i.jsx(Field,{icon:'spark',label:'IA neste contato',stack:!0,children:ai}),"


def patch_component(s):
    return rep(s, 'const Lse=Z2([', COMPONENT + 'const Lse=Z2([', 'route table (const Lse)')


def patch_route(s):
    return rep(s, ROUTE_ANCHOR, ROUTE_ANCHOR + ROUTE_NEW, '"Plano e limites" route (run usage-limits.py first)')


def patch_sidebar(s):
    return rep(s, SIDEBAR_ANCHOR, '{id:"agenda",title:"Agenda",icon:WaAgenda.Icon,path:"agenda"},' + SIDEBAR_ANCHOR,
               'sidebar "Plano e limites" item')


def patch_cmd(s):
    return rep(s, CMD_ANCHOR, "['agenda','Agenda','cal']," + CMD_ANCHOR, 'command menu pages (run twenty-layout.py first)')


def patch_panel(s):
    return rep(s, PANEL_ANCHOR, PANEL_ANCHOR + 'group?null:i.jsx(WaAgenda.Next,{instance,jid}),',
               'contact panel "IA neste contato" (run twenty-layout.py first)')


GROUPS = [('component', patch_component), ('route', patch_route), ('sidebar', patch_sidebar), ('cmd', patch_cmd),
          ('panel', patch_panel)]


def patch_html(html):
    """agenda.css after the last stylesheet link of the patches (whatever patch added it)."""
    links = [m for m in re.finditer(r'    <link rel="stylesheet" href="/assets/[^"]+" />\n', html)]
    if not links:
        raise PatchError('index.html: no patch stylesheet link found')
    end = links[-1].end()
    return html[:end] + '    ' + html_marker('html') + '\n' + CSS_LINK + html[end:]


def bump_index(html):
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
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    missing = [name for name, _ in GROUPS if marker(name) not in s]
    if html_marker('html') not in html:
        missing.append('html')
    if bump_index(html) != html:
        missing.append('index.html cache version')
    if not os.path.isfile(CSS):
        missing.append('agenda.css')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/agenda.css is missing')
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
        report.append(f'index.html written (agenda.css ?v=1, bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
