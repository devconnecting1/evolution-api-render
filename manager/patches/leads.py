#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Leads" page (triagem dos atendimentos) and the Lead field of the
contact side panel of Conversas.

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/leads.css (a plain file, edited by hand, only var(--m-*) tokens of
minimal.css, linked right after twenty-layout.css). It reuses the primitives of twenty-layout.css.

Backend (same release): GET /leads/:instance (filters, sort, pagination, counts per view), GET/PATCH
/leads/:instance/:id, GET /leads/:instance/export.csv, GET/POST /leads/settings/:instance and GET/POST
/leads/backfill/:instance. Requests go through the bundle's axios instance (Ee: API URL + apikey).

Bundle groups (each one is applied once and leaves a marker comment at the top of the bundle):
  component - WaLeads, an isolated component module (IIFE) placed before the route table (after WaTw):
              Page: header with "Exportar CSV", "Analisar conversas anteriores" (dry run first, confirmation
              dialog with the estimated count, then progress) and "Configurações"; view bar "Todos · Aguardando
              equipe · Novos · Qualificados · Em atendimento · Clientes · Descartados" with counts; search, "Filtro"
              (área, prioridade, período) and "Ordenar" popovers with removable chips; record table (Nome,
              Telefone masked, Área, Cidade, Prioridade chip with the reason, Status inline select, Aguardando
              "há 3 h" chip, Última mensagem); pagination; empty states. Row click (or ?lead=<id>) opens the record
              side panel: summary, what is missing, next step, opposing party with "Verificar conflito de
              interesses", lawyer, documents and files, origin, dates, editable fields (only the edited ones are
              sent; each one gets locked against the AI), "Abrir conversa" and "Abrir no WhatsApp".
              Settings drawer: automatic analysis, areas, model, internal notices to the team (off by default).
              ContactField: the "Lead" row of the Conversas contact panel (status + área, link to the lead).
  route     - /manager/instance/:instanceId/leads inside the instance layout (same guards as the dashboard).
  sidebar   - "Leads" item between "Conversas" and "Plano e limites".
  pages     - "Leads" in the breadcrumb header and the command menu of twenty-layout.py.
  contact   - the Lead row in the contact side panel of twenty-layout.py (not for groups).
index.html group (marker: an HTML comment in <head>):
  html      - links leads.css?v=1 after twenty-layout.css and bumps the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.
Order: run after every other script (it needs usage-limits.py, twenty-layout.py and root-redirect.py applied).

Usage (from the repository root):
  python3 -I manager/patches/leads.py           # apply
  python3 -I manager/patches/leads.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'leads.css')
REQUIRED = ('/*whatsai-patch:usage-limits:component*/', '/*whatsai-patch:usage-limits:sidebar*/',
            '/*whatsai-patch:twenty-layout:component*/', '/*whatsai-patch:root-redirect:v1*/')
CACHE_VERSION = '23'
SCRIPT_TAG = '<script type="module" crossorigin src="/assets/index-b29a5d7a.js?v='
CSS_ANCHOR = '    <link rel="stylesheet" href="/assets/twenty-layout.css?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:leads:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:leads:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# Minified names (bundle index-b29a5d7a.js): i = jsx runtime, y = React, Ee = axios instance of the API, me = toast,
# Fu = react-router Link, Pi = useLocation, dn = useNavigate, ct = useInstance (instance context),
# Pt / Nt / Mt / zt / eo / Yt = Dialog / Content / Header / Title / Description / Footer, se = Button,
# tn = protected route, un = instance layout. WaTw = twenty-layout.py module (Panel, PAGES).

COMPONENT = r'''const WaLeads=(()=>{
  const nf=new Intl.NumberFormat('pt-BR');
  const STATUS=[['novo','Novo'],['qualificado','Qualificado'],['em_atendimento','Em atendimento'],['cliente','Cliente'],['descartado','Descartado']];
  const VIEWS=[['todos','Todos'],['aguardando','Aguardando equipe'],['novo','Novos'],['qualificado','Qualificados'],['em_atendimento','Em atendimento'],['cliente','Clientes'],['descartado','Descartados']];
  const PRIOS=[['alta','Alta'],['normal','Normal'],['baixa','Baixa']];
  const PERIODS=[['any','Qualquer data'],['today','Hoje'],['7d','Últimos 7 dias'],['30d','Últimos 30 dias']];
  const SORTS=[['priority','Prioridade e espera'],['waiting','Espera mais longa'],['recent','Mais recentes'],['created','Criados recentemente'],['name','Nome (A–Z)']];
  const NOTIFY=[['ambos','Qualificado ou prioridade alta'],['qualificado','Quando ficar qualificado'],['urgente','Só prioridade alta']];
  const lbl=(l,v)=>(l.find(x=>x[0]===v)||['',v||''])[1];
  const has=(l,v)=>l.some(x=>x[0]===v);
  const DEF={seg:'todos',area:'',priority:'',period:'any',sort:'priority'};
  function ls_(k,v){try{if(v===void 0)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){}return null}
  function readView(){try{const o=JSON.parse(ls_('wa-leads-view')||'{}')||{};return{seg:has(VIEWS,o.seg)?o.seg:'todos',area:typeof o.area==='string'?o.area:'',priority:has(PRIOS,o.priority)?o.priority:'',period:has(PERIODS,o.period)?o.period:'any',sort:has(SORTS,o.sort)?o.sort:'priority'}}catch(e){return{...DEF}}}
  const IC={
    users:['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z','M22 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75'],
    filter:['M3 6h18','M7 12h10','M10 18h4'],sort:['m3 16 4 4 4-4','M7 20V4','M11 4h10','M11 8h7','M11 12h4'],
    x:['M18 6 6 18','m6 6 12 12'],check:['M20 6 9 17l-5-5'],search:['m21 21-4.3-4.3','M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'],
    ext:['M15 3h6v6','M10 14 21 3','M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],chat:['M7.9 20A9 9 0 1 0 4 16.1L2 22Z'],
    down:['M12 3v12','m7 10 5 5 5-5','M5 21h14'],spark:['M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2Z'],
    clock:['M12 6v6l4 2','M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],
    cog:['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z','M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z'],
    flag:['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z','M4 22v-7'],
    doc:['M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z','M14 2v6h6'],
    map:['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z','M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z']};
  function svg(name,size){const d=IC[name]||[];return i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:size||16,height:size||16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'1.6',strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',children:d.map((p,k)=>i.jsx('path',{d:p},k))});}
  function Icon({size}){return svg('users',Number(size)||15);}
  function errText(e){const m=e?.response?.data?.response?.message??e?.response?.data?.message;const flat=[].concat(m??[]).flat(4).map(x=>typeof x==='string'?x:x&&x.message?String(x.message):'').filter(Boolean);if(flat.length)return flat.join(' ');if(e?.response?.status===404)return 'A API ainda não tem o recurso Leads: atualize o backend.';return 'Não foi possível falar com a API. Tente de novo em instantes.';}
  function mask(phone){const d=String(phone||'');if(!d)return'Oculto pelo WhatsApp';const m=/^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);return m?'('+m[1]+') '+m[2].slice(0,1)+'••••-'+m[3]:d.slice(0,4)+'•••'+d.slice(-4);}
  function fullPhone(phone){const m=/^55(\d{2})(\d{4,5})(\d{4})$/.exec(String(phone||''));return m?'+55 ('+m[1]+') '+m[2]+'-'+m[3]:phone?'+'+phone:'';}
  function ago(t){const ms=Date.now()-Date.parse(t);if(!isFinite(ms))return'';const min=Math.max(0,Math.floor(ms/6e4));if(min<60)return'há '+Math.max(1,min)+' min';const h=Math.floor(min/60);if(h<24)return'há '+h+' h';const d=Math.floor(h/24);return'há '+d+(d===1?' dia':' dias');}
  function when(t){if(!t)return'—';const d=new Date(t),n=new Date(),o=new Date(n);o.setDate(n.getDate()-1);const hm=d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    return d.toDateString()===n.toDateString()?'Hoje, '+hm:d.toDateString()===o.toDateString()?'Ontem, '+hm:d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'})+' '+hm;}
  function since(period){const now=Date.now(),d=new Date();d.setHours(0,0,0,0);return period==='today'?d.toISOString():period==='7d'?new Date(now-7*864e5).toISOString():period==='30d'?new Date(now-30*864e5).toISOString():'';}
  const title=l=>l.name||l.pushName||mask(l.phone);
  function Prio({lead,long}){const p=lead.priority||'normal';return i.jsx('span',{className:'wl-chip','data-tone':p==='alta'?'bad':p==='baixa'?void 0:'neutral',title:lead.priorityReason||void 0,children:long?'Prioridade '+lbl(PRIOS,p).toLowerCase():lbl(PRIOS,p)})}
  function Wait({at}){return at?i.jsx('span',{className:'wl-chip','data-tone':'warn',title:'Sem resposta da equipe desde '+when(at),children:'Aguardando '+ago(at)}):null}
  function StatusChip({s}){return i.jsx('span',{className:'wl-chip','data-tone':s==='qualificado'?'tint':s==='cliente'?'ok':s==='descartado'?void 0:s==='em_atendimento'?'ok':'neutral',children:lbl(STATUS,s)})}
  function Pop({id,label,icon,count,align,children}){
    const[open,setOpen]=y.useState(!1),btn=y.useRef(null),box=y.useRef(null);
    y.useEffect(()=>{if(!open)return;
      const down=e=>{if(box.current&&!box.current.contains(e.target)&&btn.current&&!btn.current.contains(e.target))setOpen(!1)};
      const key=e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();setOpen(!1);btn.current&&btn.current.focus()}};
      document.addEventListener('mousedown',down);document.addEventListener('keydown',key,!0);
      const f=box.current&&box.current.querySelector('input:checked,input,select,button');f&&f.focus();
      return()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key,!0)}},[open]);
    return i.jsxs('div',{className:'wa-tw-popwrap',children:[
      i.jsxs('button',{ref:btn,type:'button',className:'wa-tw-lbtn','data-active':count?'true':void 0,'aria-haspopup':'dialog','aria-expanded':open?'true':'false','aria-controls':open?id:void 0,onClick:()=>setOpen(o=>!o),children:[svg(icon,14),i.jsx('span',{children:label}),count?i.jsx('span',{className:'wa-tw-lbtn-n','aria-label':count+' ativo(s)',children:count}):null]}),
      open?i.jsx('div',{ref:box,id,role:'dialog','aria-label':label,className:'wa-tw-pop'+(align==='end'?' wa-tw-pop--end':''),children:children(()=>{setOpen(!1);btn.current&&btn.current.focus()})}):null]});
  }
  function Opt({type,name,checked,onChange,label}){return i.jsxs('label',{className:'wa-tw-opt','data-checked':checked?'true':void 0,children:[i.jsx('input',{type,name,checked,onChange}),i.jsx('span',{className:'wa-tw-opt-text',children:i.jsx('span',{children:label})}),i.jsx('span',{className:'wa-tw-opt-check','aria-hidden':'true',children:checked?svg('check',14):null})]})}
  function Empty({icon,title,text,action,onAction}){return i.jsxs('div',{className:'wa-tw-empty',role:'status',children:[i.jsx('span',{className:'wa-tw-empty-icon',children:svg(icon||'users',20)}),i.jsx('p',{className:'wa-tw-empty-title',children:title}),text?i.jsx('p',{className:'wa-tw-empty-text',children:text}):null,action?i.jsx('button',{type:'button',className:'wa-tw-sbtn',onClick:onAction,children:action}):null]})}
  function Field({icon,label,stack,children}){return i.jsxs('div',{className:'wa-tw-field'+(stack?' wa-tw-field--stack':''),children:[i.jsxs('dt',{children:[svg(icon,14),i.jsx('span',{children:label})]}),i.jsx('dd',{children})]})}
  async function download(name,query){const r=await Ee.get('/leads/'+encodeURIComponent(name)+'/export.csv',{params:query,responseType:'blob'});
    const url=URL.createObjectURL(r.data instanceof Blob?r.data:new Blob([r.data],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');
    a.href=url;a.download='leads-'+String(name).replace(/[^\w.-]+/g,'-')+'-'+new Date().toISOString().slice(0,10)+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1e3);}

  /* ---------------------------------------------------------------- record side panel */
  const EDIT=['status','priority','priorityReason','name','area','city','nextStep','summary','opposingParty','hasLawyer','missingInfo'];
  function toForm(l){return{status:l.status,priority:l.priority||'normal',priorityReason:l.priorityReason||'',name:l.name||'',area:l.area||'',city:l.city||'',nextStep:l.nextStep||'',summary:l.summary||'',opposingParty:l.opposingParty||'',hasLawyer:l.hasLawyer===!0?'sim':l.hasLawyer===!1?'nao':'',missingInfo:(l.missingInfo||[]).join('\n')}}
  function toValue(k,v){if(k==='hasLawyer')return v==='sim'?!0:v==='nao'?!1:null;if(k==='missingInfo')return String(v).split('\n').map(x=>x.trim()).filter(Boolean);if(k==='status'||k==='priority')return v;const t=String(v).trim();return t||null}
  function Panel({lead,instance,areas,onClose,onSaved}){
    const ref=y.useRef(null),closeRef=y.useRef(null);
    const base=y.useMemo(()=>toForm(lead),[lead]);
    const[f,setF]=y.useState(base),[busy,setBusy]=y.useState(!1),[err,setErr]=y.useState('');
    y.useEffect(()=>{setF(base);setErr('')},[base]);
    y.useEffect(()=>{closeRef.current&&closeRef.current.focus()},[lead.id]);
    y.useEffect(()=>{const k=e=>{if(e.key==='Escape'&&!e.defaultPrevented){e.preventDefault();onClose()}};window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[onClose]);
    const changed=EDIT.filter(k=>JSON.stringify(toValue(k,f[k]))!==JSON.stringify(toValue(k,base[k])));
    const set=p=>{setF(o=>({...o,...p}));setErr('')};
    const save=async()=>{if(!changed.length)return;setBusy(!0);setErr('');
      try{const body={};for(const k of changed)body[k]=toValue(k,f[k]);if(changed.includes('priority')&&!changed.includes('priorityReason'))delete body.priorityReason;
        const r=await Ee.patch('/leads/'+encodeURIComponent(instance.name)+'/'+encodeURIComponent(lead.id),body);me.success('Lead atualizado. Os campos editados não serão mais alterados pela IA.');onSaved(r.data&&r.data.lead)}
      catch(e){const t=errText(e);setErr(t);me.error(t)}finally{setBusy(!1)}};
    const areaOpts=[...new Set([...(areas||[]),lead.area].filter(Boolean))];
    const inp=(k,ph,max)=>i.jsx('input',{className:'wl-input',value:f[k],maxLength:max,placeholder:ph,'aria-label':ph,onChange:e=>set({[k]:e.target.value})});
    const jid=lead.remoteJid,chat='/manager/instance/'+instance.id+'/chat/'+jid;
    return i.jsxs(i.Fragment,{children:[i.jsx('div',{className:'wl-backdrop','aria-hidden':'true',onClick:onClose}),
      i.jsxs('aside',{ref,className:'wl-panel',role:'dialog','aria-modal':'true','aria-labelledby':'wl-panel-title',children:[
        i.jsxs('header',{className:'wa-tw-panel-head',children:[i.jsx('h2',{className:'wa-tw-panel-kicker',children:'Lead'}),
          i.jsx('button',{ref:closeRef,type:'button',className:'wa-tw-ibtn','aria-label':'Fechar lead',title:'Fechar (Esc)',onClick:onClose,children:svg('x',16)})]}),
        i.jsxs('div',{className:'wa-tw-panel-id',children:[i.jsxs('div',{className:'wa-tw-panel-idtext',children:[i.jsx('p',{id:'wl-panel-title',className:'wa-tw-panel-name',children:title(lead)}),
          i.jsx('p',{className:'wa-tw-muted wl-mono',children:lead.phone?fullPhone(lead.phone):'Número oculto pelo WhatsApp'})]})]}),
        i.jsxs('div',{className:'wl-panel-body',children:[
          i.jsxs('div',{className:'wl-actions',style:{padding:'0 8px 12px'},children:[
            i.jsxs(Fu,{to:chat,className:'wa-tw-sbtn',children:[svg('chat',14),'Abrir conversa']}),
            lead.whatsappUrl?i.jsxs('a',{className:'wa-tw-sbtn wa-tw-sbtn--ghost',href:lead.whatsappUrl,target:'_blank',rel:'noopener noreferrer',children:[svg('ext',14),'Abrir no WhatsApp',i.jsx('span',{className:'sr-only',children:' (abre em nova aba)'})]}):null]}),
          i.jsxs('div',{className:'wl-chips',style:{padding:'0 8px 12px'},children:[i.jsx(StatusChip,{s:lead.status}),i.jsx(Prio,{lead,long:!0}),i.jsx(Wait,{at:lead.awaitingHumanSince})]}),
          i.jsxs('section',{className:'wl-sec',children:[i.jsx('h3',{className:'wl-sec-title',children:'Resumo'}),
            i.jsx('textarea',{className:'wl-textarea',rows:4,maxLength:600,value:f.summary,'aria-label':'Resumo',placeholder:'Ainda sem resumo.',onChange:e=>set({summary:e.target.value})}),
            lead.priorityReason?i.jsx('p',{className:'wl-hint',children:'Motivo da prioridade: '+lead.priorityReason}):null]}),
          i.jsxs('section',{className:'wl-sec',children:[i.jsx('h3',{className:'wl-sec-title',children:'Falta saber'}),
            i.jsx('textarea',{className:'wl-textarea',rows:3,value:f.missingInfo,'aria-label':'Falta saber (um item por linha)',placeholder:'Nada pendente.',onChange:e=>set({missingInfo:e.target.value})}),
            i.jsx('p',{className:'wl-hint',children:'Um item por linha. Lista para a equipe; nunca é enviada ao cliente.'})]}),
          i.jsxs('section',{className:'wl-sec',children:[i.jsx('h3',{className:'wl-sec-title',children:'Próximo passo da equipe'}),
            i.jsx('textarea',{className:'wl-textarea',rows:2,maxLength:200,value:f.nextStep,'aria-label':'Próximo passo',placeholder:'Ex.: ligar antes da audiência',onChange:e=>set({nextStep:e.target.value})})]}),
          i.jsxs('dl',{className:'wa-tw-fields wl-sec',children:[
            i.jsx(Field,{icon:'flag',label:'Status',children:i.jsx('select',{className:'wl-select',value:f.status,'aria-label':'Status',onChange:e=>set({status:e.target.value}),children:STATUS.map(([k,lb])=>i.jsx('option',{value:k,children:lb},k))})}),
            i.jsx(Field,{icon:'spark',label:'Prioridade',children:i.jsx('select',{className:'wl-select',value:f.priority,'aria-label':'Prioridade',onChange:e=>set({priority:e.target.value}),children:PRIOS.map(([k,lb])=>i.jsx('option',{value:k,children:lb},k))})}),
            i.jsx(Field,{icon:'users',label:'Nome',children:inp('name','Nome do cliente',120)}),
            i.jsx(Field,{icon:'doc',label:'Área',children:i.jsxs('select',{className:'wl-select',value:f.area,'aria-label':'Área',onChange:e=>set({area:e.target.value}),children:[i.jsx('option',{value:'',children:'Não informada'}),areaOpts.map(a=>i.jsx('option',{value:a,children:a},a))]})}),
            i.jsx(Field,{icon:'map',label:'Cidade',children:inp('city','Cidade',80)}),
            i.jsx(Field,{icon:'users',label:'Parte contrária',stack:!0,children:i.jsxs(i.Fragment,{children:[inp('opposingParty','Empresa ou pessoa do outro lado',120),
              f.opposingParty.trim()?i.jsx('p',{className:'wl-warn',role:'note',children:'Verificar conflito de interesses antes de aceitar o caso.'}):null]})}),
            i.jsx(Field,{icon:'check',label:'Já tem advogado',children:i.jsxs('select',{className:'wl-select',value:f.hasLawyer,'aria-label':'Já tem advogado neste caso',onChange:e=>set({hasLawyer:e.target.value}),children:[i.jsx('option',{value:'',children:'Não informado'}),i.jsx('option',{value:'sim',children:'Sim'}),i.jsx('option',{value:'nao',children:'Não'})]})}),
            i.jsx(Field,{icon:'doc',label:'Documentos',children:lead.documentsMentioned&&lead.documentsMentioned.length?i.jsx('span',{className:'wl-chips',children:lead.documentsMentioned.map(d=>i.jsx('span',{className:'wl-chip wl-chip--plain',children:d},d))}):i.jsx('span',{className:'wl-dim',children:'Nenhum citado'})}),
            i.jsx(Field,{icon:'doc',label:'Arquivos enviados',children:i.jsx('span',{children:nf.format(lead.mediaCount||0)+' na conversa'})}),
            i.jsx(Field,{icon:'ext',label:'Origem',children:i.jsx('span',{className:lead.source?void 0:'wl-dim',children:lead.source||'Não informada'})}),
            i.jsx(Field,{icon:'clock',label:'Primeira mensagem',children:i.jsx('span',{children:when(lead.firstMessageAt)})}),
            i.jsx(Field,{icon:'clock',label:'Última mensagem',children:i.jsx('span',{children:when(lead.lastMessageAt)})})]}),
          i.jsx('p',{className:'wl-hint',style:{padding:'8px'},children:(lead.statusSource==='manual'?'Status definido pela equipe. ':'')+'Uso interno da equipe: nada desta ficha é enviado ao cliente. Os campos que você editar não são mais alterados pela IA.'})]}),
        i.jsxs('footer',{className:'wl-foot',children:[err?i.jsx('p',{className:'wl-error',role:'alert',style:{flex:'1 1 auto'},children:err}):null,
          i.jsx('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',disabled:!changed.length||busy,onClick:()=>setF(base),children:'Descartar'}),
          i.jsx('button',{type:'button',className:'wa-tw-sbtn',disabled:!changed.length||busy,'aria-busy':busy?'true':void 0,onClick:save,children:busy?'Salvando…':'Salvar alterações'})]})]})]});
  }

  /* ---------------------------------------------------------------- settings drawer */
  function Settings({name,onClose,onSaved}){
    const[f,setF]=y.useState(null),[err,setErr]=y.useState(''),[busy,setBusy]=y.useState(!1),closeRef=y.useRef(null);
    y.useEffect(()=>{let live=!0;Ee.get('/leads/settings/'+encodeURIComponent(name)).then(r=>{const s=r.data&&r.data.settings||{};live&&setF({enabled:s.enabled!==!1,areas:(s.areas||[]).join('\n'),model:s.extractionModel||'',notify:!!(s.notify&&s.notify.enabled),numbers:(s.notify&&s.notify.numbers||[]).join('\n'),on:s.notify&&s.notify.on||'ambos'})},e=>live&&setErr(errText(e)));return()=>{live=!1}},[name]);
    y.useEffect(()=>{closeRef.current&&closeRef.current.focus();const k=e=>{if(e.key==='Escape'){e.preventDefault();onClose()}};window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[onClose]);
    const set=p=>{setF(o=>({...o,...p}));setErr('')};
    const save=async()=>{setBusy(!0);setErr('');const lines=t=>String(t).split('\n').map(x=>x.trim()).filter(Boolean);
      try{const r=await Ee.post('/leads/settings/'+encodeURIComponent(name),{enabled:f.enabled,areas:lines(f.areas),extractionModel:f.model.trim()||null,notify:{enabled:f.notify,numbers:lines(f.numbers),on:f.on}});me.success('Configurações de leads salvas.');onSaved(r.data&&r.data.settings);onClose()}
      catch(e){setErr(errText(e))}finally{setBusy(!1)}};
    return i.jsxs(i.Fragment,{children:[i.jsx('div',{className:'wl-backdrop','aria-hidden':'true',onClick:onClose}),
      i.jsxs('aside',{className:'wl-panel wl-drawer',role:'dialog','aria-modal':'true','aria-labelledby':'wl-set-title',children:[
        i.jsxs('header',{className:'wa-tw-panel-head',children:[i.jsx('h2',{id:'wl-set-title',className:'wa-tw-panel-kicker',children:'Configurações de leads'}),
          i.jsx('button',{ref:closeRef,type:'button',className:'wa-tw-ibtn','aria-label':'Fechar configurações',onClick:onClose,children:svg('x',16)})]}),
        !f?i.jsx('div',{className:'wl-panel-body',children:err?i.jsx('p',{className:'wl-error',role:'alert',style:{padding:'16px 8px'},children:err}):i.jsx('p',{className:'wl-hint',style:{padding:'16px 8px'},children:'Carregando…'})}):
        i.jsxs('div',{className:'wl-panel-body',children:[
          i.jsxs('section',{className:'wl-sec',children:[i.jsx('h3',{className:'wl-sec-title',children:'Triagem automática'}),
            i.jsxs('label',{className:'wl-check',children:[i.jsx('input',{type:'checkbox',checked:f.enabled,onChange:e=>set({enabled:e.target.checked})}),i.jsx('span',{children:'Analisar as conversas depois das respostas da IA (a partir da 3ª mensagem do cliente). Usa a chave OpenAI desta instância e não conta como resposta do plano.'})]})]}),
          i.jsxs('section',{className:'wl-sec',children:[i.jsx('h3',{className:'wl-sec-title',children:'Áreas do escritório'}),
            i.jsx('textarea',{className:'wl-textarea',rows:7,value:f.areas,'aria-label':'Áreas (uma por linha)',onChange:e=>set({areas:e.target.value})}),
            i.jsx('p',{className:'wl-hint',children:'Uma por linha. Assuntos fora da lista ficam como "Outro" e com prioridade baixa.'})]}),
          i.jsxs('section',{className:'wl-sec',children:[i.jsx('h3',{className:'wl-sec-title',children:'Modelo'}),
            i.jsx('input',{className:'wl-input',value:f.model,placeholder:'O mesmo modelo do bot',maxLength:100,'aria-label':'Modelo da OpenAI',onChange:e=>set({model:e.target.value})})]}),
          i.jsxs('section',{className:'wl-sec',children:[i.jsx('h3',{className:'wl-sec-title',children:'Aviso para a equipe'}),
            i.jsxs('label',{className:'wl-check',children:[i.jsx('input',{type:'checkbox',checked:f.notify,onChange:e=>set({notify:e.target.checked})}),i.jsx('span',{children:'Enviar uma mensagem de WhatsApp, desta instância, para os números da equipe (uma vez por lead). O cliente nunca recebe nada.'})]}),
            i.jsx('textarea',{className:'wl-textarea',rows:3,value:f.numbers,placeholder:'5521999998888',disabled:!f.notify,'aria-label':'Números da equipe (um por linha)',onChange:e=>set({numbers:e.target.value})}),
            i.jsxs('fieldset',{className:'wl-fieldset',disabled:!f.notify,children:[i.jsx('legend',{className:'wl-hint',children:'Quando avisar'}),
              NOTIFY.map(([k,lb])=>i.jsxs('label',{className:'wl-check',children:[i.jsx('input',{type:'radio',name:'wl-notify-on',checked:f.on===k,onChange:()=>set({on:k})}),i.jsx('span',{children:lb})]},k))]})]}),
          err?i.jsx('p',{className:'wl-error',role:'alert',style:{padding:'0 8px'},children:err}):null]}),
        i.jsxs('footer',{className:'wl-foot',children:[i.jsx('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:onClose,children:'Cancelar'}),
          i.jsx('button',{type:'button',className:'wa-tw-sbtn',disabled:!f||busy,onClick:save,children:busy?'Salvando…':'Salvar'})]})]})]});
  }

  /* ---------------------------------------------------------------- page */
  function Page(){
    const{instance:g}=ct(),name=g?.name,loc=Pi(),nav=dn();
    const[v,setV]=y.useState(readView),[q,setQ]=y.useState(''),[dq,setDq]=y.useState(''),[page,setPage]=y.useState(1);
    const[st,setSt]=y.useState({data:null,error:'',loading:!0}),[open,setOpen]=y.useState(null),[areas,setAreas]=y.useState([]),[showSet,setShowSet]=y.useState(!1);
    const[bf,setBf]=y.useState(null),[confirm,setConfirm]=y.useState(null),[days,setDays]=y.useState(30),[busy,setBusy]=y.useState(!1);
    const set=p=>{setPage(1);setV(o=>{const n={...o,...p};ls_('wa-leads-view',JSON.stringify(n));return n})};
    y.useEffect(()=>{const t=setTimeout(()=>{setDq(q.trim());setPage(1)},300);return()=>clearTimeout(t)},[q]);
    const query=y.useMemo(()=>{const o={sort:v.sort,page,pageSize:25};if(v.seg!=='todos')o.status=v.seg;if(v.area)o.area=v.area;if(v.priority)o.priority=v.priority;const s=since(v.period);if(s)o.since=s;if(dq)o.search=dq;return o},[v,page,dq]);
    const load=y.useCallback(async()=>{if(!name)return;setSt(p=>({...p,loading:!0}));try{const r=await Ee.get('/leads/'+encodeURIComponent(name),{params:query});setSt({data:r.data,error:'',loading:!1})}catch(e){setSt({data:null,error:errText(e),loading:!1})}},[name,query]);
    y.useEffect(()=>{load()},[load]);
    y.useEffect(()=>{if(!name)return;Ee.get('/leads/settings/'+encodeURIComponent(name)).then(r=>setAreas(r.data&&r.data.settings&&r.data.settings.areas||[]),()=>{})},[name]);
    const want=new URLSearchParams(loc.search||'').get('lead');
    y.useEffect(()=>{if(!name||!want||open&&open.id===want)return;Ee.get('/leads/'+encodeURIComponent(name)+'/'+encodeURIComponent(want)).then(r=>r.data&&r.data.lead&&setOpen(r.data.lead),()=>me.error('Lead não encontrado.'))},[name,want]);
    const poll=y.useRef(null);
    y.useEffect(()=>()=>{poll.current&&clearTimeout(poll.current)},[]);
    const watch=y.useCallback(()=>{const tick=async()=>{try{const r=await Ee.get('/leads/backfill/'+encodeURIComponent(name));setBf(r.data);if(r.data&&r.data.running)poll.current=setTimeout(tick,3e3);else{load();if(r.data&&r.data.finishedAt)me.success('Análise concluída: '+nf.format(r.data.created)+' lead(s) novo(s), '+nf.format(r.data.updated)+' atualizado(s).')}}catch(e){setBf(null)}};tick()},[name,load]);
    y.useEffect(()=>{if(!name)return;Ee.get('/leads/backfill/'+encodeURIComponent(name)).then(r=>{if(r.data&&r.data.running){setBf(r.data);watch()}},()=>{})},[name]);
    if(!g)return null;
    const d=st.data,counts=d&&d.counts||{},list=d&&Array.isArray(d.leads)?d.leads:[];
    const closePanel=()=>{setOpen(null);if(want)nav(loc.pathname,{replace:!0})};
    const patchRow=l=>{if(!l)return;setSt(o=>o.data?{...o,data:{...o.data,leads:o.data.leads.map(x=>x.id===l.id?l:x)}}:o);setOpen(p=>p&&p.id===l.id?l:p);load()};
    const changeStatus=async(l,s)=>{try{const r=await Ee.patch('/leads/'+encodeURIComponent(name)+'/'+encodeURIComponent(l.id),{status:s});me.success('Status de '+title(l)+': '+lbl(STATUS,s)+'.');patchRow(r.data&&r.data.lead)}catch(e){me.error(errText(e))}};
    const exportCsv=async()=>{const o={...query};delete o.page;delete o.pageSize;try{await download(name,o);me.success('CSV exportado (abre no Excel).')}catch(e){me.error(errText(e))}};
    const estimate=async()=>{setBusy(!0);try{const r=await Ee.post('/leads/backfill/'+encodeURIComponent(name),{days,max:200,dryRun:!0});setConfirm(r.data)}catch(e){me.error(errText(e))}finally{setBusy(!1)}};
    const reestimate=async n=>{setDays(n);try{const r=await Ee.post('/leads/backfill/'+encodeURIComponent(name),{days:n,max:200,dryRun:!0});setConfirm(r.data)}catch(e){me.error(errText(e))}};
    const start=async()=>{setBusy(!0);try{const r=await Ee.post('/leads/backfill/'+encodeURIComponent(name),{days,max:200});setConfirm(null);setBf(r.data&&r.data.status);me.success('Analisando '+nf.format(r.data.candidates)+' conversa(s) em segundo plano.');watch()}catch(e){me.error(errText(e))}finally{setBusy(!1)}};
    const chips=[];
    if(v.area)chips.push(['area','Área: '+v.area,()=>set({area:''})]);
    if(v.priority)chips.push(['priority','Prioridade: '+lbl(PRIOS,v.priority).toLowerCase(),()=>set({priority:''})]);
    if(v.period!=='any')chips.push(['period','Última mensagem: '+lbl(PERIODS,v.period).toLowerCase(),()=>set({period:'any'})]);
    if(v.sort!=='priority')chips.push(['sort','Ordem: '+lbl(SORTS,v.sort).toLowerCase(),()=>set({sort:'priority'})]);
    const nFilters=(v.area?1:0)+(v.priority?1:0)+(v.period!=='any'?1:0);
    const clear=()=>set({area:'',priority:'',period:'any',sort:'priority'});
    const areaList=[...new Set([...areas,v.area].filter(Boolean))];
    let body;
    if(st.error&&!d)body=i.jsx(Empty,{icon:'users',title:'Não foi possível carregar os leads',text:st.error,action:'Tentar de novo',onAction:load});
    else if(!d)body=i.jsx('div',{className:'wa-tw-empty',role:'status',children:i.jsx('p',{className:'wa-tw-empty-text',children:'Carregando leads…'})});
    else if(!list.length){
      if(!counts.todos&&!dq&&!nFilters)body=i.jsx(Empty,{icon:'spark',title:'Nenhum lead ainda',text:'Os leads aparecem aqui depois que a IA conversa com um cliente (a partir da 3ª mensagem). Para organizar as conversas que já existem, use "Analisar conversas anteriores".',action:'Analisar conversas anteriores',onAction:estimate});
      else if(dq)body=i.jsx(Empty,{icon:'search',title:'Nada encontrado',text:'Nenhum lead corresponde a “'+dq+'”.'});
      else if(chips.length)body=i.jsx(Empty,{icon:'filter',title:'Nenhum lead com esses filtros',text:'Remova um filtro ou volte para todos.',action:'Limpar filtros',onAction:clear});
      else if(v.seg==='aguardando')body=i.jsx(Empty,{icon:'check',title:'Ninguém aguardando',text:'Todos os leads qualificados ou de prioridade alta já tiveram resposta da equipe.'});
      else body=i.jsx(Empty,{icon:'users',title:'Nenhum lead nesta visão',text:'Escolha outra visão acima.'});
    }else body=i.jsxs(i.Fragment,{children:[i.jsx('div',{className:'wl-table-wrap',children:i.jsxs('table',{className:'wl-table',children:[
      i.jsx('thead',{children:i.jsx('tr',{children:['Nome','Telefone','Área','Cidade','Prioridade','Status','Aguardando','Última mensagem'].map(h=>i.jsx('th',{scope:'col',children:h},h))})}),
      i.jsx('tbody',{children:list.map(l=>i.jsxs('tr',{className:'wl-row',tabIndex:0,'aria-selected':open&&open.id===l.id?'true':'false',onClick:()=>setOpen(l),onKeyDown:e=>{if(e.key==='Enter'&&e.target===e.currentTarget){e.preventDefault();setOpen(l)}},children:[
        i.jsx('td',{children:i.jsxs('span',{className:'wl-name',children:[i.jsx('strong',{children:title(l)}),l.name&&l.pushName&&l.pushName!==l.name?i.jsx('span',{children:l.pushName}):l.summary?i.jsx('span',{children:l.summary}):null]})}),
        i.jsx('td',{className:'wl-mono',children:mask(l.phone)}),
        i.jsx('td',{children:l.area?i.jsx('span',{className:'wl-trunc',title:l.area,children:l.area}):i.jsx('span',{className:'wl-dim',children:'—'})}),
        i.jsx('td',{children:l.city?i.jsx('span',{className:'wl-trunc',title:l.city,children:l.city}):i.jsx('span',{className:'wl-dim',children:'—'})}),
        i.jsx('td',{children:i.jsx(Prio,{lead:l})}),
        i.jsx('td',{onClick:e=>e.stopPropagation(),children:i.jsx('select',{className:'wl-select-inline',value:l.status,'aria-label':'Status de '+title(l),onKeyDown:e=>e.stopPropagation(),onChange:e=>changeStatus(l,e.target.value),children:STATUS.map(([k,lb])=>i.jsx('option',{value:k,children:lb},k))})}),
        i.jsx('td',{children:l.awaitingHumanSince?i.jsx(Wait,{at:l.awaitingHumanSince}):i.jsx('span',{className:'wl-dim',children:'—'})}),
        i.jsx('td',{children:when(l.lastMessageAt)})]},l.id))})]})}),
      d.pages>1?i.jsxs('div',{className:'wl-pager',children:[i.jsx('span',{children:'Página '+d.page+' de '+d.pages}),
        i.jsx('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',disabled:page<=1,onClick:()=>setPage(p=>p-1),children:'Anterior'}),
        i.jsx('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',disabled:page>=d.pages,onClick:()=>setPage(p=>p+1),children:'Próxima'})]}):null]});
    return i.jsxs('main',{className:'wl-page',children:[
      i.jsxs('header',{className:'wl-head',children:[i.jsxs('div',{className:'wl-head-text',children:[i.jsx('h1',{className:'wl-title',children:'Leads'}),
          i.jsx('p',{className:'wl-muted',children:'Triagem das conversas para organizar os atendimentos. A IA preenche só o que o cliente disse; nada daqui é enviado ao cliente.'})]}),
        i.jsxs('div',{className:'wl-head-actions',children:[bf&&bf.running?i.jsx('span',{className:'wl-progress',role:'status',children:'Analisando '+nf.format(bf.done)+' de '+nf.format(bf.total)+'…'}):null,
          i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:estimate,disabled:busy||!!(bf&&bf.running),children:[svg('spark',14),'Analisar conversas anteriores']}),
          i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:exportCsv,disabled:!counts.todos,children:[svg('down',14),'Exportar CSV']}),
          i.jsx('button',{type:'button',className:'wa-tw-ibtn','aria-label':'Configurações de leads',title:'Configurações de leads',onClick:()=>setShowSet(!0),children:svg('cog',16)})]})]}),
      i.jsx('div',{className:'wa-tw-segs',role:'group','aria-label':'Visão dos leads',children:VIEWS.map(([k,lb])=>i.jsxs('button',{type:'button',className:'wa-tw-seg','aria-pressed':v.seg===k?'true':'false',onClick:()=>set({seg:k}),children:[
        i.jsx('span',{children:lb}),counts[k]?i.jsx('span',{className:'wa-tw-seg-n',children:counts[k]>999?'999+':counts[k]}):null]},k))}),
      i.jsxs('div',{className:'wl-bar',children:[
        i.jsxs('div',{className:'wl-bar-left',children:[i.jsx('p',{className:'wl-count','aria-live':'polite',children:d?nf.format(d.total)+(d.total===1?' lead':' leads'):st.loading?'Carregando…':''}),
          i.jsxs('label',{className:'wl-search',children:[svg('search',14),i.jsx('input',{type:'search',value:q,placeholder:'Buscar nome, cidade, número…','aria-label':'Buscar leads',onChange:e=>setQ(e.target.value)})]})]}),
        i.jsxs('div',{className:'wl-bar-right',children:[
          i.jsx(Pop,{id:'wl-filter',label:'Filtro',icon:'filter',count:nFilters,children:close=>i.jsxs('div',{className:'wa-tw-pop-body',children:[
            i.jsxs('fieldset',{className:'wa-tw-pop-sec',children:[i.jsx('legend',{className:'wa-tw-pop-label',children:'Área'}),
              i.jsxs('select',{className:'wl-select',value:v.area,'aria-label':'Área',onChange:e=>set({area:e.target.value}),children:[i.jsx('option',{value:'',children:'Todas as áreas'}),areaList.map(a=>i.jsx('option',{value:a,children:a},a))]})]}),
            i.jsxs('fieldset',{className:'wa-tw-pop-sec',children:[i.jsx('legend',{className:'wa-tw-pop-label',children:'Prioridade'}),
              [['','Todas'],...PRIOS].map(([k,lb])=>i.jsx(Opt,{type:'radio',name:'wl-prio',checked:v.priority===k,onChange:()=>set({priority:k}),label:lb},k||'all'))]}),
            i.jsxs('fieldset',{className:'wa-tw-pop-sec',children:[i.jsx('legend',{className:'wa-tw-pop-label',children:'Última mensagem'}),
              PERIODS.map(([k,lb])=>i.jsx(Opt,{type:'radio',name:'wl-period',checked:v.period===k,onChange:()=>set({period:k}),label:lb},k))]}),
            i.jsxs('div',{className:'wa-tw-pop-foot',children:[i.jsx('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',disabled:!nFilters,onClick:()=>set({area:'',priority:'',period:'any'}),children:'Limpar'}),i.jsx('button',{type:'button',className:'wa-tw-sbtn',onClick:close,children:'Pronto'})]})]})}),
          i.jsx(Pop,{id:'wl-sort',label:'Ordenar',icon:'sort',align:'end',children:close=>i.jsx('div',{className:'wa-tw-pop-body',children:i.jsxs('fieldset',{className:'wa-tw-pop-sec',children:[i.jsx('legend',{className:'wa-tw-pop-label',children:'Ordenar por'}),
            SORTS.map(([k,lb])=>i.jsx(Opt,{type:'radio',name:'wl-sort',checked:v.sort===k,onChange:()=>{set({sort:k});close()},label:lb},k))]})})})]})]}),
      chips.length?i.jsxs('div',{className:'wa-tw-chips',role:'list','aria-label':'Filtros ativos',children:[chips.map(([k,t,rm])=>i.jsxs('span',{className:'wa-tw-chip',role:'listitem',children:[i.jsx('span',{children:t}),i.jsx('button',{type:'button',className:'wa-tw-chip-x','aria-label':'Remover '+t,onClick:rm,children:svg('x',12)})]},k)),
        chips.length>1?i.jsx('button',{type:'button',className:'wa-tw-chip-clear',onClick:clear,children:'Limpar tudo'}):null]}):null,
      body,
      open?i.jsx(Panel,{lead:open,instance:g,areas,onClose:closePanel,onSaved:patchRow},open.id):null,
      showSet?i.jsx(Settings,{name,onClose:()=>setShowSet(!1),onSaved:s=>{s&&setAreas(s.areas||[]);load()}}):null,
      confirm?i.jsx(Pt,{open:!0,onOpenChange:o=>{if(!o&&!busy)setConfirm(null)},children:i.jsxs(Nt,{className:'wa-confirm',children:[
        i.jsxs(Mt,{children:[i.jsx(zt,{children:'Analisar conversas anteriores?'}),
          i.jsx(eo,{children:confirm.candidates?'Encontramos '+nf.format(confirm.candidates)+' conversa(s) dos últimos '+confirm.days+' dias com pelo menos 3 mensagens do cliente e ainda sem análise. Cada uma faz uma chamada à OpenAI com a chave desta instância (modelo '+confirm.model+'), duas por vez, e não conta como resposta do plano. Nenhuma mensagem é enviada.':'Nenhuma conversa dos últimos '+confirm.days+' dias precisa de análise.'})]}),
        i.jsxs('label',{className:'wl-check',children:[i.jsx('span',{children:'Período'}),i.jsx('select',{className:'wl-select-inline',value:days,onChange:e=>reestimate(Number(e.target.value)),children:[7,30,60].map(n=>i.jsx('option',{value:n,children:'Últimos '+n+' dias'},n))})]}),
        i.jsxs(Yt,{className:'wa-confirm-foot',children:[i.jsx(se,{variant:'outline',onClick:()=>setConfirm(null),disabled:busy,children:'Cancelar'}),
          i.jsx(se,{onClick:start,disabled:busy||!confirm.candidates,children:busy?'Iniciando…':'Analisar '+nf.format(confirm.candidates||0)})]})]})}):null]});
  }

  /* ---------------------------------------------------------------- Conversas contact panel: Lead row */
  const CF=new Map();
  function ContactField({instance,jid}){
    const name=instance&&instance.name,key=name+'|'+jid,[lead,setLead]=y.useState(()=>{const c=CF.get(key);return c&&Date.now()-c.at<6e4?c.lead:void 0});
    y.useEffect(()=>{if(!name||!jid)return;const c=CF.get(key);if(c&&Date.now()-c.at<6e4){setLead(c.lead);return}let live=!0;
      Ee.get('/leads/'+encodeURIComponent(name),{params:{remoteJid:jid,pageSize:1}}).then(r=>{const l=r.data&&r.data.leads&&r.data.leads[0]||null;CF.set(key,{at:Date.now(),lead:l});live&&setLead(l)},()=>live&&setLead(null));return()=>{live=!1}},[key]);
    return i.jsxs('div',{className:'wa-tw-field',children:[i.jsxs('dt',{children:[svg('users',14),i.jsx('span',{children:'Lead'})]}),
      i.jsx('dd',{children:lead===void 0?i.jsx('span',{className:'wa-tw-muted',children:'…'}):lead?i.jsxs(Fu,{to:'/manager/instance/'+instance.id+'/leads?lead='+encodeURIComponent(lead.id),className:'wl-chips','aria-label':'Abrir o lead: '+lbl(STATUS,lead.status)+(lead.area?', '+lead.area:''),children:[i.jsx(StatusChip,{s:lead.status}),lead.area?i.jsx('span',{className:'wl-chip wl-chip--plain',children:lead.area}):null]}):i.jsx('span',{className:'wa-tw-muted',children:'Sem lead ainda'})})]});
  }
  return{Page,Icon,ContactField};
})();
'''

COMPONENT_ANCHOR = '  return{View,Shell,HeadExtra,Crumbs,Cmd,CmdButton};\n})();\n\n'
ROUTE_OLD = ('{path:"/manager/instance/:instanceId/usage",element:i.jsx(tn,{children:i.jsx(un,{children:'
             'i.jsx(WaUsage.Page,{})})})},')
ROUTE_NEW = ROUTE_OLD + ('{path:"/manager/instance/:instanceId/leads",element:i.jsx(tn,{children:i.jsx(un,{children:'
                         'i.jsx(WaLeads.Page,{})})})},')
SIDEBAR_OLD = '{id:"usage",title:"Plano e limites",icon:WaUsage.Icon,path:"usage"},'
PAGES_OLD = "['chat','Conversas','chat'],['usage','Plano e limites','gauge']"
CONTACT_OLD = "i.jsx(Field,{icon:'spark',label:'IA neste contato',stack:!0,children:ai}),"


def patch_component(s):
    return rep(s, COMPONENT_ANCHOR, COMPONENT_ANCHOR + COMPONENT + '\n', 'route table (after WaTw)')


def patch_route(s):
    return rep(s, ROUTE_OLD, ROUTE_NEW, 'usage route (run usage-limits.py first)')


def patch_sidebar(s):
    return rep(s, SIDEBAR_OLD, '{id:"leads",title:"Leads",icon:WaLeads.Icon,path:"leads"},' + SIDEBAR_OLD,
               'sidebar Plano e limites item')


def patch_pages(s):
    return rep(s, PAGES_OLD, "['chat','Conversas','chat'],['leads','Leads','users'],['usage','Plano e limites','gauge']",
               'breadcrumb/command pages (run twenty-layout.py first)')


def patch_contact(s):
    return rep(s, CONTACT_OLD, CONTACT_OLD + 'group?null:i.jsx(WaLeads.ContactField,{instance,jid}),',
               'contact side panel (run twenty-layout.py first)')


GROUPS = [('component', patch_component), ('route', patch_route), ('sidebar', patch_sidebar),
          ('pages', patch_pages), ('contact', patch_contact)]


def patch_html(html):
    pos = html.find(CSS_ANCHOR)
    if pos < 0 or html.count(CSS_ANCHOR) != 1:
        raise PatchError('index.html: twenty-layout.css link not found exactly once (run twenty-layout.py first)')
    end = html.index('\n', pos) + 1
    return html[:end] + '    ' + html_marker('html') + '\n    <link rel="stylesheet" href="/assets/leads.css?v=1" />\n' + html[end:]


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
        missing.append('leads.css')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/leads.css is missing')
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
        report.append(f'index.html written (leads.css ?v=1, bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
