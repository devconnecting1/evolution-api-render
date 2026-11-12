#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: pendencias, erro com codigo e Atendente IA no notebook.

Same method as the other scripts in manager/patches: manager/dist is the compiled bundle, so changes are exact
string replacements in the minified bundle, in index.html and in the plain assets of manager/dist/assets.

What it does (review readmes/REVISAO-ENTREGA.md, items F+Y, C, T and H of section 6):

  notif-page - replaces the old WaNotif page module (three fixed counters, fetched by itself) with a page that
               renders window.WaNotif.list(true): the SAME items and the SAME unseen count as the bell of the
               header. The sidebar icon also reads window.WaNotif.count(). The technical sentence about memory and
               background polling is gone. The page still feeds the three existing requests once per instance
               (120 s in memory, no timer, no polling) so opening it fills the shared store; the responses go
               through the interceptor that central-notificacoes.js already installs. "Atualizar" reloads that
               same cache; "Marcar como visto" and "Marcar tudo como visto" act on the shared store.
  leads-mode - on the phone the Leads page starts in Lista (Quadro is cramped) and remembers the user's choice
               under a mobile-only key; the desktop keeps the existing key and the existing behavior.
  ai-nav     - a new "Horário de atendimento" entry in the Atendente IA section navigation.
  ai-hours   - WaAI.Hours: the same business-hours editor of Plano e limites, inside the Atendente IA page.
               GET /usage/limits/:instance on open; POST sends only businessHours and outsideHoursMessage, so the
               other limits are unchanged. Same texts, same validation, no new backend. The section is not
               rendered in the create dialog.
  ai-layout  - the Hours component adds .wa-ai-layout to the resizable panel group; painel-pendentes.css turns
               the two panes into one column below 1366 px (bot list as a compact top strip, form full width),
               so the form is not squeezed between the bot list and the section navigation at 1024/1280 px.
  html       - links painel-pendentes.css before design-system.css, inserts central-notificacoes-leads.js and
               erros-codigo.js before the bundle and raises the bundle ?v= to CACHE_VERSION.

erros-codigo.js (plain asset, no bundle anchor) records the status/time of the last failed fetch/XHR and adds
"Codigo do erro: 503 - 12/11 21:04 - copiar para o suporte" to the existing error states, without stack trace,
URL or internal detail. central-notificacoes-leads.js extends window.WaNotif with the waiting-lead feed
(GET /leads/:instance?status=aguardando&pageSize=1), marked with /*whatsai-patch:painel-pendentes:leads-feed*/.

Every anchor must match exactly once, otherwise the script stops without writing anything. Re-running is safe:
groups whose marker is present are skipped; the cache versions are only raised. Order: after acabamento-listas.py,
quadro-leads.py, atendente-ia.py, qa-funcional.py, qa-desktop-polish.py and every patch that links a stylesheet.

Usage (from the repository root):
  python3 -I manager/patches/painel-pendentes.py           # apply
  python3 -I manager/patches/painel-pendentes.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
LEADS_JS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'central-notificacoes-leads.js')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'painel-pendentes.css')
JS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'erros-codigo.js')
CACHE_VERSION = '78'
CSS_VERSION = '1'
LEADS_VERSION = '1'
JS_VERSION = '1'
SCRIPT_TAG = '<script type="module" crossorigin src="/assets/index-b29a5d7a.js?v='
CSS_TAG = '<link rel="stylesheet" href="/assets/painel-pendentes.css?v=' + CSS_VERSION + '" />'
LEADS_TAG = '<script src="/assets/central-notificacoes-leads.js?v=' + LEADS_VERSION + '"></script>'
JS_TAG = '<script src="/assets/erros-codigo.js?v=' + JS_VERSION + '"></script>'
CSS_MARKER = '<!-- whatsai-patch:painel-pendentes:css -->'
JS_MARKER = '<!-- whatsai-patch:painel-pendentes:js -->'
DESIGN_MARKER = '<!-- whatsai-patch:design-system:html -->'
LEADS_MARKER = '/*whatsai-patch:painel-pendentes:leads-feed*/'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:painel-pendentes:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


# ------------------------------------------------------------------------------------------------ 1. notificacoes
NOTIF_START = 'const WaNotif=(()=>{'
NOTIF_END = '  return{Icon,Page,useCounts,load};\n})();\n'

NOTIF_NEW = r'''const WaNotif=(()=>{
  const nf=new Intl.NumberFormat('pt-BR'),enc=encodeURIComponent;
  const IC={bell:['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9','M10.3 21a1.94 1.94 0 0 0 3.4 0'],
    ext:['M15 3h6v6','M10 14 21 3','M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6']};
  function svg(name,size){const d=IC[name]||[];return i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:size||15,height:size||15,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'1.6',strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',children:d.map((p,k)=>i.jsx('path',{d:p},k))});}
  const store=()=>window.WaNotif||{list:()=>[],count:()=>0,subscribe:()=>()=>{},markSeen:()=>{},markAllSeen:()=>{}};
  const C=new Map(),subs=new Set();
  const emit=()=>subs.forEach(f=>{try{f()}catch(e){}});
  function get(name){return C.get(name)||{status:name?'loading':'idle',at:0,p:null}}
  // Reads the three existing counts once per instance and keeps them in memory for 120 s. The responses also feed
  // the shared store (window.WaNotif), which is what the bell and the sidebar read. No timers, no polling.
  function load(inst,force){
    const name=inst&&inst.name;if(!name)return null;
    const cur=get(name);
    if(cur.p)return cur.p;
    if(!force&&cur.status==='ok'&&Date.now()-cur.at<12e4)return null;
    const p=Promise.all([
      Ee.get('/leads/'+enc(name),{params:{status:'aguardando',pageSize:1}}).then(()=>!0,()=>null),
      Ee.get('/agenda/'+enc(name),{params:{status:'pendente'}}).then(()=>!0,()=>null),
      Ee.get('/processos/'+enc(name)+'/badge').then(()=>!0,()=>null)
    ]).then(ok=>{
      if(ok.every(x=>x==null)){C.set(name,{...cur,status:'error',p:null});emit();return null}
      C.set(name,{status:'ok',at:Date.now(),p:null});emit();return !0},
      ()=>{C.set(name,{...cur,status:'error',p:null});emit();return null});
    C.set(name,{...cur,status:'loading',p});
    emit();
    return p;
  }
  function useCounts(inst){
    const[,tick]=y.useState(0),name=inst&&inst.name;
    y.useEffect(()=>{const f=()=>tick(n=>n+1);subs.add(f);load(inst);return()=>{subs.delete(f)}},[name]);
    const st=get(name);
    return{status:st.status,reload:()=>load(inst,!0)};
  }
  function useStore(){
    const[,tick]=y.useState(0);
    y.useEffect(()=>{const off=store().subscribe(()=>tick(n=>n+1));return()=>{off&&off()}},[]);
    return store();
  }
  function unseen(items){return items.filter(x=>!x.seen).length}
  function plural(n,one,many){return n===1?'1 '+one:nf.format(n)+' '+many}
  function Icon({size}){
    const{instance:g}=ct(),st=useCounts(g),s=useStore(),n=s.count?s.count():unseen(s.list(!0));
    return i.jsxs(i.Fragment,{children:[svg('bell',Number(size)||15),n>0?i.jsxs('span',{className:'wa-fin-nav-n',children:[n>99?'99+':nf.format(n),i.jsx('span',{className:'sr-only',children:' notificações'})]}):null]});
  }
  function Item({it}){
    return i.jsxs('li',{className:'wa-fin-item','data-tone':it.tone,'data-seen':it.seen?'true':void 0,children:[
      i.jsx('span',{className:'wa-fin-item-ic',children:WaUt.svg(it.icon,18)}),
      i.jsxs('div',{className:'wa-fin-item-text',children:[
        i.jsx('h2',{className:'wa-fin-item-title',children:it.title}),
        i.jsx('p',{className:'wa-fin-muted',children:it.meta})]}),
      i.jsxs('div',{className:'wa-fin-item-acts',children:[
        it.href?i.jsxs(Fu,{to:it.href,className:'wa-tw-sbtn wa-tw-sbtn--ghost wa-fin-item-actions-link',children:[it.action,svg('ext',13)]}):i.jsx('span',{className:'wa-fin-muted',children:it.action}),
        it.seen?null:i.jsx('button',{type:'button',className:'wa-fin-seen',onClick:()=>{store().markSeen(it)},children:'Marcar como visto'})]})]});
  }
  function Page(){
    const{instance:g}=ct(),st=useCounts(g),s=useStore();
    if(!g)return null;
    const items=s.list(!0),pending=unseen(items);
    return i.jsxs('main',{className:'wa-fin-page',children:[
      i.jsxs('header',{className:'wa-fin-head',children:[
        i.jsxs('div',{children:[
          i.jsx('h1',{className:'wa-fin-title',children:'Notificações'}),
          i.jsx('p',{className:'wa-fin-muted',children:'Os mesmos avisos do sino, em uma lista só. Abra o que precisa da equipe e marque o que já foi resolvido.'})]}),
        i.jsxs('div',{className:'wa-fin-actions',children:[
          i.jsx('span',{className:'wa-fin-count','data-done':pending?'false':'true','aria-live':'polite',children:pending?plural(pending,'não vista','não vistas'):'Tudo visto'}),
          i.jsx('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:st.reload,disabled:st.status==='loading',children:st.status==='loading'?'Atualizando…':'Atualizar'}),
          pending?i.jsx('button',{type:'button',className:'wa-fin-all',onClick:()=>{store().markAllSeen()},children:'Marcar tudo como visto'}):null]})]}),
      i.jsxs(i.Fragment,{children:[
      st.status==='error'&&items.length?i.jsxs('div',{className:'wa-fin-error',role:'alert',children:[
        i.jsx('p',{children:'Não foi possível atualizar as notificações agora. Os itens abaixo podem estar desatualizados.'}),
        i.jsx('button',{type:'button',className:'wa-tw-sbtn',onClick:st.reload,children:'Tentar de novo'})]}):null,
      st.status==='error'&&!items.length?i.jsxs('div',{className:'wa-tw-empty',role:'alert',children:[
        i.jsx('p',{className:'wa-tw-empty-title',children:'Não foi possível carregar as notificações'}),
        i.jsx('p',{className:'wa-tw-empty-text',children:'Confira a conexão com o servidor e tente de novo.'}),
        i.jsx('button',{type:'button',className:'wa-tw-sbtn',onClick:st.reload,children:'Tentar de novo'})]}):
      st.status==='loading'&&!items.length?i.jsx('p',{className:'wa-fin-loading',role:'status',children:'Carregando as notificações…'}):
      items.length?i.jsx('ul',{className:'wa-fin-list',children:items.map(it=>i.jsx(Item,{it},it.key))}):
      i.jsxs('div',{className:'wa-tw-empty',role:'status',children:[
        i.jsx('p',{className:'wa-tw-empty-title',children:'Tudo em dia'}),
        i.jsx('p',{className:'wa-tw-empty-text',children:'Nada pedindo atenção agora. Os avisos aparecem conforme você usa o painel.'})]})]})]});
  }
  return{Icon,Page,useCounts,load};
})();
'''


def g_notif(s):
    mark = marker('notif-page')
    if mark in s:
        return s
    if s.count(NOTIF_START) != 1 or s.count(NOTIF_END) != 1:
        raise PatchError('notifications: old WaNotif module not found exactly once')
    start = s.index(NOTIF_START)
    end = s.index(NOTIF_END, start) + len(NOTIF_END)
    return s[:start] + mark + '\n' + NOTIF_NEW + s[end:]


# ------------------------------------------------------------------------------------------------ 2. Leads no celular
LEADS_MODE_OLD = "const[mode,setMode]=y.useState(()=>ls_('wa-leads-mode')==='quadro'?'quadro':'lista')"
LEADS_MODE_NEW = (marker('leads-mode') +
                  "const modeKey=()=>window.matchMedia&&window.matchMedia('(max-width: 767px)').matches?'wa-leads-mode-mobile':'wa-leads-mode';"
                  "const[mode,setMode]=y.useState(()=>ls_(modeKey())==='quadro'?'quadro':'lista')")
LEADS_SWITCH_OLD = "const switchMode=m=>{setMode(m);ls_('wa-leads-mode',m);setPage(1);if(m==='quadro')set({seg:'todos'})};"
LEADS_SWITCH_NEW = "const switchMode=m=>{setMode(m);ls_(modeKey(),m);setPage(1);if(m==='quadro')set({seg:'todos'})};"


def g_leads(s):
    if marker('leads-mode') in s:
        return s
    s = rep(s, LEADS_MODE_OLD, LEADS_MODE_NEW, 'Leads mode initializer')
    return rep(s, LEADS_SWITCH_OLD, LEADS_SWITCH_NEW, 'Leads switchMode')


# ------------------------------------------------------------------------------------------------ 3. Atendente IA
AI_NAV_OLD = "['quando','Quando responder'],['avancado','Avançado'],"
AI_NAV_NEW = "['quando','Quando responder']," + marker('ai-nav') + "['horario','Horário de atendimento'],['avancado','Avançado'],"

AI_EXPORT_OLD = '  return{Nav,Save};\n'

HOURS = r'''/*whatsai-patch:painel-pendentes:ai-hours*/
  const DAYS=[['mon','Segunda'],['tue','Terça'],['wed','Quarta'],['thu','Quinta'],['fri','Sexta'],['sat','Sábado'],['sun','Domingo']];
  const ZONES=['America/Sao_Paulo','America/Manaus','America/Cuiaba','America/Fortaleza','America/Recife','America/Belem','America/Porto_Velho','America/Rio_Branco','America/Noronha'];
  const HOUR_MODES=[
    ['always','IA responde sempre','A qualquer hora, todos os dias.'],
    ['inside','IA só no horário de atendimento','Fora do horário a IA não responde; se houver mensagem fora do horário, ela vai uma vez por dia por contato.'],
    ['outside','IA só fora do horário','No horário a sua equipe atende; a IA cobre noites, fins de semana e folgas.']];
  function hourErr(e){const m=e?.response?.data?.response?.message??e?.response?.data?.message;const flat=[].concat(m??[]).flat(4).map(x=>typeof x==='string'?x:x&&x.message?String(x.message):'').filter(Boolean);if(flat.length)return flat.join(' ');if(e?.response?.status===404)return 'A API ainda não tem o horário de atendimento: atualize o backend.';return 'Não foi possível falar com a API. Tente de novo em instantes.';}
  function Hours(){
    const{instance:g}=ct(),name=g&&g.name;
    const[base,setBase]=y.useState(null),[form,setForm]=y.useState(null),[loadError,setLoadError]=y.useState(''),[saving,setSaving]=y.useState(!1),[saveError,setSaveError]=y.useState(''),[tried,setTried]=y.useState(!1);
    const toForm=l=>{const bh=l?.businessHours||{},week={};
      for(const[k]of DAYS){const r=Array.isArray(bh.week?.[k])?bh.week[k]:[];const f=r[0]||['09:00','18:00'];week[k]={open:r.length>0,start:f[0],end:f[1]==='24:00'?'00:00':f[1],extra:r.slice(1)};}
      return{mode:bh.enabled?bh.mode||'always':'always',tz:bh.timezone||'America/Sao_Paulo',week,msg:(l&&l.outsideHoursMessage)||''}};
    const load=y.useCallback(async()=>{if(!name)return;setLoadError('');try{const r=await Ee.get('/usage/limits/'+encodeURIComponent(name));const f=toForm(r.data&&r.data.limits);setBase(f);setForm(f)}catch(e){setLoadError(hourErr(e))}},[name]);
    y.useEffect(()=>{load()},[load]);
    y.useEffect(()=>{const f=document.querySelector('.wa-ai-form');const box=f&&f.closest('[data-panel-group]');if(box)box.classList.add('wa-ai-layout')},[]);
    const set=patch=>{setForm(f=>({...f,...patch}));setSaveError('')};
    const setDay=(k,patch)=>setForm(f=>({...f,week:{...f.week,[k]:{...f.week[k],...patch}}}));
    const toBody=f=>({businessHours:{enabled:f.mode!=='always',mode:f.mode,timezone:f.tz,week:Object.fromEntries(DAYS.map(([k])=>[k,f.week[k].open?[[f.week[k].start,f.week[k].end],...f.week[k].extra]:[]]))},outsideHoursMessage:f.msg.trim()||null});
    const problems=f=>{const e=[];
      if(f.mode!=='always'){const open=DAYS.filter(([k])=>f.week[k].open);if(!open.length)e.push('Marque pelo menos um dia de atendimento.');
        for(const[k,lb]of open){const d=f.week[k];if(!d.start||!d.end)e.push(lb+': preencha início e fim.');else if(d.start===d.end)e.push(lb+': início e fim iguais.')}}
      return e};
    const save=async()=>{setTried(!0);const errs=problems(form);if(errs.length){setSaveError(errs.join(' '));return}
      setSaving(!0);setSaveError('');
      try{const r=await Ee.post('/usage/limits/'+encodeURIComponent(name),toBody(form));const f=toForm(r.data&&r.data.limits);setBase(f);setForm(f);setTried(!1);me.success('Horário de atendimento salvo.')}
      catch(e){setSaveError(hourErr(e))}finally{setSaving(!1)}};
    if(!form)return i.jsxs('div',{className:'wa-ai-hours',children:[
      loadError?i.jsxs(i.Fragment,{children:[
        i.jsx('div',{className:'wa-ai-hours-error',role:'alert',children:i.jsx('p',{children:loadError})}),
        i.jsx('div',{className:'wa-ai-hours-actions',children:i.jsx('button',{type:'button',className:'wa-ai-btn wa-ai-btn-ghost',onClick:load,children:'Tentar de novo'})})]}):
      i.jsx('p',{className:'wa-ai-hours-loading',role:'status',children:'Carregando o horário de atendimento…'})]});
    const dirty=JSON.stringify(toBody(form))!==JSON.stringify(toBody(base));
    const errs=tried?problems(form):[];
    return i.jsxs('div',{className:'wa-ai-hours',onKeyDown:ev=>{if(ev.key==='Enter'&&(ev.target.tagName==='INPUT'||ev.target.tagName==='SELECT'))ev.preventDefault()},children:[
      i.jsx('p',{className:'wa-ai-hours-hint',children:'Define quando a IA pode responder nesta instância. É o mesmo horário da página Plano e limites.'}),
      i.jsxs('fieldset',{className:'wa-ai-hours-group',children:[
        i.jsx('legend',{className:'wa-ai-hours-legend',children:'Quando a IA responde'}),
        HOUR_MODES.map(([id,lb,tx])=>i.jsxs('label',{className:'wa-ai-hours-option','data-checked':form.mode===id?'true':void 0,children:[
          i.jsx('input',{type:'radio',name:'wa-ai-hours-mode',value:id,checked:form.mode===id,onChange:()=>set({mode:id})}),
          i.jsxs('span',{children:[i.jsx('span',{className:'wa-ai-hours-option-title',children:lb}),i.jsx('span',{className:'wa-ai-hours-option-text',children:tx})]})]},id))]}),
      form.mode!=='always'?i.jsxs(i.Fragment,{children:[
        i.jsxs('div',{className:'wa-ai-hours-field',children:[
          i.jsx('label',{className:'wa-ai-hours-label',htmlFor:'wa-ai-hours-tz',children:'Fuso horário'}),
          i.jsx('select',{id:'wa-ai-hours-tz',className:'wa-ai-hours-input',value:form.tz,onChange:ev=>set({tz:ev.target.value}),children:(ZONES.includes(form.tz)?ZONES:[form.tz,...ZONES]).map(z=>i.jsx('option',{value:z,children:z.replace('America/','').replace(/_/g,' ')},z))})]}),
        i.jsx('div',{className:'wa-ai-hours-week',role:'group','aria-label':'Horário por dia',children:DAYS.map(([k,lb])=>{
          const d=form.week[k],night=d.open&&d.start&&d.end&&d.end<d.start;
          return i.jsxs('div',{className:'wa-ai-hours-day','data-open':d.open?'true':void 0,children:[
            i.jsxs('label',{className:'wa-ai-hours-day-name',children:[i.jsx('input',{type:'checkbox',checked:d.open,onChange:ev=>setDay(k,{open:ev.target.checked})}),i.jsx('span',{children:lb})]}),
            d.open?i.jsxs('span',{className:'wa-ai-hours-times',children:[
              i.jsx('input',{type:'time',className:'wa-ai-hours-input wa-ai-hours-time',step:60,value:d.start,'aria-label':lb+': início',onChange:ev=>setDay(k,{start:ev.target.value})}),
              i.jsx('span',{className:'wa-ai-hours-sep','aria-hidden':'true',children:'às'}),
              i.jsx('input',{type:'time',className:'wa-ai-hours-input wa-ai-hours-time',step:60,value:d.end,'aria-label':lb+': fim',onChange:ev=>setDay(k,{end:ev.target.value})}),
              night?i.jsx('span',{className:'wa-ai-hours-note',children:'termina no dia seguinte'}):null,
              d.extra.length?i.jsx('span',{className:'wa-ai-hours-note',children:'+'+d.extra.length+' faixa(s) definida(s) pela API'}):null]}):
            i.jsx('span',{className:'wa-ai-hours-closed',children:'Fechado'})]},k)})}),
        form.mode==='inside'?i.jsxs('div',{className:'wa-ai-hours-field',children:[
          i.jsx('label',{className:'wa-ai-hours-label',htmlFor:'wa-ai-hours-msg',children:'Mensagem fora do horário (opcional)'}),
          i.jsx('textarea',{id:'wa-ai-hours-msg',className:'wa-ai-hours-input wa-ai-hours-textarea',rows:3,maxLength:1000,placeholder:'Ex.: Olá! Atendemos de segunda a sexta, das 9h às 18h. Respondemos assim que abrirmos.',value:form.msg,onChange:ev=>set({msg:ev.target.value})}),
          i.jsx('p',{className:'wa-ai-hours-note',children:'Enviada no máximo uma vez por dia por contato. Vazio = a IA fica em silêncio fora do horário.'})]}):null]}):null,
      errs.length||saveError?i.jsxs('div',{className:'wa-ai-hours-error',role:'alert',children:i.jsx('ul',{children:(saveError?[saveError]:errs).map((t,k)=>i.jsx('li',{children:t},k))})}):null,
      i.jsxs('div',{className:'wa-ai-hours-actions',children:[
        i.jsx('button',{type:'button',className:'wa-ai-btn wa-ai-btn-ghost',disabled:!dirty||saving,onClick:()=>{setForm(base);setSaveError('');setTried(!1)},children:'Descartar alterações'}),
        i.jsx('button',{type:'button',className:'wa-ai-btn wa-ai-btn-primary',disabled:!dirty||saving,'aria-busy':saving?'true':void 0,onClick:save,children:saving?'Salvando…':'Salvar horário'})]})]});
  }
'''

AI_END_OLD = ',]}),]}),s&&i.jsx(Yt,'
AI_END_NEW = (',]}),s?null:i.jsxs("section",{className:"wa-ai-sec","data-sec":"horario",'
              '"aria-label":"Horário de atendimento",children:[i.jsx(WaAI.Hours,{})]}),]}),s&&i.jsx(Yt,')


def g_ai_nav(s):
    if marker('ai-nav') in s:
        return s
    return rep(s, AI_NAV_OLD, AI_NAV_NEW, 'WaAI section list')


def g_ai_hours(s):
    if marker('ai-hours') in s:
        return s
    s = rep(s, AI_EXPORT_OLD, HOURS + '  return{Nav,Save,Hours};\n', 'WaAI export')
    return rep(s, AI_END_OLD, AI_END_NEW, 'Atendente IA form end')


GROUPS = [('notif-page', g_notif), ('leads-mode', g_leads), ('ai-nav', g_ai_nav), ('ai-hours', g_ai_hours)]


# ------------------------------------------------------------------------------------------------ index.html
def patch_html(html):
    css_done = CSS_TAG in html and CSS_MARKER in html
    js_done = JS_MARKER in html and LEADS_TAG in html and JS_TAG in html
    if (CSS_TAG in html) != (CSS_MARKER in html):
        raise PatchError('index.html: painel-pendentes.css linked without its marker')
    if JS_MARKER in html and not js_done:
        raise PatchError('index.html: painel-pendentes scripts linked without both tags')
    if not css_done:
        if html.count('    ' + DESIGN_MARKER) != 1:
            raise PatchError('index.html: design-system marker expected once (run design-system.py first)')
        block = '    ' + CSS_MARKER + '\n    ' + CSS_TAG + '\n'
        html = html.replace('    ' + DESIGN_MARKER, block + '    ' + DESIGN_MARKER, 1)
    if not js_done:
        anchor = '    ' + SCRIPT_TAG
        if html.count(anchor) != 1:
            raise PatchError('index.html: bundle script tag expected once')
        block = '    ' + JS_MARKER + '\n    ' + LEADS_TAG + '\n    ' + JS_TAG + '\n'
        html = html.replace(anchor, block + anchor, 1)
    return html


def bump_index(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag expected once')
    start = pos + len(SCRIPT_TAG)
    end = start
    while end < len(html) and html[end].isdigit():
        end += 1
    current = html[start:end]
    if current and int(current) >= int(CACHE_VERSION):
        return html
    return html[:start] + CACHE_VERSION + html[end:]


def apply_bundle(s):
    for name, group in GROUPS:
        s = group(s)
    return s


def main():
    check = '--check' in sys.argv[1:]
    bundle = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    leads_js = open(LEADS_JS, encoding='utf-8').read() if os.path.exists(LEADS_JS) else ''
    missing = []

    for name, _ in GROUPS:
        if marker(name) not in bundle:
            missing.append(name)
    if LEADS_MARKER not in leads_js or '__waLeads' not in leads_js:
        missing.append('central-notificacoes-leads.js')
    if CSS_MARKER not in html or CSS_TAG not in html:
        missing.append('painel-pendentes.css link')
    if JS_MARKER not in html or LEADS_TAG not in html or JS_TAG not in html:
        missing.append('erros-codigo.js script')
    if not os.path.exists(CSS):
        missing.append('painel-pendentes.css')
    if not os.path.exists(LEADS_JS):
        missing.append('central-notificacoes-leads.js')
    if not os.path.exists(JS):
        missing.append('erros-codigo.js')

    try:
        if apply_bundle(bundle) != bundle:
            missing.append('bundle patches')
        if patch_html(html) != html:
            missing.append('index.html')
        if bump_index(html) != html:
            missing.append('index.html cache version')
    except PatchError as error:
        missing.append(str(error))

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    new_bundle = apply_bundle(bundle)
    if new_bundle != bundle:
        open(BUNDLE, 'w', encoding='utf-8').write(new_bundle)
    new_html = bump_index(patch_html(html))
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    pos = new_html.find(SCRIPT_TAG) + len(SCRIPT_TAG)
    end = pos
    while end < len(new_html) and new_html[end].isdigit():
        end += 1
    print(f'bundle: notifications, leads mode and Atendente IA; index.html: painel-pendentes.css ?v={CSS_VERSION}, '
          f'central-notificacoes-leads.js ?v={LEADS_VERSION}, erros-codigo.js ?v={JS_VERSION}, '
          f'bundle ?v={new_html[pos:end]}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'error: {error}', file=sys.stderr)
        sys.exit(1)
