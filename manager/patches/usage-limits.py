#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Plano e limites" page and the usage bar of "Visão Geral".

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/usage-limits.css (a plain file, edited by hand, only var(--m-*) tokens of
minimal.css, linked right after minimal.css).

Backend (same release): GET/POST /usage/limits/:instanceName and GET /usage/summary/:instanceName. Requests go
through the bundle's axios instance (Ee: API URL + apikey of the instance or of the login).

Bundle groups (each one is applied once and leaves a marker comment at the top of the bundle):
  component - WaUsage, an isolated component module (IIFE) placed before the route table, like
              WhatsAIObservability: Page (the "Plano e limites" page), Bar (compact usage card) and Icon.
              Page: usage card ("1.234 de 2.000 respostas este mês", today, estimated excedente in blocks of
              1.000 at R$ 49, last 30 days, top contacts of the day with masked numbers), plan presets
              (Essencial 2.000 / Profissional 5.000 / Premium 10.000 / Personalizado / Sem limite), daily and
              per-contact caps, alert percent, action over the franchise (continue / pause / message), business
              hours (always / inside / outside, time zone, one range per day with "Copiar para todos") and the
              message outside hours. Save sends only the edited fields of the form; API errors are shown inline.
  route     - /manager/instance/:instanceId/usage inside the instance layout (same guards as the dashboard).
  sidebar   - "Plano e limites" item right after "Conversas" (near "Visão Geral").
  dashboard - the compact usage bar under the metric cards of "Visão Geral" (hidden when the API has no
              /usage endpoints or fails).
index.html group (marker: an HTML comment in <head>):
  html      - links usage-limits.css?v=1 after minimal.css and bumps the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.
Order: run after every other script (it needs minimal.py and chat-guards.py applied).

Usage (from the repository root):
  python3 -I manager/patches/usage-limits.py           # apply
  python3 -I manager/patches/usage-limits.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'usage-limits.css')
REQUIRED = ('/*whatsai-patch:minimal:chat-start*/', '/*whatsai-patch:chat-guards:v1*/',
            '/*whatsai-patch:dashboard-ui:dashboard*/', '/*whatsai-patch:render-style:sidebar*/')
CACHE_VERSION = '20'
SCRIPT_TAG = '<script type="module" crossorigin src="/assets/index-b29a5d7a.js?v='
CSS_ANCHOR = '    <link rel="stylesheet" href="/assets/minimal.css?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:usage-limits:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:usage-limits:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# Minified names (bundle index-b29a5d7a.js): i = jsx runtime, y = React, Ee = axios instance of the API (base URL +
# apikey), me = toast, Fu = react-router Link, ct = useInstance (instance context), tn = protected route,
# un = instance layout (sidebar), PX = instance dashboard ("Visão Geral"), j5 = instance sidebar.

COMPONENT = r'''const WaUsage=(()=>{
  const nf=new Intl.NumberFormat('pt-BR');
  const fmt=v=>v==null||v===''||!Number.isFinite(Number(v))?'—':nf.format(Number(v));
  const DAYS=[['mon','Segunda'],['tue','Terça'],['wed','Quarta'],['thu','Quinta'],['fri','Sexta'],['sat','Sábado'],['sun','Domingo']];
  const PLANS=[['Essencial','Essencial',2000],['Profissional','Profissional',5000],['Premium','Premium',10000],['Personalizado','Personalizado',null],['none','Sem limite',null]];
  const ZONES=['America/Sao_Paulo','America/Manaus','America/Cuiaba','America/Fortaleza','America/Recife','America/Belem','America/Porto_Velho','America/Rio_Branco','America/Noronha'];
  const MONTHS=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const ACTIONS=[
    ['continue','Continuar respondendo','A IA segue respondendo e o excedente é cobrado em blocos de 1.000 respostas (R$ 49 cada), como no contrato.'],
    ['pause','Pausar a IA','A IA para de responder até o mês virar. A equipe continua atendendo pelo WhatsApp.'],
    ['message','Enviar uma mensagem','A IA para de responder e o cliente recebe a mensagem abaixo, no máximo uma vez por dia.']];
  const MODES=[
    ['always','IA responde sempre','A qualquer hora, todos os dias.'],
    ['inside','IA só no horário de atendimento','Fora do horário a IA não responde; se houver mensagem fora do horário, ela vai uma vez por dia por contato.'],
    ['outside','IA só fora do horário','No horário a sua equipe atende; a IA cobre noites, fins de semana e folgas.']];
  const GAUGE=['M12 14l4-4','M3.34 19a10 10 0 1 1 17.32 0'];
  function svg(paths,size){return i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:size||16,height:size||16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'1.75',strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',children:paths.map((d,k)=>i.jsx('path',{d},k))});}
  function Icon({size}){return svg(GAUGE,Number(size)||15);}
  function monthLabel(p){const [yy,mm]=String(p||'').split('-');const m=MONTHS[Number(mm)-1];return m?m+' de '+yy:String(p||'');}
  function dayLabel(d){const [,mm,dd]=String(d||'').split('-');return dd&&mm?dd+'/'+mm:String(d||'');}
  function errText(e){const m=e?.response?.data?.response?.message??e?.response?.data?.message;const flat=[].concat(m??[]).flat(4).map(x=>typeof x==='string'?x:x&&x.message?String(x.message):'').filter(Boolean);if(flat.length)return flat.join(' ');if(e?.response?.status===404)return 'A API ainda não tem o recurso Plano e limites: atualize o backend.';return 'Não foi possível falar com a API. Tente de novo em instantes.';}
  function tone(pct,alert){if(pct==null)return 'ok';if(pct>=100)return 'bad';if(pct>=(alert||80))return 'warn';return 'ok';}
  function Meter({value,max,alert,label}){const pct=max?Number(value)/max*100:null;return i.jsx('div',{className:'wu-meter','data-tone':tone(pct,alert),role:'progressbar','aria-label':label,'aria-valuemin':0,'aria-valuemax':max||0,'aria-valuenow':Number(value)||0,children:i.jsx('span',{className:'wu-meter-fill',style:{width:Math.min(100,pct||0)+'%'}})});}
  function useSummary(name){const[st,set]=y.useState({data:null,error:'',loading:!0});const load=y.useCallback(async()=>{if(!name)return;set(p=>({...p,loading:!0}));try{const r=await Ee.get('/usage/summary/'+encodeURIComponent(name));set({data:r.data,error:'',loading:!1})}catch(e){set({data:null,error:errText(e),loading:!1})}},[name]);y.useEffect(()=>{load()},[load]);return{...st,reload:load};}
  function monthText(m){return m.limit?fmt(m.responses)+' de '+fmt(m.limit)+' respostas este mês':fmt(m.responses)+' respostas este mês · sem limite';}

  function Bar({instance}){
    const{data}=useSummary(instance?.name);
    if(!data||!data.month)return null;
    const m=data.month,plan=data.limits?.planName;
    return i.jsxs('section',{className:'wu-bar','aria-labelledby':'wu-bar-title',children:[
      i.jsxs('div',{className:'wu-bar-head',children:[
        i.jsxs('h2',{id:'wu-bar-title',className:'wu-bar-title',children:[i.jsx('span',{className:'wu-ico',children:svg(GAUGE,16)}),plan?'Plano '+plan:'Respostas da IA']}),
        i.jsx(Fu,{to:'/manager/instance/'+instance.id+'/usage',className:'wu-link',children:'Plano e limites'})]}),
      i.jsxs('p',{className:'wu-bar-text',children:[i.jsx('strong',{children:monthText(m)}),m.percent!=null?i.jsx('span',{className:'wu-muted',children:' · '+fmt(m.percent)+'%'}):null]}),
      m.limit?i.jsx(Meter,{value:m.responses,max:m.limit,alert:m.alertPercent,label:'Uso da franquia do mês'}):null,
      m.excedente?i.jsx('p',{className:'wu-bar-note','data-tone':'bad',children:'Excedente: '+fmt(m.excedente)+' respostas ('+m.blocks1000+' bloco(s) de 1.000, cerca de R$ '+fmt(m.estimatedBRL)+').'}):null]});
  }

  function Usage({data,onReload,loading}){
    const m=data.month,t=data.today,days=Array.isArray(data.last30Days)?data.last30Days:[];
    const max=Math.max(1,...days.map(d=>Number(d.responses)||0)),total=days.reduce((a,d)=>a+(Number(d.responses)||0),0);
    const status=m.status==='exceeded'?['bad','Franquia esgotada']:m.status==='warning'?['warn','Perto do limite']:['ok',m.limit?'Dentro da franquia':'Sem limite'];
    return i.jsxs('section',{className:'wu-card','aria-labelledby':'wu-usage-title',children:[
      i.jsxs('div',{className:'wu-card-head',children:[
        i.jsxs('div',{children:[i.jsx('h2',{id:'wu-usage-title',className:'wu-card-title',children:'Uso em '+monthLabel(m.period)}),
          i.jsx('p',{className:'wu-muted',children:data.aiActiveNow===!1?'A IA está fora do horário dela agora.':'Contagem automática: cada resposta da IA a uma mensagem (ou sequência de mensagens) do cliente.'})]}),
        i.jsxs('div',{className:'wu-head-actions',children:[i.jsxs('span',{className:'wu-chip','data-tone':status[0],children:[i.jsx('span',{className:'wu-dot','aria-hidden':'true'}),status[1]]}),
          i.jsx('button',{type:'button',className:'wu-btn wu-btn-ghost',onClick:onReload,disabled:loading,children:loading?'Atualizando…':'Atualizar'})]})]}),
      i.jsxs('p',{className:'wu-big',children:[monthText(m),m.percent!=null?i.jsx('span',{className:'wu-muted',children:' · '+fmt(m.percent)+'%'}):null]}),
      m.limit?i.jsx(Meter,{value:m.responses,max:m.limit,alert:m.alertPercent,label:'Uso da franquia do mês'}):null,
      i.jsxs('dl',{className:'wu-stats',children:[
        i.jsxs('div',{children:[i.jsx('dt',{children:'Hoje'}),i.jsx('dd',{children:fmt(t.responses)+(t.limit?' de '+fmt(t.limit):'')+' respostas'})]}),
        i.jsxs('div',{children:[i.jsx('dt',{children:'Excedente estimado'}),i.jsx('dd',{children:m.limit?(m.excedente?fmt(m.excedente)+' respostas · '+m.blocks1000+' bloco(s) de 1.000 · R$ '+fmt(m.estimatedBRL):'Nenhum'):'—'})]}),
        i.jsxs('div',{children:[i.jsx('dt',{children:'Alerta'}),i.jsx('dd',{children:m.limit?'em '+fmt(m.alertPercent)+'% da franquia':'—'})]})]}),
      days.length?i.jsxs('div',{className:'wu-chart-wrap',children:[
        i.jsx('p',{className:'wu-label',children:'Últimos 30 dias · '+fmt(total)+' respostas'}),
        i.jsx('div',{className:'wu-chart',role:'img','aria-label':'Respostas por dia nos últimos 30 dias: total '+fmt(total)+', maior dia '+fmt(max),children:days.map(d=>i.jsx('span',{className:'wu-col',title:dayLabel(d.day)+': '+fmt(d.responses)+' respostas',style:{height:Math.max(2,Math.round((Number(d.responses)||0)/max*100))+'%'}},d.day))}),
        i.jsxs('div',{className:'wu-chart-axis','aria-hidden':'true',children:[i.jsx('span',{children:dayLabel(days[0].day)}),i.jsx('span',{children:'hoje'})]})]}):null,
      Array.isArray(data.topContactsToday)&&data.topContactsToday.length?i.jsxs('div',{className:'wu-top',children:[
        i.jsx('p',{className:'wu-label',children:'Contatos com mais respostas hoje'}),
        i.jsx('ol',{children:data.topContactsToday.map((c,k)=>i.jsxs('li',{children:[i.jsx('span',{className:'wu-mono',children:c.contact}),i.jsx('span',{children:fmt(c.responses)})]},k))})]}):null]});
  }

  function toForm(l){
    const bh=l?.businessHours||{},week={};
    for(const[k]of DAYS){const r=Array.isArray(bh.week?.[k])?bh.week[k]:[];const f=r[0]||['09:00','18:00'];week[k]={open:r.length>0,start:f[0],end:f[1]==='24:00'?'00:00':f[1],extra:r.slice(1)};}
    const known=PLANS.some(p=>p[0]===l?.planName);
    return{plan:known?l.planName:l?.monthlyResponses?'Personalizado':'none',monthly:l?.monthlyResponses??'',daily:l?.dailyResponses??'',perContact:l?.perContactDailyResponses??'',
      action:l?.overLimitAction||'continue',overMsg:l?.overLimitMessage||'',alert:l?.alertPercent??80,mode:bh.enabled?bh.mode||'always':'always',tz:bh.timezone||'America/Sao_Paulo',week,outsideMsg:l?.outsideHoursMessage||''};
  }
  const num=v=>v===''||v==null?null:Number(v);
  function toBody(f){
    return{planName:f.plan==='none'?null:f.plan,monthlyResponses:f.plan==='none'?null:num(f.monthly),dailyResponses:num(f.daily),perContactDailyResponses:num(f.perContact),
      overLimitAction:f.action,overLimitMessage:f.overMsg.trim()||null,alertPercent:Number(f.alert)||80,
      businessHours:{enabled:f.mode!=='always',mode:f.mode,timezone:f.tz,week:Object.fromEntries(DAYS.map(([k])=>[k,f.week[k].open?[[f.week[k].start,f.week[k].end],...f.week[k].extra]:[]]))},
      outsideHoursMessage:f.outsideMsg.trim()||null};
  }
  function problems(f){
    const e=[],int=v=>v===''||(/^\d+$/.test(String(v))&&Number(v)>=1);
    if(f.plan==='Personalizado'&&f.monthly==='')e.push('Informe quantas respostas por mês o plano personalizado inclui.');
    if(!int(f.monthly))e.push('Respostas por mês: use um número inteiro a partir de 1.');
    if(!int(f.daily))e.push('Limite por dia: use um número inteiro a partir de 1, ou deixe vazio.');
    if(!int(f.perContact))e.push('Limite por contato: use um número inteiro a partir de 1, ou deixe vazio.');
    if(f.daily!==''&&f.perContact!==''&&Number(f.perContact)>Number(f.daily))e.push('O limite por contato não pode ser maior que o limite por dia.');
    if(!/^\d+$/.test(String(f.alert))||Number(f.alert)<1||Number(f.alert)>100)e.push('Alerta: use um percentual de 1 a 100.');
    if(f.action==='message'&&!f.overMsg.trim())e.push('Escreva a mensagem que o cliente recebe quando a IA passar do limite.');
    if(f.mode!=='always'){const open=DAYS.filter(([k])=>f.week[k].open);if(!open.length)e.push('Marque pelo menos um dia de atendimento.');
      for(const[k,lb]of open){const d=f.week[k];if(!d.start||!d.end)e.push(lb+': preencha início e fim.');else if(d.start===d.end)e.push(lb+': início e fim iguais.');}}
    return e;
  }

  function Field({id,label,hint,children}){return i.jsxs('div',{className:'wu-field',children:[i.jsx('label',{htmlFor:id,className:'wu-label',children:label}),children,hint?i.jsx('p',{className:'wu-hint',id:id+'-hint',children:hint}):null]});}

  function Page(){
    const{instance:g}=ct(),name=g?.name;
    const summary=useSummary(name);
    const[base,setBase]=y.useState(null),[form,setForm]=y.useState(null),[loadError,setLoadError]=y.useState(''),[saving,setSaving]=y.useState(!1),[saveError,setSaveError]=y.useState(''),[tried,setTried]=y.useState(!1);
    const loadLimits=y.useCallback(async()=>{if(!name)return;setLoadError('');try{const r=await Ee.get('/usage/limits/'+encodeURIComponent(name));const f=toForm(r.data?.limits);setBase(f);setForm(f)}catch(e){setLoadError(errText(e))}},[name]);
    y.useEffect(()=>{loadLimits()},[loadLimits]);
    if(!g)return null;
    const header=i.jsxs('header',{className:'wu-head',children:[i.jsx('h1',{className:'wu-title',children:'Plano e limites'}),
      i.jsx('p',{className:'wu-muted',children:'Quantas respostas a IA deu, quanto o plano inclui e quando a IA pode responder. Uma resposta é cada vez que a IA responde uma mensagem (ou uma sequência de mensagens seguidas) do cliente.'})]});
    const usage=summary.data?i.jsx(Usage,{data:summary.data,onReload:summary.reload,loading:summary.loading}):summary.error?i.jsxs('div',{className:'wu-callout','data-tone':'bad',role:'alert',children:[i.jsx('p',{children:summary.error}),i.jsx('button',{type:'button',className:'wu-btn',onClick:summary.reload,children:'Tentar de novo'})]}):i.jsx('div',{className:'wu-card wu-skeleton','aria-busy':'true',children:i.jsx('span',{className:'sr-only',children:'Carregando o uso…'})});
    if(!form)return i.jsxs('main',{className:'wu-page',children:[header,usage,loadError?i.jsxs('div',{className:'wu-callout','data-tone':'bad',role:'alert',children:[i.jsx('p',{children:loadError}),i.jsx('button',{type:'button',className:'wu-btn',onClick:loadLimits,children:'Tentar de novo'})]}):null]});
    const set=patch=>{setForm(f=>({...f,...patch}));setSaveError('')};
    const setDay=(k,patch)=>setForm(f=>({...f,week:{...f.week,[k]:{...f.week[k],...patch}}}));
    const copyAll=k=>setForm(f=>{const src=f.week[k],week={};for(const[d]of DAYS)week[d]={...f.week[d],open:src.open,start:src.start,end:src.end};return{...f,week}});
    const errors=problems(form),dirty=JSON.stringify(toBody(form))!==JSON.stringify(toBody(base));
    const save=async ev=>{ev.preventDefault();setTried(!0);if(errors.length)return;setSaving(!0);setSaveError('');
      try{const r=await Ee.post('/usage/limits/'+encodeURIComponent(name),toBody(form));const f=toForm(r.data?.limits);setBase(f);setForm(f);setTried(!1);me.success('Plano e limites salvos.');summary.reload()}
      catch(e){const t=errText(e);setSaveError(t);me.error(t)}finally{setSaving(!1)}};
    const preset=PLANS.find(p=>p[0]===form.plan);
    return i.jsxs('main',{className:'wu-page',children:[header,usage,
      i.jsxs('form',{className:'wu-form',onSubmit:save,noValidate:!0,children:[
        i.jsxs('section',{className:'wu-card','aria-labelledby':'wu-plan-title',children:[
          i.jsx('h2',{id:'wu-plan-title',className:'wu-card-title',children:'Plano'}),
          i.jsxs('fieldset',{className:'wu-fieldset',children:[i.jsx('legend',{className:'wu-label',children:'Plano contratado'}),
            i.jsx('div',{className:'wu-plans',children:PLANS.map(([id,lb,n])=>i.jsxs('label',{className:'wu-plan','data-checked':form.plan===id?'true':void 0,children:[
              i.jsx('input',{type:'radio',name:'wu-plan',value:id,checked:form.plan===id,onChange:()=>set({plan:id,monthly:n??(id==='none'?'':form.monthly)})}),
              i.jsx('span',{className:'wu-plan-name',children:lb}),i.jsx('span',{className:'wu-plan-n',children:n?fmt(n)+' respostas/mês':id==='none'?'IA sem franquia':'você define'})]},id))})]}),
          i.jsxs('div',{className:'wu-grid',children:[
            i.jsx(Field,{id:'wu-monthly',label:'Respostas por mês',hint:form.plan==='none'?'Sem limite: a IA responde sem franquia (a contagem continua).':'Franquia do mês. Mudar o número torna o plano Personalizado.',children:i.jsx('input',{id:'wu-monthly',className:'wu-input',type:'number',inputMode:'numeric',min:1,step:1,disabled:form.plan==='none',value:form.plan==='none'?'':form.monthly,'aria-describedby':'wu-monthly-hint',onChange:ev=>{const v=ev.target.value;set({monthly:v,plan:preset&&preset[2]&&Number(v)!==preset[2]?'Personalizado':form.plan})}})}),
            i.jsx(Field,{id:'wu-daily',label:'Limite por dia',hint:'Vazio = sem limite diário.',children:i.jsx('input',{id:'wu-daily',className:'wu-input',type:'number',inputMode:'numeric',min:1,step:1,placeholder:'Sem limite',value:form.daily,'aria-describedby':'wu-daily-hint',onChange:ev=>set({daily:ev.target.value})})}),
            i.jsx(Field,{id:'wu-contact',label:'Limite por contato por dia',hint:'Protege contra conversas em loop. Vazio = sem limite.',children:i.jsx('input',{id:'wu-contact',className:'wu-input',type:'number',inputMode:'numeric',min:1,step:1,placeholder:'Sem limite',value:form.perContact,'aria-describedby':'wu-contact-hint',onChange:ev=>set({perContact:ev.target.value})})}),
            i.jsx(Field,{id:'wu-alert',label:'Alerta na Observabilidade (%)',hint:'Avisa quando o mês passar deste percentual da franquia (e de novo em 100%).',children:i.jsx('input',{id:'wu-alert',className:'wu-input',type:'number',inputMode:'numeric',min:1,max:100,step:1,value:form.alert,'aria-describedby':'wu-alert-hint',onChange:ev=>set({alert:ev.target.value})})})]})]}),
        i.jsxs('section',{className:'wu-card','aria-labelledby':'wu-over-title',children:[
          i.jsx('h2',{id:'wu-over-title',className:'wu-card-title',children:'Quando passar da franquia do mês'}),
          i.jsxs('fieldset',{className:'wu-fieldset',children:[i.jsx('legend',{className:'sr-only',children:'Ação ao passar da franquia'}),
            ACTIONS.map(([id,lb,tx])=>i.jsxs('label',{className:'wu-option','data-checked':form.action===id?'true':void 0,children:[
              i.jsx('input',{type:'radio',name:'wu-action',value:id,checked:form.action===id,onChange:()=>set({action:id})}),
              i.jsxs('span',{children:[i.jsx('span',{className:'wu-option-title',children:lb}),i.jsx('span',{className:'wu-hint',children:tx})]})]},id))]}),
          form.action==='message'?i.jsx(Field,{id:'wu-overmsg',label:'Mensagem para o cliente',children:i.jsx('textarea',{id:'wu-overmsg',className:'wu-input wu-textarea',rows:3,maxLength:1000,placeholder:'Ex.: Nosso atendimento automático está indisponível agora. A equipe vai responder assim que possível.',value:form.overMsg,onChange:ev=>set({overMsg:ev.target.value})})}):null,
          i.jsx('p',{className:'wu-hint',children:'Os limites por dia e por contato sempre pausam a IA até o dia seguinte; com "Enviar uma mensagem", a mesma mensagem é enviada.'})]}),
        i.jsxs('section',{className:'wu-card','aria-labelledby':'wu-hours-title',children:[
          i.jsx('h2',{id:'wu-hours-title',className:'wu-card-title',children:'Horário de atendimento'}),
          i.jsxs('fieldset',{className:'wu-fieldset',children:[i.jsx('legend',{className:'sr-only',children:'Quando a IA responde'}),
            MODES.map(([id,lb,tx])=>i.jsxs('label',{className:'wu-option','data-checked':form.mode===id?'true':void 0,children:[
              i.jsx('input',{type:'radio',name:'wu-mode',value:id,checked:form.mode===id,onChange:()=>set({mode:id})}),
              i.jsxs('span',{children:[i.jsx('span',{className:'wu-option-title',children:lb}),i.jsx('span',{className:'wu-hint',children:tx})]})]},id))]}),
          form.mode!=='always'?i.jsxs('div',{className:'wu-hours',children:[
            i.jsx(Field,{id:'wu-tz',label:'Fuso horário',children:i.jsx('select',{id:'wu-tz',className:'wu-input',value:form.tz,onChange:ev=>set({tz:ev.target.value}),children:(ZONES.includes(form.tz)?ZONES:[form.tz,...ZONES]).map(z=>i.jsx('option',{value:z,children:z.replace('America/','').replace(/_/g,' ')},z))})}),
            i.jsx('div',{className:'wu-week',role:'group','aria-label':'Horário por dia',children:DAYS.map(([k,lb])=>{const d=form.week[k],night=d.open&&d.start&&d.end&&d.end<d.start;return i.jsxs('div',{className:'wu-day','data-open':d.open?'true':void 0,children:[
              i.jsxs('label',{className:'wu-day-name',children:[i.jsx('input',{type:'checkbox',checked:d.open,onChange:ev=>setDay(k,{open:ev.target.checked})}),i.jsx('span',{children:lb})]}),
              d.open?i.jsxs('span',{className:'wu-day-times',children:[
                i.jsx('input',{type:'time',className:'wu-input wu-time',step:60,value:d.start,'aria-label':lb+': início',onChange:ev=>setDay(k,{start:ev.target.value})}),
                i.jsx('span',{className:'wu-muted','aria-hidden':'true',children:'às'}),
                i.jsx('input',{type:'time',className:'wu-input wu-time',step:60,value:d.end,'aria-label':lb+': fim',onChange:ev=>setDay(k,{end:ev.target.value})}),
                night?i.jsx('span',{className:'wu-hint',children:'termina no dia seguinte'}):null,
                d.extra.length?i.jsx('span',{className:'wu-hint',children:'+'+d.extra.length+' faixa(s) definida(s) pela API'}):null]}):i.jsx('span',{className:'wu-muted',children:'Fechado'}),
              i.jsx('button',{type:'button',className:'wu-btn wu-btn-ghost wu-copy',onClick:()=>copyAll(k),'aria-label':'Copiar o horário de '+lb+' para todos os dias',children:'Copiar para todos'})]},k)})}),
            form.mode==='inside'?i.jsx(Field,{id:'wu-outmsg',label:'Mensagem fora do horário (opcional)',hint:'Enviada no máximo uma vez por dia por contato. Vazio = a IA fica em silêncio fora do horário.',children:i.jsx('textarea',{id:'wu-outmsg',className:'wu-input wu-textarea',rows:3,maxLength:1000,placeholder:'Ex.: Olá! Atendemos de segunda a sexta, das 9h às 18h. Respondemos assim que abrirmos.',value:form.outsideMsg,'aria-describedby':'wu-outmsg-hint',onChange:ev=>set({outsideMsg:ev.target.value})})}):null]}):null]}),
        (tried&&errors.length)||saveError?i.jsx('div',{className:'wu-callout','data-tone':'bad',role:'alert',children:i.jsx('ul',{children:(saveError?[saveError]:errors).map((t,k)=>i.jsx('li',{children:t},k))})}):null,
        i.jsxs('div',{className:'wu-actions',children:[
          i.jsx('button',{type:'button',className:'wu-btn wu-btn-ghost',disabled:!dirty||saving,onClick:()=>{setForm(base);setSaveError('');setTried(!1)},children:'Descartar alterações'}),
          i.jsx('button',{type:'submit',className:'wu-btn wu-btn-primary',disabled:!dirty||saving,'aria-busy':saving?'true':void 0,children:saving?'Salvando…':'Salvar'})]})]})]});
  }
  return {Page,Bar,Icon};
})();

'''

ROUTE_OLD = '{path:"/manager/instance/:instanceId/dashboard",element:i.jsx(tn,{children:i.jsx(un,{children:i.jsx(PX,{})})})},'
ROUTE_NEW = ROUTE_OLD + '{path:"/manager/instance/:instanceId/usage",element:i.jsx(tn,{children:i.jsx(un,{children:i.jsx(WaUsage.Page,{})})})},'


def patch_component(s):
    return rep(s, '})();\n\nconst Lse=Z2([', '})();\n\n' + COMPONENT + 'const Lse=Z2([', 'route table (after WhatsAIObservability)')


def patch_route(s):
    return rep(s, ROUTE_OLD, ROUTE_NEW, 'instance dashboard route')


def patch_sidebar(s):
    old = '{id:"chat",title:e("sidebar.chat"),icon:Bl,path:"chat"},'
    return rep(s, old, old + '{id:"usage",title:"Plano e limites",icon:WaUsage.Icon,path:"usage"},', 'sidebar Conversas item')


def patch_dashboard(s):
    return rep(s, 'children:n.format(M.messages)})]})]})]}):i.jsx(On,{})}',
               'children:n.format(M.messages)})]})]}),i.jsx(WaUsage.Bar,{instance:g})]}):i.jsx(On,{})}',
               'Visão Geral metric cards (run dashboard-ui.py first)')


GROUPS = [('component', patch_component), ('route', patch_route), ('sidebar', patch_sidebar),
          ('dashboard', patch_dashboard)]


def patch_html(html):
    pos = html.find(CSS_ANCHOR)
    if pos < 0 or html.count(CSS_ANCHOR) != 1:
        raise PatchError('index.html: minimal.css link not found exactly once (run minimal.py first)')
    end = html.index('\n', pos) + 1
    return html[:end] + '    ' + html_marker('html') + '\n    <link rel="stylesheet" href="/assets/usage-limits.css?v=1" />\n' + html[end:]


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
        missing.append('usage-limits.css')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/usage-limits.css is missing')
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
        report.append(f'index.html written (usage-limits.css ?v=1, bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
