#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: ficha do lead em página (proposta A).

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/ficha-lead.css (a plain file, edited by hand, only var(--m-*) tokens of
minimal.css/theme.css, linked after acabamento-listas.css).

What it does:
  page  - inserts WaLeads.LeadPage, a record page for one lead with four tabs: Atividade (one timeline with the
          first/last client message, team reply, waiting, AI extraction and triage plus linked appointments and
          processes), Conversa (last 50 messages from POST /chat/findMessages), Agenda (GET /agenda?contact=<jid>&
          to=2999-12-31, filtered by the contact) and Processos (GET /processos filtered client-side by remoteJid).
          The side column shows contact, area/city/source/priority/status, the AI state derived from the message
          timestamps, what is missing, the next step, cited documents, attention points and the opposing party.
          "Virar cliente" opens a short confirmation dialog and reuses the existing PATCH /leads (status=cliente).
          It only reads existing endpoints; there is no notes tab because the API has no notes for a lead.
  links - the name in the Leads table becomes a link to the page (the row still opens the drawer), the drawer gets
          "Ver ficha completa", and "Editar ficha" on the page goes back to /leads?lead=<id>, where the existing
          drawer edits the fields. CACHE_VERSION is raised to 58.
  route - the route /manager/instance/:instanceId/leads/:leadId, inside the same guard and instance shell.
  html  - links ficha-lead.css?v=1 after acabamento-listas.css and raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything. Re-running is safe:
groups whose marker and code are present are skipped. Order: run after acabamento-listas.py (it exports StatusMenu
and links acabamento-listas.css).

Usage (from the repository root):
  python3 -I manager/patches/ficha-lead.py           # apply
  python3 -I manager/patches/ficha-lead.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'ficha-lead.css')
CACHE_VERSION = '58'
CSS_VERSION = '1'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
ACABAMENTO_LINK = '    <link rel="stylesheet" href="/assets/acabamento-listas.css?v=1" />'
FICHA_LINK = '    <link rel="stylesheet" href="/assets/ficha-lead.css?v=' + CSS_VERSION + '" />'
CSS_MARK = '/*whatsai-patch:ficha-lead:css*/'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:ficha-lead:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:ficha-lead:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# Minified names (bundle index-b29a5d7a.js): i = jsx runtime, y = React, Ee = axios instance of the API,
# me = toast, Fu = react-router Link, dn = useNavigate, Pi = useLocation, ct = useInstance, nf = Intl.NumberFormat,
# WaLeads = the leads module of leads.py, svg/When/StatusMenu/STATUS/PRIOS/lbl/fullPhone/title/mask are its helpers.

EXPORT_OLD = '  return{Page,Icon,ContactField,StatusMenu,When,rel,exact,title,fullPhone,mask,STATUS,lbl};'
EXPORT_NEW = '  return{Page,Icon,ContactField,StatusMenu,When,rel,exact,title,fullPhone,mask,STATUS,lbl,LeadPage};'

LEAD_PAGE = r'''  function LeadPage(){
    const{instance:g}=ct(),loc=Pi(),nav=dn(),name=g&&g.name;
    const leadId=loc.pathname.split('/').filter(Boolean).pop();
    const[st,setSt]=y.useState({lead:null,error:'',loading:!0});
    const[tab,setTab]=y.useState(()=>{const t=new URLSearchParams(loc.search||'').get('tab');return t==='conversa'||t==='agenda'||t==='processos'?t:'atividade'});
    const[extra,setExtra]=y.useState({msgs:null,agenda:null,procs:null,done:!1});
    const[busy,setBusy]=y.useState(!1),[clientDlg,setClientDlg]=y.useState(!1),[tick,setTick]=y.useState(0),tabRefs=y.useRef([]);
    y.useEffect(()=>{
      if(!name||!leadId){setSt({lead:null,error:'Lead não encontrado.',loading:!1});return}
      let live=!0;setSt({lead:null,error:'',loading:!0});
      Ee.get('/leads/'+encodeURIComponent(name)+'/'+encodeURIComponent(leadId)).then(r=>{
        if(!live)return;const l=r.data&&r.data.lead;
        if(!l){setSt({lead:null,error:'Lead não encontrado.',loading:!1});return}
        setSt({lead:l,error:'',loading:!1});
      },e=>{
        if(!live)return;
        setSt({lead:null,error:e&&e.response&&e.response.status===404?'Lead não encontrado.':errText(e),loading:!1});
      });
      return()=>{live=!1};
    },[name,leadId]);
    y.useEffect(()=>{
      if(!name||!st.lead)return;
      const jid=st.lead.remoteJid;
      if(!jid){setExtra({msgs:[],agenda:[],procs:[],done:!0});return}
      let live=!0;setExtra(o=>({...o,done:!1}));
      const msgs=Ee.post('/chat/findMessages/'+encodeURIComponent(name),{where:{key:{remoteJid:jid}},offset:50}).then(r=>{
        const m=r.data&&r.data.messages;
        return m&&Array.isArray(m.records)?m.records:[];
      },()=>null);
      const agenda=Ee.get('/agenda/'+encodeURIComponent(name),{params:{contact:jid,to:'2999-12-31'}}).then(r=>r.data&&Array.isArray(r.data.appointments)?r.data.appointments:[],()=>null);
      const procs=Ee.get('/processos/'+encodeURIComponent(name)).then(r=>r.data&&Array.isArray(r.data.items)?r.data.items.filter(p=>p&&p.remoteJid===jid):[],()=>null);
      Promise.all([msgs,agenda,procs]).then(([m,a,p])=>{if(live)setExtra({msgs:m,agenda:a,procs:p,done:!0})});
      return()=>{live=!1};
    },[name,st.lead&&st.lead.id,tick]);
    if(!g)return null;
    if(st.loading)return i.jsx('main',{className:'wa-fl-page',children:i.jsxs('div',{className:'wa-fl-loading',role:'status','aria-busy':'true',children:[i.jsx('span',{className:'wa-sk'}),i.jsx('span',{className:'wa-sk'}),i.jsx('span',{className:'wa-sk'})]})});
    if(!st.lead)return i.jsx('main',{className:'wa-fl-page',children:i.jsx(Empty,{icon:'users',title:'Não foi possível abrir a ficha',text:st.error||'Lead não encontrado.',action:'Voltar para leads',onAction:()=>nav('/manager/instance/'+g.id+'/leads')})});
    const lead=st.lead;
    const ms=v=>{if(v==null)return 0;if(typeof v==='number')return v<1e12?v*1e3:v;if(typeof v==='object'&&v.low!==void 0)return Number(v.low)*1e3;const t=new Date(v).getTime();return Number.isFinite(t)?t:0};
    const arr=v=>Array.isArray(v)?v.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()):typeof v==='string'&&v.trim()?[v.trim()]:[];
    const txt=m=>{
      const b=m&&m.message;
      if(b==null)return'Mensagem';
      if(typeof b==='string')return b;
      const t=b.conversation||b.extendedTextMessage&&b.extendedTextMessage.text||b.imageMessage&&(b.imageMessage.caption||'Foto')||b.videoMessage&&(b.videoMessage.caption||'Vídeo')||b.audioMessage&&'Áudio'||b.documentMessage&&(b.documentMessage.fileName?'Documento: '+b.documentMessage.fileName:'Documento')||b.stickerMessage&&'Figurinha'||b.locationMessage&&'Localização'||b.contactMessage&&'Contato'||b.contactsArrayMessage&&'Contatos'||b.buttonsMessage&&'Mensagem com botões';
      return typeof t==='string'&&t.trim()?t:'Mensagem';
    };
    const SRC={ai:'Feito pela IA',manual:'Feito pela equipe',mcp:'Feito pelo MCP'};
    const stampAt=v=>v>Date.now()?i.jsx('span',{children:when(v)}):i.jsx(When,{at:v});
    const APPT={pendente:['warn','Pendente'],agendado:['neutral','Agendado'],confirmado:['ok','Confirmado'],cancelado:['bad','Cancelado'],realizado:['ok','Realizado'],faltou:['bad','Faltou']};
    const PROC={em_dia:['ok','Em dia'],novidade:['warn','Nova movimentação'],erro:['bad','Erro'],aguardando:['neutral','Aguardando consulta']};
    const apptMeta=s=>APPT[s]||['neutral',s||'Agendamento'],procMeta=s=>PROC[s]||['neutral',s||'—'];
    const msgs=Array.isArray(extra.msgs)?extra.msgs:[];
    const msgsAsc=msgs.slice().sort((a,b)=>ms(a.messageTimestamp)-ms(b.messageTimestamp));
    const firstClient=msgsAsc.find(m=>!(m.key&&m.key.fromMe)),lastClient=msgsAsc.slice().reverse().find(m=>!(m.key&&m.key.fromMe));
    const appts=Array.isArray(extra.agenda)?extra.agenda.slice().sort((a,b)=>ms(b.startsAt)-ms(a.startsAt)):[];
    const procs=Array.isArray(extra.procs)?extra.procs.slice().sort((a,b)=>ms(b.lastMovement&&b.lastMovement.occurredAt||b.updatedAt||b.createdAt)-ms(a.lastMovement&&a.lastMovement.occurredAt||a.updatedAt||a.createdAt)):[];
    const missing=arr(lead.missingInfo),docs=arr(lead.documentsMentioned),attention=arr(lead.attentionPoints);
    const ia=lead.awaitingHumanSince?{tone:'warn',title:'Aguardando a equipe',text:'A triagem terminou; falta uma resposta da equipe.'}:lead.lastHumanReplyAt&&(!lead.lastClientMessageAt||ms(lead.lastHumanReplyAt)>=ms(lead.lastClientMessageAt))?{tone:'warn',title:'Equipe assumiu',text:'A IA pausa quando alguém da equipe responde.'}:lead.lastClientMessageAt||lead.statusSource==='ai'?{tone:'ok',title:'IA ativa',text:'A triagem por IA está acompanhando a conversa.'}:{tone:'neutral',title:'Sem conversa ainda',text:'A IA começa a triagem quando o cliente escrever.'};
    const tl=[];
    if(lead.firstMessageAt)tl.push({at:ms(lead.firstMessageAt),kind:'in',icon:'chat',title:'Primeira mensagem do cliente',text:firstClient?txt(firstClient):lead.summary||'Início da conversa.'});
    if(lead.lastClientMessageAt&&ms(lead.lastClientMessageAt)!==ms(lead.firstMessageAt))tl.push({at:ms(lead.lastClientMessageAt),kind:'in',icon:'chat',title:'Última mensagem do cliente',text:lastClient?txt(lastClient):lead.summary||''});
    if(lead.lastHumanReplyAt)tl.push({at:ms(lead.lastHumanReplyAt),kind:'out',icon:'chat',title:'Equipe respondeu',text:'A equipe assumiu a conversa.'});
    if(lead.awaitingHumanSince)tl.push({at:ms(lead.awaitingHumanSince),kind:'wait',icon:'clock',title:'Aguardando a equipe',text:lead.priorityReason||'A triagem terminou; a conversa espera uma resposta da equipe.'});
    if(lead.lastExtractedAt)tl.push({at:ms(lead.lastExtractedAt),kind:'ai',icon:'spark',title:'Ficha atualizada pela IA',text:Number(lead.extractedFromCount)===1?'A IA releu 1 mensagem e atualizou a ficha.':Number(lead.extractedFromCount)>1?'A IA releu '+nf.format(Number(lead.extractedFromCount))+' mensagens e atualizou a ficha.':'A IA atualizou a ficha a partir da conversa.'});
    if(lead.createdAt&&(lead.area||lead.priority))tl.push({at:ms(lead.createdAt),kind:'ai',icon:'spark',title:'Triagem do atendimento',text:[lead.area?'Área '+lead.area:null,lead.priority?'prioridade '+lbl(PRIOS,lead.priority):null].filter(Boolean).join(' · ')+'.'});
    appts.forEach(a=>tl.push({at:ms(a.startsAt),kind:'agenda',icon:'clock',title:'Agendamento '+apptMeta(a.status)[1].toLowerCase(),text:(a.typeName||'Consulta')+' · '+when(a.startsAt)}));
    procs.forEach(p=>tl.push({at:ms(p.lastMovement&&p.lastMovement.occurredAt)||ms(p.updatedAt)||ms(p.createdAt),kind:'proc',icon:'doc',title:'Processo '+(p.numeroCnj||'sem número'),text:p.lastMovement&&p.lastMovement.name||p.classe||'Processo vinculado ao contato.'}));
    tl.sort((a,b)=>b.at-a.at);
    const timeline=tl.filter(e=>e.at>0).slice(0,20);
    const TABS=[['atividade','Atividade','clock',timeline.length],['conversa','Conversa','chat',msgsAsc.length],['agenda','Agenda','clock',appts.length],['processos','Processos','doc',procs.length]];
    const pickTab=k=>{setTab(k);try{window.history.replaceState(null,'',loc.pathname+'?tab='+k)}catch(e){}};
    const onTabKey=e=>{
      const at=TABS.findIndex(t=>t[0]===tab);let n=at;
      if(e.key==='ArrowRight')n=(at+1)%TABS.length;
      else if(e.key==='ArrowLeft')n=(at-1+TABS.length)%TABS.length;
      else if(e.key==='Home')n=0;
      else if(e.key==='End')n=TABS.length-1;
      else return;
      e.preventDefault();pickTab(TABS[n][0]);
      const b=tabRefs.current[n];b&&b.focus();
    };
    const retry=()=>{setExtra({msgs:null,agenda:null,procs:null,done:!1});setTick(n=>n+1)};
    const changeStatus=async s=>{
      if(!name||!st.lead||busy||s===st.lead.status)return;
      setBusy(!0);
      try{const r=await Ee.patch('/leads/'+encodeURIComponent(name)+'/'+encodeURIComponent(st.lead.id),{status:s});
        const l=r.data&&r.data.lead;
        setSt(o=>o.lead?{...o,lead:l||{...o.lead,status:s}}:o);
        me.success('Status: '+lbl(STATUS,s)+'.');
      }catch(e){me.error(errText(e))}finally{setBusy(!1)}
    };
    const becomeClient=()=>{if(busy||!st.lead||st.lead.status==='cliente')return;setClientDlg(!1);changeStatus('cliente')};
    const loading=i.jsx('div',{className:'wa-fl-loading',role:'status',children:[i.jsx('span',{className:'wa-sk'}),i.jsx('span',{className:'wa-sk'})]});
    const failed=t=>i.jsxs('div',{className:'wa-fl-error',role:'alert',children:[i.jsx('p',{children:t+' não carregou agora.'}),i.jsx('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:retry,children:'Tentar de novo'})]});
    const activity=timeline.length?i.jsx('ol',{className:'wa-fl-tl',children:timeline.map((e,k)=>i.jsxs('li',{className:'wa-fl-tl-item','data-kind':e.kind,children:[
      i.jsx('span',{className:'wa-fl-tl-ic',children:svg(e.icon,15)}),
      i.jsxs('div',{className:'wa-fl-tl-body',children:[
        i.jsxs('p',{className:'wa-fl-tl-title',children:[e.title,stampAt(e.at)]}),
        e.text?i.jsx('p',{className:'wa-fl-tl-text',children:e.text}):null]})]},k))}):i.jsx(Empty,{icon:'clock',title:'Nada registrado ainda',text:'A atividade aparece aqui quando a IA ou a equipe interagir com o lead.'});
    const conversation=extra.msgs===null?(extra.done?failed('A conversa'):loading):msgsAsc.length?i.jsxs(i.Fragment,{children:[
      i.jsxs('div',{className:'wa-fl-toolbar',children:[
        i.jsx('p',{className:'wa-fl-toolbar-text',children:msgsAsc.length===1?'1 mensagem recente':nf.format(msgsAsc.length)+' mensagens recentes'}),
        lead.remoteJid?i.jsxs(Fu,{to:'/manager/instance/'+g.id+'/chat/'+encodeURIComponent(lead.remoteJid),className:'wa-tw-sbtn wa-tw-sbtn--ghost',children:[svg('chat',14),'Abrir conversa completa']}):null]}),
      i.jsx('ol',{className:'wa-fl-msgs',children:msgsAsc.map((m,k)=>i.jsxs('li',{className:'wa-fl-msg','data-me':m.key&&m.key.fromMe?'true':'false',children:[
        i.jsxs('div',{className:'wa-fl-msg-head',children:[i.jsx('strong',{children:m.key&&m.key.fromMe?'Equipe':m.pushName||lead.name||'Cliente'}),i.jsx(When,{at:ms(m.messageTimestamp)})]}),
        i.jsx('p',{className:'wa-fl-msg-text',children:txt(m)})]},m.key&&m.key.id||k))}),
      msgsAsc.length>=50?i.jsx('p',{className:'wa-fl-note',children:'Mostrando as 50 mensagens mais recentes.'}):null]}):i.jsx(Empty,{icon:'chat',title:'Nenhuma mensagem encontrada',text:'As mensagens aparecem aqui quando estão no banco da instância.',action:lead.remoteJid?'Abrir conversa':void 0,onAction:lead.remoteJid?()=>nav('/manager/instance/'+g.id+'/chat/'+encodeURIComponent(lead.remoteJid)):void 0});
    const agendaView=extra.agenda===null?(extra.done?failed('A agenda'):loading):appts.length?i.jsx('ul',{className:'wa-fl-list',children:appts.map(a=>{const mt=apptMeta(a.status);return i.jsxs('li',{className:'wa-fl-row',children:[
      i.jsxs('div',{className:'wa-fl-row-main',children:[
        i.jsx('p',{className:'wa-fl-row-title',children:a.typeName||'Consulta'}),
        i.jsxs('p',{className:'wa-fl-row-text',children:[when(a.startsAt),a.notes?' — '+a.notes:'']}),
        a.source?i.jsx('p',{className:'wa-fl-row-text',children:SRC[a.source]||a.source}):null]}),
      i.jsx('div',{className:'wa-fl-row-side',children:i.jsx('span',{className:'wa-fl-tag','data-tone':mt[0],children:mt[1]})})]},a.id)})}):i.jsx(Empty,{icon:'clock',title:'Nenhum agendamento',text:'Os agendamentos feitos pela IA ou pela equipe aparecem aqui.',action:'Abrir agenda',onAction:()=>nav('/manager/instance/'+g.id+'/agenda')});
    const processosView=extra.procs===null?(extra.done?failed('Os processos'):loading):procs.length?i.jsx('ul',{className:'wa-fl-list',children:procs.map(p=>{const mt=procMeta(p.status);return i.jsxs('li',{className:'wa-fl-row',children:[
      i.jsxs('div',{className:'wa-fl-row-main',children:[
        i.jsx('p',{className:'wa-fl-row-title wa-fl-row-mono',children:p.numeroCnj||'Processo sem número'}),
        i.jsx('p',{className:'wa-fl-row-text',children:[p.apelido||p.clientName,p.classe,p.tribunalAlias].filter(Boolean).join(' · ')||'Sem detalhes cadastrados'}),
        i.jsx('p',{className:'wa-fl-row-text',children:p.lastMovement?p.lastMovement.name+' · '+when(p.lastMovement.occurredAt):'Sem movimentação registrada.'})]}),
      i.jsxs('div',{className:'wa-fl-row-side',children:[
        i.jsx('span',{className:'wa-fl-tag','data-tone':mt[0],children:mt[1]}),
        p.unseen>0?i.jsx('span',{className:'wa-fl-tag','data-tone':'warn',children:p.unseen===1?'1 novidade':nf.format(p.unseen)+' novidades'}):null]})]},p.id)})}):i.jsx(Empty,{icon:'doc',title:'Nenhum processo vinculado',text:'Quando a IA identificar um processo na conversa, ele aparece aqui.',action:'Abrir Processos',onAction:()=>nav('/manager/instance/'+g.id+'/processos')});
    const panel=tab==='conversa'?conversation:tab==='agenda'?agendaView:tab==='processos'?processosView:activity;
    const side=i.jsxs(i.Fragment,{children:[
      i.jsxs('section',{className:'wa-fl-card',children:[
        i.jsx('h2',{className:'wa-fl-card-title',children:'Contato'}),
        i.jsx('p',{className:'wa-fl-contact',children:fullPhone(lead.phone)||'Número oculto pelo WhatsApp'}),
        lead.whatsappUrl?i.jsxs('a',{className:'wa-tw-sbtn wa-tw-sbtn--ghost wa-fl-wide',href:lead.whatsappUrl,target:'_blank',rel:'noopener noreferrer',children:[svg('ext',14),'Abrir no WhatsApp',i.jsx('span',{className:'sr-only',children:' (abre em nova aba)'})]}):null]}),
      i.jsxs('section',{className:'wa-fl-card',children:[
        i.jsx('h2',{className:'wa-fl-card-title',children:'Resumo'}),
        i.jsxs('dl',{className:'wa-fl-facts',children:[
          ['Área',lead.area||'Não informada'],
          ['Cidade',lead.city||'Não informada'],
          ['Origem',lead.source||'Não informada'],
          ['Prioridade',lbl(PRIOS,lead.priority)||'Não informada'],
          ['Status',lbl(STATUS,lead.status)||'—']
        ].map(([k,v])=>i.jsxs('div',{className:'wa-fl-fact',children:[i.jsx('dt',{children:k}),i.jsx('dd',{children:v})]},k))}),
        i.jsxs('div',{className:'wa-fl-ia','data-tone':ia.tone,children:[i.jsx('span',{className:'wa-fl-ia-dot','aria-hidden':'true'}),i.jsx('strong',{children:ia.title}),i.jsx('span',{children:ia.text})]})]}),
      i.jsxs('section',{className:'wa-fl-card',children:[
        i.jsx('h2',{className:'wa-fl-card-title',children:'Falta saber'}),
        missing.length?i.jsx('ul',{className:'wa-fl-tags',children:missing.map((m,k)=>i.jsx('li',{className:'wa-fl-tag','data-tone':'warn',children:m},k))}):i.jsx('p',{className:'wa-fl-muted',children:'Nada pendente na triagem.'}),
        docs.length?i.jsxs(i.Fragment,{children:[i.jsx('p',{className:'wa-fl-hint',children:'Documentos citados'}),i.jsx('ul',{className:'wa-fl-tags',children:docs.map((d,k)=>i.jsx('li',{className:'wa-fl-tag',children:d},k))})]}):null]}),
      i.jsxs('section',{className:'wa-fl-card',children:[
        i.jsx('h2',{className:'wa-fl-card-title',children:'Próximo passo'}),
        i.jsx('p',{className:'wa-fl-next',children:lead.nextStep||'Nenhum próximo passo definido.'}),
        lead.hasLawyer!==null&&lead.hasLawyer!==void 0?i.jsxs('p',{className:'wa-fl-hint',children:['Já tem advogado: ',lead.hasLawyer?'sim':'não']}):null]}),
      attention.length||lead.opposingParty?i.jsxs('section',{className:'wa-fl-card wa-fl-card-warn',children:[
        i.jsx('h2',{className:'wa-fl-card-title',children:'Atenção no atendimento'}),
        lead.opposingParty?i.jsxs('p',{className:'wa-fl-hint',children:['Parte contrária: ',lead.opposingParty,'. Verifique conflito de interesses antes de aceitar o caso.']}):null,
        attention.length?i.jsx('ul',{className:'wa-fl-points',children:attention.map((a,k)=>i.jsx('li',{children:a},k))}):null]}):null]});
    const head=i.jsxs('header',{className:'wa-fl-head',children:[
      i.jsxs('div',{className:'wa-fl-headtext',children:[
        i.jsxs('div',{className:'wa-fl-crumbs',children:[
          i.jsx(Fu,{to:'/manager/instance/'+g.id+'/leads',className:'wa-fl-back',children:'Leads'}),
          i.jsx('span',{className:'wa-fl-crumb-sep','aria-hidden':'true',children:'/'}),
          i.jsx('span',{className:'wa-fl-crumb-current',children:'Ficha do lead'})]}),
        i.jsx('h1',{className:'wa-fl-title',children:title(lead)}),
        i.jsxs('p',{className:'wa-fl-sub',children:[
          i.jsx('span',{children:fullPhone(lead.phone)||'Número oculto'}),
          lead.area?i.jsxs(i.Fragment,{children:[i.jsx('span',{className:'wa-fl-sep','aria-hidden':'true',children:'·'}),i.jsx('span',{children:lead.area})]}):null,
          lead.city?i.jsxs(i.Fragment,{children:[i.jsx('span',{className:'wa-fl-sep','aria-hidden':'true',children:'·'}),i.jsx('span',{children:lead.city})]}):null]})]}),
      i.jsxs('div',{className:'wa-fl-actions',children:[
        i.jsx(StatusMenu,{status:lead.status,label:title(lead),onChange:changeStatus}),
        i.jsxs(Fu,{to:'/manager/instance/'+g.id+'/leads?lead='+encodeURIComponent(lead.id),className:'wa-tw-sbtn wa-tw-sbtn--ghost',children:[svg('doc',14),'Editar ficha']}),
        lead.status!=='cliente'?i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',disabled:busy,onClick:()=>setClientDlg(!0),children:[svg('users',14),'Virar cliente']}):null,
        lead.remoteJid?i.jsxs(Fu,{to:'/manager/instance/'+g.id+'/chat/'+encodeURIComponent(lead.remoteJid),className:'wa-tw-sbtn',children:[svg('chat',14),'Abrir conversa']}):null]})]});
    const tabs=i.jsx('div',{className:'wa-fl-tabs',role:'tablist','aria-label':'Seções da ficha do lead',onKeyDown:onTabKey,children:TABS.map(([k,label,icon,n],j)=>i.jsxs('button',{ref:el=>{tabRefs.current[j]=el},type:'button',role:'tab',id:'wa-fl-tab-'+k,'aria-selected':tab===k?'true':'false','aria-controls':'wa-fl-panel',tabIndex:tab===k?0:-1,className:'wa-fl-tab',onClick:()=>pickTab(k),children:[svg(icon,14),i.jsx('span',{children:label}),n>0?i.jsx('span',{className:'wa-fl-tab-n',children:nf.format(n)}):null]},k))});
    const confirmClient=clientDlg?i.jsx(Pt,{open:!0,onOpenChange:o=>{if(!o&&!busy)setClientDlg(!1)},children:i.jsxs(Nt,{className:'wa-confirm',children:[
      i.jsxs(Mt,{children:[i.jsx(zt,{children:'Virar cliente?'}),i.jsx(eo,{children:'O status de '+title(lead)+' muda para Cliente. A ficha, a conversa e os agendamentos continuam iguais.'})]}),
      i.jsxs(Yt,{className:'wa-confirm-foot',children:[i.jsx(se,{variant:'outline',onClick:()=>setClientDlg(!1),disabled:busy,children:'Cancelar'}),i.jsx(se,{onClick:becomeClient,disabled:busy,children:busy?'Salvando…':'Virar cliente'})]})]})}):null;
    return i.jsxs(i.Fragment,{children:[i.jsxs('main',{className:'wa-fl-page',children:[
      head,
      i.jsxs('div',{className:'wa-fl-grid',children:[
        i.jsxs('section',{className:'wa-fl-main',children:[
          tabs,
          i.jsx('div',{className:'wa-fl-panel',role:'tabpanel',id:'wa-fl-panel','aria-labelledby':'wa-fl-tab-'+tab,children:panel})]}),
        i.jsx('aside',{className:'wa-fl-side','aria-label':'Resumo do lead',children:side})]})]}),confirmClient]});
  }

'''

NAME_OLD = "i.jsx('td',{children:i.jsxs('span',{className:'wl-name',children:[i.jsx('strong',{children:title(l)}),l.name&&l.pushName&&l.pushName!==l.name?i.jsx('span',{children:l.pushName}):l.summary?i.jsx('span',{children:l.summary}):null]})}),"
NAME_NEW = "i.jsx('td',{children:i.jsxs('span',{className:'wl-name',children:[i.jsx(Fu,{to:'/manager/instance/'+g.id+'/leads/'+encodeURIComponent(l.id),className:'wl-name-link',onClick:e=>e.stopPropagation(),children:i.jsx('strong',{children:title(l)})}),l.name&&l.pushName&&l.pushName!==l.name?i.jsx('span',{children:l.pushName}):l.summary?i.jsx('span',{children:l.summary}):null]})}),"

DRAWER_OLD = "            i.jsxs(Fu,{to:chat,className:'wa-tw-sbtn',children:[svg('chat',14),'Abrir conversa']}),\n"
DRAWER_NEW = DRAWER_OLD + "            i.jsxs(Fu,{to:'/manager/instance/'+instance.id+'/leads/'+encodeURIComponent(lead.id),className:'wa-tw-sbtn wa-tw-sbtn--ghost',children:[svg('doc',14),'Ver ficha completa']}),\n"

ROUTE_OLD = '{path:"/manager/instance/:instanceId/leads",element:i.jsx(tn,{children:i.jsx(un,{children:i.jsx(WaLeads.Page,{})})})},'
ROUTE_NEW = ROUTE_OLD + '{path:"/manager/instance/:instanceId/leads/:leadId",element:i.jsx(tn,{children:i.jsx(un,{children:i.jsx(WaLeads.LeadPage,{})})})},'


def patch_page(s):
    if 'function LeadPage(' in s:
        return s
    anchor = EXPORT_NEW if EXPORT_NEW in s else EXPORT_OLD
    return rep(s, anchor, LEAD_PAGE + anchor, 'LeadPage before the WaLeads export')


def patch_links(s):
    if EXPORT_OLD in s:
        s = rep(s, EXPORT_OLD, EXPORT_NEW, 'WaLeads export with LeadPage')
    elif EXPORT_NEW not in s:
        raise PatchError('WaLeads export line not found')
    if NAME_OLD in s:
        s = rep(s, NAME_OLD, NAME_NEW, 'lead name link in the Leads table')
    elif 'wl-name-link' not in s:
        raise PatchError('Leads name cell not found')
    if DRAWER_OLD in s:
        s = rep(s, DRAWER_OLD, DRAWER_NEW, 'Ver ficha completa in the lead drawer')
    elif 'Ver ficha completa' not in s:
        raise PatchError('lead drawer chat action not found')
    return s


def patch_route(s):
    if '/manager/instance/:instanceId/leads/:leadId' in s:
        return s
    return rep(s, ROUTE_OLD, ROUTE_NEW, 'lead page route')


GROUPS = [('page', patch_page), ('links', patch_links), ('route', patch_route)]


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


def patch_html(html):
    if html_marker('html') not in html:
        if html.count(ACABAMENTO_LINK) != 1:
            raise PatchError('index.html: acabamento-listas.css link not found exactly once (run acabamento-listas.py first)')
        old = ACABAMENTO_LINK + '\n'
        new = ACABAMENTO_LINK + '\n' + '    ' + html_marker('html') + '\n' + FICHA_LINK + '\n'
        html = html.replace(old, new, 1)
    return bump_index(html)


def group_done(s, name):
    if name == 'page':
        return marker(name) in s and 'function LeadPage(' in s
    if name == 'links':
        return marker(name) in s and 'LeadPage};' in s and 'wl-name-link' in s and 'Ver ficha completa' in s
    return marker(name) in s and '/manager/instance/:instanceId/leads/:leadId' in s


def check_missing(s, html):
    missing = [name for name, _ in GROUPS if not group_done(s, name)]
    if html_marker('html') not in html:
        missing.append('html')
    if not os.path.isfile(CSS):
        missing.append('ficha-lead.css')
    if FICHA_LINK not in html:
        missing.append('ficha-lead.css link')
    if bump_index(html) != html:
        missing.append('index.html bundle version')
    if 'StatusMenu,When' not in s:
        missing.append('acabamento-listas.py (StatusMenu export)')
    return missing


def main():
    check = '--check' in sys.argv[1:]
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()

    if check:
        missing = check_missing(s, html)
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/ficha-lead.css is missing')
    if 'StatusMenu,When' not in s:
        raise PatchError('run manager/patches/acabamento-listas.py first: StatusMenu is not exported by WaLeads')

    report = []
    for name, fn in GROUPS:
        if group_done(s, name):
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = patch_html(html)

    missing = check_missing(s, new_html)
    if missing:
        raise PatchError(f'still missing after apply: {missing}')

    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        report.append(f'index.html written (ficha-lead.css ?v={CSS_VERSION}, bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
