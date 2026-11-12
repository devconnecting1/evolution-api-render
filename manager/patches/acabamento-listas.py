#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: finish of the lists (Leads and Processos).

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/acabamento-listas.css (a plain file, edited by hand, only var(--m-*) tokens
of minimal.css, linked last).

What it does:
  icons  - a discreet icon per column in the Leads and Processos tables (name/number/area/city/priority/status/
           waiting/last message; case/client/court/class/movement/updated/status), with the header text as the
           accessible name and a title on each th.
  dates  - relative dates ("há 8 min", "há 3 h", "ontem", "12/11") in the Leads "Última mensagem" and in the
           Processos "Última movimentação"/"Atualizado" columns, in the lead side panel and in the waiting chip;
           the exact date and time (24 h) goes in the title. Leads waiting time keeps "Aguardando há 3 h".
  status - the native status select of the Leads table becomes a chip with a dot that opens a menu on click
           (role=menu / menuitemradio, arrows, Home/End, Escape returns the focus). The same component is exported
           for the lead page of ficha-lead.py.
  notif  - "Notificações" in the instance sidebar with a counter, and a small page that only reads existing state:
           leads waiting for the team (GET /leads/:instance counts), pending appointments (GET /agenda/:instance
           status=pendente) and processes with news (GET /processos/:instance/badge), each one with a link to its
           screen. Fetched once per mount and cached in memory for 120 s; no timers, no polling. Links use
           ?seg=aguardando (Leads) and ?view=news (Processos), which the pages now read on open.
  p0     - the two P0 items of the UX review (#80) that fit here: the primary button of the login in the dark
           theme (home.css: token instead of #fff and no fixed hover) and the empty-state icon of Conversas
           (chat-ui.css: #8a9592 -> var(--m-text-3)); the last column cut at 1440 px in Leads and Instâncias is
           handled by acabamento-listas.css (narrower Leads columns and cell padding; Instâncias keeps the actions
           column sticky and narrows the owner column below 1500 px).
  html   - links acabamento-listas.css?v=1 after the last stylesheet, bumps home.css/chat-ui.css versions and
           raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything. Re-running is safe:
groups whose marker is present are skipped. Order: run after every other script (it needs leads.py, processos.py,
agenda.py and twenty-layout.py applied).

Usage (from the repository root):
  python3 -I manager/patches/acabamento-listas.py           # apply
  python3 -I manager/patches/acabamento-listas.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'acabamento-listas.css')
HOME_CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'home.css')
CHAT_CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'chat-ui.css')
REQUIRED = ('/*whatsai-patch:leads:component*/', '/*whatsai-patch:processos:component*/',
            '/*whatsai-patch:agenda:component*/', '/*whatsai-patch:twenty-layout:component*/')
CACHE_VERSION = '55'
CSS_VERSION = '1'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_ANCHOR = '    <link rel="stylesheet" href="/assets/first-run.css?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:acabamento-listas:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:acabamento-listas:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# Minified names (bundle index-b29a5d7a.js): i = jsx runtime, y = React, Ee = axios instance of the API,
# me = toast, Fu = react-router Link, dn = useNavigate, Pi = useLocation, ct = useInstance, svg = local icon
# helpers of WaLeads/WaProc, nf = Intl.NumberFormat. WaLeads/WaProc/WaAgenda = modules of leads.py/processos.py/
# agenda.py. The sidebar is j5; WaTw.PAGES feeds the breadcrumb and the command menu.

# ---------------------------------------------------------------------------------------------------- icons
LEADS_IC_OLD = ("map:['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z','M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z']};")
LEADS_IC_NEW = ("map:['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z','M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],"
                "phone:['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 "
                "19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 "
                "2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 "
                "2.81.7A2 2 0 0 1 22 16.92Z'],"
                "dot:['M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z']};")

LEADS_TH_OLD = ("i.jsx('thead',{children:i.jsx('tr',{children:['Nome','Telefone','Área','Cidade','Prioridade',"
                "'Status','Aguardando','Última mensagem'].map(h=>i.jsx('th',{scope:'col',children:h},h))})}),")
LEADS_TH_NEW = ("i.jsx('thead',{children:i.jsx('tr',{children:[['Nome','users'],['Telefone','phone'],['Área','doc'],"
                "['Cidade','map'],['Prioridade','flag'],['Status','dot'],['Aguardando','clock'],"
                "['Última mensagem','clock']].map(([h,ic])=>i.jsx('th',{scope:'col',title:h,"
                "children:i.jsxs('span',{className:'wa-fin-th',children:[svg(ic,12),i.jsx('span',{children:h})]})},h))})}),")

PROC_IC_OLD = ("dl:['M12 3v12','m7 10 5 5 5-5','M5 21h14'],ext:['M15 3h6v6','M10 14 21 3','M18 13v6a2 2 0 0 1-2 "
               "2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6']};")
PROC_IC_NEW = ("dl:['M12 3v12','m7 10 5 5 5-5','M5 21h14'],ext:['M15 3h6v6','M10 14 21 3','M18 13v6a2 2 0 0 1-2 "
               "2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],users:['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',"
               "'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z','M22 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75'],"
               "book:['M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20'],"
               "doc:['M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z','M14 2v6h6'],"
               "clock:['M12 6v6l4 2','M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],refresh:['M21 12a9 9 0 0 1-9 9 "
               "9.75 9.75 0 0 1-6.74-2.74L3 16','M3 21v-5h5','M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8',"
               "'M21 3v5h-5'],dot:['M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z']};")

PROC_TH_OLD = ("i.jsx('thead',{children:i.jsxs('tr',{children:[i.jsx('th',{children:'Processo'}),i.jsx('th',{children:"
               "'Apelido / Cliente'}),i.jsx('th',{children:'Tribunal'}),i.jsx('th',{children:'Classe'}),"
               "i.jsx('th',{children:'Última movimentação'}),i.jsx('th',{children:'Atualizado'}),i.jsx('th',{children:"
               "'Situação'})]})}),")
PROC_TH_NEW = ("i.jsx('thead',{children:i.jsx('tr',{children:[['Processo','scale'],['Apelido / Cliente','users'],"
               "['Tribunal','book'],['Classe','doc'],['Última movimentação','clock'],['Atualizado','refresh'],"
               "['Situação','dot']].map(([h,ic])=>i.jsx('th',{scope:'col',title:h,children:i.jsxs('span',"
               "{className:'wa-fin-th',children:[svg(IC[ic],12),i.jsx('span',{children:h})]})},h))})}),")


# ---------------------------------------------------------------------------------------------------- dates
DATES_OLD = '  function since(period){'
DATES_NEW = r'''  function exact(t){if(!t)return'';const d=new Date(t);if(isNaN(d.getTime()))return'';return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});}
  function rel(t){if(!t)return'—';const d=new Date(t);if(isNaN(d.getTime()))return'—';const n=new Date(),min=Math.floor(Math.max(0,n.getTime()-d.getTime())/6e4);
    if(min<1)return'agora';
    if(min<60)return'há '+min+' min';
    if(d.toDateString()===n.toDateString())return'há '+Math.floor(min/60)+' h';
    const y=new Date(n);y.setDate(n.getDate()-1);
    if(d.toDateString()===y.toDateString())return'ontem';
    const o={day:'2-digit',month:'2-digit'};if(d.getFullYear()!==n.getFullYear())o.year='numeric';
    return d.toLocaleDateString('pt-BR',o);}
  function When({at}){return i.jsx('span',{title:exact(at)||void 0,children:rel(at)})}
  function since(period){'''
WAIT_OLD = ("function Wait({at}){return at?i.jsx('span',{className:'wl-chip','data-tone':'warn',title:'Sem resposta "
            "da equipe desde '+when(at),children:'Aguardando '+ago(at)}):null}")
WAIT_NEW = ("function Wait({at}){return at?i.jsx('span',{className:'wl-chip','data-tone':'warn',title:'Sem resposta "
            "da equipe desde '+exact(at),children:'Aguardando '+ago(at)}):null}")
LEADS_LAST_OLD = "i.jsx('td',{children:when(l.lastMessageAt)})]},l.id))"
LEADS_LAST_NEW = "i.jsx('td',{children:i.jsx(When,{at:l.lastMessageAt})})]},l.id))"
LEADS_FIRST_OLD = "i.jsx(Field,{icon:'clock',label:'Primeira mensagem',children:i.jsx('span',{children:when(lead.firstMessageAt)})}),"
LEADS_FIRST_NEW = "i.jsx(Field,{icon:'clock',label:'Primeira mensagem',children:i.jsx(When,{at:lead.firstMessageAt})}),"
LEADS_LAST_FIELD_OLD = ("i.jsx(Field,{icon:'clock',label:'Última mensagem',children:i.jsx('span',"
                        "{children:when(lead.lastMessageAt)})})]}),")
LEADS_LAST_FIELD_NEW = "i.jsx(Field,{icon:'clock',label:'Última mensagem',children:i.jsx(When,{at:lead.lastMessageAt})})]}),"

PROC_DATES_OLD = ("  function errText(e){const waF=waFriendlyErr(e);if(waF)return waF;const m=e?.response?.data?.response?.message??"
                  "e?.response?.data?.message;const flat=[].concat(m??[]).flat(4).map(x=>typeof x==='string'?x:x&&x.message?"
                  "String(x.message):'').filter(Boolean);if(flat.length)return flat.join(' ');if(e?.response?.status===404)return "
                  "'A API ainda não tem o recurso Processos: atualize o backend.';return 'Não foi possível falar com a API. "
                  "Tente de novo em instantes.';}")
PROC_DATES_NEW = r'''  function relWhen(t){if(!t)return'—';const d=new Date(t);if(isNaN(d.getTime()))return'—';const n=new Date(),min=Math.floor(Math.max(0,n.getTime()-d.getTime())/6e4);
    if(min<1)return'agora';
    if(min<60)return'há '+min+' min';
    if(d.toDateString()===n.toDateString())return'há '+Math.floor(min/60)+' h';
    const y=new Date(n);y.setDate(n.getDate()-1);
    if(d.toDateString()===y.toDateString())return'ontem';
    const o={day:'2-digit',month:'2-digit'};if(d.getFullYear()!==n.getFullYear())o.year='numeric';
    return d.toLocaleDateString('pt-BR',o);}
  function exactWhen(t){if(!t)return'';const d=new Date(t);if(isNaN(d.getTime()))return'';return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});}
  function WhenFin({at,className}){return i.jsx('span',{className,title:exactWhen(at)||void 0,children:relWhen(at)})}
''' + PROC_DATES_OLD
PROC_MOVE_OLD = "i.jsx('span',{className:'wa-tw-hint',children:dBR(p.lastMovement.occurredAt)})"
PROC_MOVE_NEW = "i.jsx(WhenFin,{at:p.lastMovement.occurredAt,className:'wa-tw-hint'})"
PROC_SYNC_OLD = "i.jsx('td',{className:'wa-tw-hint wp-nowrap',children:dsBR(p.lastSyncedAt)})"
PROC_SYNC_NEW = "i.jsx('td',{className:'wa-tw-hint wp-nowrap',children:i.jsx(WhenFin,{at:p.lastSyncedAt})})"


# ---------------------------------------------------------------------------------------------------- status chip
STATUS_OLD = '  /* ---------------------------------------------------------------- settings drawer */'
STATUS_NEW = r'''  /* ---------------------------------------------------------------- status chip + menu */
  function StatusMenu({status,label,onChange}){
    const[open,setOpen]=y.useState(!1),[pos,setPos]=y.useState(null),btn=y.useRef(null),box=y.useRef(null);
    y.useEffect(()=>{if(!open){setPos(null);return}
      const place=()=>{const b=btn.current;if(!b)return;const r=b.getBoundingClientRect(),w=196,h=204,up=r.bottom+h>window.innerHeight-8&&r.top>h+8;
        setPos({left:Math.max(8,Math.min(r.left,window.innerWidth-w-8)),top:up?r.top-4:r.bottom+4,up})};
      place();
      const close=()=>setOpen(false);
      const down=e=>{if(box.current&&!box.current.contains(e.target)&&btn.current&&!btn.current.contains(e.target))close()};
      const key=e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();close();btn.current&&btn.current.focus()}};
      document.addEventListener('mousedown',down);document.addEventListener('keydown',key,!0);
      window.addEventListener('resize',close);window.addEventListener('scroll',close,!0);
      const t=setTimeout(()=>{const f=box.current&&box.current.querySelector('[role="menuitemradio"]');f&&f.focus({preventScroll:true})},0);
      return()=>{clearTimeout(t);document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key,!0);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,!0)}},[open]);
    const pick=v=>{setOpen(!1);btn.current&&btn.current.focus();if(v!==status)onChange(v)};
    const onMenuKey=e=>{const items=box.current?Array.from(box.current.querySelectorAll('[role="menuitemradio"]')):[];if(!items.length)return;
      const at=Math.max(0,items.indexOf(document.activeElement));
      if(e.key==='ArrowDown'){e.preventDefault();(items[(at+1)%items.length]||items[0]).focus()}
      else if(e.key==='ArrowUp'){e.preventDefault();(items[(at-1+items.length)%items.length]||items[items.length-1]).focus()}
      else if(e.key==='Home'){e.preventDefault();items[0].focus()}
      else if(e.key==='End'){e.preventDefault();items[items.length-1].focus()}};
    return i.jsxs('div',{className:'wa-fin-stwrap',children:[
      i.jsxs('button',{ref:btn,type:'button',className:'wa-fin-status','data-status':status,'aria-haspopup':'menu','aria-expanded':open?'true':'false',title:'Mudar status'+(label?' de '+label:''),onClick:()=>setOpen(o=>!o),children:[
        i.jsx('span',{className:'wa-fin-dot','aria-hidden':'true'}),i.jsx('span',{children:lbl(STATUS,status)}),svg('down',12)]}),
      open&&pos?Ib.createPortal(i.jsx('div',{ref:box,className:'wa-fin-menu',role:'menu','aria-label':'Status do lead',style:{position:'fixed',left:pos.left,top:pos.top,width:196,transform:pos.up?'translateY(-100%)':void 0},onKeyDown:onMenuKey,children:STATUS.map(([k,lb])=>i.jsxs('button',{type:'button',role:'menuitemradio','aria-checked':status===k?'true':'false',tabIndex:-1,className:'wa-fin-opt',onClick:()=>pick(k),children:[
        i.jsx('span',{className:'wa-fin-dot','data-status':k,'aria-hidden':'true'}),i.jsx('span',{children:lb}),status===k?svg('check',14):null]},k))}),document.body):null]});
  }

  /* ---------------------------------------------------------------- settings drawer */'''
STATUS_TD_OLD = ("i.jsx('td',{onClick:e=>e.stopPropagation(),children:i.jsx('select',{className:'wl-select-inline',"
                 "value:l.status,'aria-label':'Status de '+title(l),onKeyDown:e=>e.stopPropagation(),onChange:e=>"
                 "changeStatus(l,e.target.value),children:STATUS.map(([k,lb])=>i.jsx('option',{value:k,children:lb},k))})}),")
STATUS_TD_NEW = ("i.jsx('td',{onClick:e=>e.stopPropagation(),children:i.jsx(StatusMenu,{status:l.status,label:title(l),"
                 "onChange:s=>changeStatus(l,s)})}),")
EXPORT_OLD = '  return{Page,Icon,ContactField};\n})();\n'
EXPORT_NEW = ('  return{Page,Icon,ContactField,StatusMenu,When,rel,exact,title,fullPhone,mask,STATUS,lbl};\n})();\n')


# ---------------------------------------------------------------------------------------------------- notifications
NOTIF_ANCHOR = '\nconst WaProc=(()=>{'
NOTIF = r'''const WaNotif=(()=>{
  const nf=new Intl.NumberFormat('pt-BR'),enc=encodeURIComponent;
  const IC={bell:['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9','M10.3 21a1.94 1.94 0 0 0 3.4 0'],
    users:['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z','M22 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75'],
    cal:['M8 2v4','M16 2v4','M3 10h18','M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'],
    book:['M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20'],
    ext:['M15 3h6v6','M10 14 21 3','M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6']};
  function svg(name,size){const d=IC[name]||[];return i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:size||15,height:size||15,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'1.6',strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',children:d.map((p,k)=>i.jsx('path',{d:p},k))});}
  const C=new Map(),subs=new Set();
  const emit=()=>subs.forEach(f=>{try{f()}catch(e){}});
  function get(name){return C.get(name)||{status:name?'loading':'idle',counts:null,at:0,p:null}}
  // Reads the existing state once per instance and keeps it in memory for 120 s. No timers, no polling.
  function load(inst,force){
    const name=inst&&inst.name;if(!name)return null;
    const cur=get(name);
    if(cur.p)return cur.p;
    if(!force&&cur.counts&&Date.now()-cur.at<12e4)return null;
    const p=Promise.all([
      Ee.get('/leads/'+enc(name),{params:{status:'aguardando',pageSize:1}}).then(r=>Number(r.data&&r.data.counts&&r.data.counts.aguardando)||0,()=>null),
      Ee.get('/agenda/'+enc(name),{params:{status:'pendente'}}).then(r=>Array.isArray(r.data&&r.data.appointments)?r.data.appointments.filter(a=>a&&a.status==='pendente').length:0,()=>null),
      Ee.get('/processos/'+enc(name)+'/badge').then(r=>Number(r.data&&r.data.processesWithNews)||0,()=>null)
    ]).then(([leads,agenda,processos])=>{
      if(leads==null&&agenda==null&&processos==null){C.set(name,{...cur,status:'error',p:null});emit();return null}
      const counts={leads:leads||0,agenda:agenda||0,processos:processos||0};counts.total=counts.leads+counts.agenda+counts.processos;
      C.set(name,{status:'ok',counts,at:Date.now(),p:null});emit();return counts},
      ()=>{C.set(name,{...cur,status:'error',p:null});emit();return null});
    C.set(name,{...cur,status:'loading',p});
    emit();
    return p;
  }
  function useCounts(inst){
    const[,tick]=y.useState(0),name=inst&&inst.name;
    y.useEffect(()=>{const f=()=>tick(n=>n+1);subs.add(f);load(inst);return()=>{subs.delete(f)}},[name]);
    const st=get(name);
    return{status:st.status,counts:st.counts,reload:()=>load(inst,!0)};
  }
  function Icon({size}){const{instance:g}=ct(),st=useCounts(g),n=st.counts?st.counts.total:0;
    return i.jsxs(i.Fragment,{children:[svg('bell',Number(size)||15),n>0?i.jsxs('span',{className:'wa-fin-nav-n',children:[n>99?'99+':nf.format(n),i.jsx('span',{className:'sr-only',children:' notificações'})]}):null]});}
  const ITEMS=[
    ['leads','Leads aguardando a equipe','users','Leads abertos com mensagem do cliente esperando resposta da equipe.','leads?seg=aguardando','Ver leads'],
    ['agenda','Agendamentos pendentes','cal','Pedidos de agendamento feitos pela IA que aguardam aprovação da equipe.','agenda','Ver agenda'],
    ['processos','Processos com novidade','book','Processos com movimentação ainda não vista pela equipe.','processos?view=news','Ver processos']];
  function Page(){
    const{instance:g}=ct(),st=useCounts(g);
    if(!g)return null;
    const c=st.counts||{leads:0,agenda:0,processos:0,total:0};
    const val=k=>k==='leads'?c.leads:k==='agenda'?c.agenda:c.processos;
    return i.jsxs('main',{className:'wa-fin-page',children:[
      i.jsxs('header',{className:'wa-fin-head',children:[i.jsx('h1',{className:'wa-fin-title',children:'Notificações'}),
        i.jsx('p',{className:'wa-fin-muted',children:'O que pede atenção agora. Os números são lidos ao abrir o painel e ficam em memória por dois minutos; nada é consultado em segundo plano.'})]}),
      st.status==='error'&&!st.counts?i.jsxs('div',{className:'wa-tw-empty',role:'status',children:[
        i.jsx('p',{className:'wa-tw-empty-title',children:'Não foi possível carregar as notificações'}),
        i.jsx('p',{className:'wa-tw-empty-text',children:'Confira a conexão com o servidor e tente de novo.'}),
        i.jsx('button',{type:'button',className:'wa-tw-sbtn',onClick:st.reload,children:'Tentar de novo'})]}):
      i.jsx('ul',{className:'wa-fin-list',children:ITEMS.map(([k,title,icon,text,path,action])=>{const n=val(k);
        return i.jsx('li',{children:i.jsxs('section',{className:'wa-fin-item','data-empty':n?'false':'true',children:[
          i.jsx('span',{className:'wa-fin-item-ic',children:svg(icon,18)}),
          i.jsxs('div',{className:'wa-fin-item-text',children:[i.jsxs('h2',{className:'wa-fin-item-title',children:[title,n?i.jsx('span',{className:'wa-fin-item-n',children:nf.format(n)}):null]}),i.jsx('p',{className:'wa-fin-muted',children:text})]}),
          i.jsxs(Fu,{to:'/manager/instance/'+g.id+'/'+path,className:'wa-tw-sbtn wa-tw-sbtn--ghost',children:[action,svg('ext',13)]})]})},k)})}),
      i.jsx('p',{className:'wa-fin-foot',children:'Esta página não atualiza sozinha. Para ver os números mais recentes, recarregue ou volte para cá depois de responder aos atendimentos.'})]});
  }
  return{Icon,Page,useCounts,load};
})();
'''
NOTIF_ROUTE_ANCHOR = ('{path:"/manager/instance/:instanceId/leads",element:i.jsx(tn,{children:i.jsx(un,{children:'
                      'i.jsx(WaLeads.Page,{})})})},')
NOTIF_ROUTE = ('{path:"/manager/instance/:instanceId/notificacoes",element:i.jsx(tn,{children:i.jsx(un,'
               '{children:i.jsx(WaNotif.Page,{})})})},')
SIDEBAR_ANCHOR = 't=y.useMemo(()=>[{id:"dashboard",'
SIDEBAR_NEW = ('t=y.useMemo(()=>[{id:"notificacoes",title:"Notificações",icon:WaNotif.Icon,path:"notificacoes"},'
               '{id:"dashboard",')
PAGES_ANCHOR = "const PAGES=[['dashboard','Visão Geral','grid'],"
PAGES_NEW = "const PAGES=[['notificacoes','Notificações','bell'],['dashboard','Visão Geral','grid'],"
TW_IC_OLD = "    dot:['M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z','M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],"
TW_IC_NEW = ("    bell:['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9','M10.3 21a1.94 1.94 0 0 0 3.4 0'],\n"
             "    dot:['M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z','M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],")
LEADS_SEG_OLD = "const[v,setV]=y.useState(readView),[q,setQ]=y.useState('')"
LEADS_SEG_NEW = ("const[v,setV]=y.useState(()=>{const o=readView(),s=new URLSearchParams(loc.search||'').get('seg');"
                 "return s&&has(VIEWS,s)?{...o,seg:s}:o}),[q,setQ]=y.useState('')")
PROC_VIEW_OLD = ("const[data,setData]=y.useState(null),[err,setErr]=y.useState(''),[view,setView]=y.useState('all')")
PROC_VIEW_NEW = ("const[data,setData]=y.useState(null),[err,setErr]=y.useState(''),[view,setView]=y.useState(()=>"
                 "new URLSearchParams(window.location.search).get('view')==='news'?'news':'all')")


def patch_icons(s):
    s = rep(s, LEADS_IC_OLD, LEADS_IC_NEW, 'WaLeads icon map')
    s = rep(s, LEADS_TH_OLD, LEADS_TH_NEW, 'Leads table header')
    s = rep(s, PROC_IC_OLD, PROC_IC_NEW, 'WaProc icon map')
    return rep(s, PROC_TH_OLD, PROC_TH_NEW, 'Processos table header')


def patch_dates(s):
    s = rep(s, DATES_OLD, DATES_NEW, 'WaLeads since (relative date helpers)')
    s = rep(s, WAIT_OLD, WAIT_NEW, 'Wait chip title')
    s = rep(s, LEADS_LAST_OLD, LEADS_LAST_NEW, 'Leads last message cell')
    s = rep(s, LEADS_FIRST_OLD, LEADS_FIRST_NEW, 'lead panel first message')
    s = rep(s, LEADS_LAST_FIELD_OLD, LEADS_LAST_FIELD_NEW, 'lead panel last message')
    s = rep(s, PROC_DATES_OLD, PROC_DATES_NEW, 'WaProc relative date helpers')
    s = rep(s, PROC_MOVE_OLD, PROC_MOVE_NEW, 'Processos last movement date')
    return rep(s, PROC_SYNC_OLD, PROC_SYNC_NEW, 'Processos updated date')


def patch_status(s):
    s = rep(s, STATUS_OLD, STATUS_NEW, 'WaLeads settings drawer anchor')
    s = rep(s, STATUS_TD_OLD, STATUS_TD_NEW, 'Leads status cell')
    return rep(s, EXPORT_OLD, EXPORT_NEW, 'WaLeads exports')


def patch_notif(s):
    s = rep(s, NOTIF_ANCHOR, NOTIF + NOTIF_ANCHOR, 'route table (before WaProc)')
    s = rep(s, NOTIF_ROUTE_ANCHOR, NOTIF_ROUTE_ANCHOR + NOTIF_ROUTE, 'Leads route')
    s = rep(s, SIDEBAR_ANCHOR, SIDEBAR_NEW, 'instance sidebar first item')
    s = rep(s, PAGES_ANCHOR, PAGES_NEW, 'WaTw pages (breadcrumb/command menu)')
    s = rep(s, TW_IC_OLD, TW_IC_NEW, 'WaTw icon map')
    s = rep(s, LEADS_SEG_OLD, LEADS_SEG_NEW, 'Leads view from ?seg=')
    return rep(s, PROC_VIEW_OLD, PROC_VIEW_NEW, 'Processos view from ?view=news')


GROUPS = [('icons', patch_icons), ('dates', patch_dates), ('status', patch_status), ('notif', patch_notif)]

# ---------------------------------------------------------------------------------------------------- P0 CSS
HOME_OLD = """[data-wa-home] .wa-btn-ink {
  background: var(--wa-ink);
  color: #fff;
  border-radius: var(--wa-radius);
}
[data-wa-home] .wa-btn-ink:hover {
  background: #262626;
}"""
HOME_NEW = """[data-wa-home] .wa-btn-ink {
  background: var(--wa-ink);
  color: var(--wa-paper);
  border-radius: var(--wa-radius);
}
[data-wa-home] .wa-btn-ink:hover {
  background: var(--wa-ink);
  box-shadow: inset 0 0 0 999px rgb(0 0 0 / 0.06);
}"""
CHAT_OLD = '  color: #8a9592;'
CHAT_NEW = '  color: var(--m-text-3);'
P0_MARK = '/*whatsai-patch:acabamento-listas:p0*/'


def patch_p0(home, chat):
    if P0_MARK not in home:
        home = P0_MARK + '\n' + rep(home, HOME_OLD, HOME_NEW, 'home.css login primary button')
    if P0_MARK not in chat:
        chat = P0_MARK + '\n' + rep(chat, CHAT_OLD, CHAT_NEW, 'chat-ui.css empty state icon')
    return home, chat


def patch_html(html):
    if html_marker('html') in html:
        return html
    pos = html.find(CSS_ANCHOR)
    if pos < 0 or html.count(CSS_ANCHOR) != 1:
        raise PatchError('index.html: first-run.css link not found exactly once')
    end = html.index('\n', pos) + 1
    link = f'    <link rel="stylesheet" href="/assets/acabamento-listas.css?v={CSS_VERSION}" />\n'
    html = html[:end] + '    ' + html_marker('html') + '\n' + link + html[end:]
    return html


def bump_css(html, name, version):
    return re.sub(r'(/assets/' + re.escape(name) + r'\.css\?v=)(\d+)',
                  lambda m: m.group(1) + (str(version) if int(m.group(2)) < version else m.group(2)), html)


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
    home = open(HOME_CSS, encoding='utf-8').read()
    chat = open(CHAT_CSS, encoding='utf-8').read()

    missing = [name for name, _ in GROUPS if marker(name) not in s]
    if html_marker('html') not in html:
        missing.append('html')
    if P0_MARK not in home:
        missing.append('home.css')
    if P0_MARK not in chat:
        missing.append('chat-ui.css')
    if bump_index(bump_css(bump_css(html, 'home', 4), 'chat-ui', 3)) != html:
        missing.append('index.html versions')
    if not os.path.isfile(CSS):
        missing.append('acabamento-listas.css')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/acabamento-listas.css is missing')
    for required in REQUIRED:
        if required not in s:
            raise PatchError(f'run the patch that adds {required} first: missing {required}')

    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    home, chat = patch_p0(home, chat)
    report.append('p0: home.css/chat-ui.css ok')
    new_html = patch_html(html)
    new_html = bump_index(bump_css(bump_css(new_html, 'home', 4), 'chat-ui', 3))

    open(BUNDLE, 'w', encoding='utf-8').write(s)
    open(HOME_CSS, 'w', encoding='utf-8').write(home)
    open(CHAT_CSS, 'w', encoding='utf-8').write(chat)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        report.append(f'index.html written (acabamento-listas.css ?v={CSS_VERSION}, bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
