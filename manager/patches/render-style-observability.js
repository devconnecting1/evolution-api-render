// UI part of the "Observabilidade" component that manager/patches/render-style.py writes into the bundle
// (inside WhatsAIObservability, after the helpers kept in OBS_NEW of the script). Not loaded by any page:
// the text between the ui markers is copied verbatim. Minified names of the bundle: i = jsx runtime,
// y = React, bd = axios instance of the API, Cj = Navigate, Fu = Link.
/* eslint-disable */
/*ui:start*/
  function ObsStatus({status,label}){return i.jsxs('span',{className:'wo-pill','data-tone':statusTone(status),children:[i.jsx('span',{className:'wo-dot','aria-hidden':'true'}),label||statusLabel(status)]});}
  function ObsCallout({tone,title,children,role}){return i.jsxs('div',{className:'wo-callout','data-tone':tone,role,children:[title?i.jsx('p',{className:'wo-callout-title',children:title}):null,(Array.isArray(children)?i.jsxs:i.jsx)('div',{className:'wo-callout-body',children})]});}
  function ObsMetric({metric:m}){
    const percent=clamp(m.percent);
    const legend=[m.limit!=null?`de ${metricValue(m.limit,m.unit)}`:'',percent!=null?`${num(m.percent,0)}%`:''].filter(Boolean).join(' · ');
    return i.jsxs('div',{className:'wo-metric','data-status':m.status||'unknown',children:[
      i.jsx('div',{className:'wo-metric-label',children:m.label}),
      i.jsx('div',{className:'wo-metric-value',children:metricValue(m.used,m.unit)}),
      percent!=null?i.jsx('div',{className:'wo-bar','aria-hidden':'true',children:i.jsx('span',{style:{width:`${percent}%`}})}):null,
      legend?i.jsx('div',{className:'wo-metric-legend',children:legend}):null,
      m.detail?i.jsx('div',{className:'wo-metric-detail',children:m.detail}):null]});
  }
  function ObsResources({resources}){
    return i.jsx('div',{className:'wo-table-wrap',children:i.jsxs('table',{className:'wo-table',children:[
      i.jsx('thead',{children:i.jsxs('tr',{children:[i.jsx('th',{scope:'col',children:'Recurso'}),i.jsx('th',{scope:'col',children:'Status'}),i.jsx('th',{scope:'col',children:i.jsx('span',{className:'sr-only',children:'Ação'})})]})}),
      i.jsx('tbody',{children:resources.map(r=>{
        const url=safeUrl(r.url);
        const meta=[r.type,r.plan,r.region].filter(Boolean).join(' · ');
        return i.jsxs('tr',{children:[
          i.jsxs('td',{className:'wo-res-name',children:[i.jsx('span',{className:'wo-res-title',children:r.name}),meta?i.jsx('span',{className:'wo-res-meta',children:meta}):null,r.detail?i.jsx('span',{className:'wo-res-meta',children:r.detail}):null]}),
          i.jsx('td',{className:'wo-res-status',children:r.status?i.jsxs('span',{className:'wo-pill','data-tone':resourceTone(r.status),children:[i.jsx('span',{className:'wo-dot','aria-hidden':'true'}),r.status]}):'—'}),
          i.jsx('td',{className:'wo-res-action',children:url?i.jsxs('a',{className:'wo-btn wo-btn-sm',href:url,target:'_blank',rel:'noopener noreferrer',children:['Abrir',i.jsx('span',{className:'sr-only',children:` ${r.name} (abre em nova aba)`})]}):null})]},r.id||r.name);
      })})]})});
  }
  function ObsMissing({provider:p}){
    const notes=Array.isArray(p.notes)?p.notes:[];
    const envLine=notes.find(n=>String(n).startsWith('Variáveis necessárias:'))||'';
    const text=notes.find(n=>n!==envLine)||'Configure as variáveis para ativar este provedor.';
    return i.jsxs(ObsCallout,{tone:'warn',title:'Não configurado',children:[i.jsx('p',{children:text}),envLine?i.jsx('code',{className:'wo-env',children:envLine.replace('Variáveis necessárias: ','').replace(/\.$/,'')}):null]});
  }
  function ObsProviderCard({provider:p}){
    const configured=p.configured!==false;
    const status=p.status||'missing';
    const metrics=Array.isArray(p.metrics)?p.metrics.filter(Boolean):[];
    const resources=Array.isArray(p.resources)?p.resources.filter(Boolean):[];
    const notes=(Array.isArray(p.notes)?p.notes.filter(Boolean):[]).filter(n=>!String(n).startsWith('Variáveis necessárias:'));
    const links=Array.isArray(p.links)?p.links.map(l=>({...l,url:safeUrl(l.url)})).filter(l=>l.url):[];
    const titleId=`obs-provider-${p.id}-title`;
    return i.jsxs('section',{className:'wo-card',id:`obs-provider-${p.id}`,tabIndex:-1,'aria-labelledby':titleId,'data-status':status,children:[
      i.jsxs('header',{className:'wo-card-head',children:[
        i.jsxs('div',{className:'wo-card-id',children:[i.jsx('span',{className:'wo-mark','aria-hidden':'true',children:mark(p)}),
          i.jsxs('div',{className:'wo-card-copy',children:[i.jsx('h2',{className:'wo-card-title',id:titleId,children:p.name}),p.description?i.jsx('p',{className:'wo-card-desc',children:p.description}):null]})]}),
        i.jsxs('div',{className:'wo-card-badges',children:[p.plan?i.jsx('span',{className:'wo-tag',children:p.plan}):null,i.jsx(ObsStatus,{status})]})]}),
      i.jsxs('div',{className:'wo-card-body',children:[
        p.error?i.jsx(ObsCallout,{tone:'bad',title:'Erro na consulta',children:i.jsx('p',{children:p.error})}):null,
        !configured?i.jsx(ObsMissing,{provider:p}):null,
        metrics.length?i.jsx('div',{className:'wo-metrics',children:metrics.map(m=>i.jsx(ObsMetric,{metric:m},m.id))}):configured&&!p.error?i.jsx('p',{className:'wo-empty',children:'Nenhuma métrica disponível para este provedor.'}):null,
        resources.length?i.jsx(ObsResources,{resources}):null,
        configured&&notes.length?i.jsx('ul',{className:'wo-notes',children:notes.map((n,idx)=>i.jsx('li',{children:n},idx))}):null]}),
      links.length?i.jsx('footer',{className:'wo-card-foot',children:links.map(l=>i.jsxs('a',{className:'wo-btn wo-btn-sm',href:l.url,target:'_blank',rel:'noopener noreferrer',children:[l.label,svg(ICON_EXTERNAL,'wo-ico'),i.jsx('span',{className:'sr-only',children:' (abre em nova aba)'})]},l.url))}):null]});
  }
  function alertOver(a){const n=Number(a&&a.percent);return Number.isFinite(n)&&n>=100;}function alertNeonDate(p){const notes=(Array.isArray(p&&p.notes)?p.notes:[]).map(String);for(const n of notes){const m=n.match(/por volta de (\d{2}\/\d{2})/);if(m)return `por volta de ${m[1]}`;}for(const n of notes){const m=n.match(/por volta do dia (\d{1,2})/);if(!m)continue;const end=notes.map(x=>x.match(/termina em (\d{2})\/(\d{2})/)).find(Boolean);if(!end)return `por volta do dia ${m[1]} do próximo mês`;const next=new Date(new Date().getFullYear(),Number(end[2])-1,Number(end[1])+1);return `por volta de ${String(m[1]).padStart(2,'0')}/${String(next.getMonth()+1).padStart(2,'0')}`;}return null;}function alertText(a,p){const name=p&&p.name||a.provider||'Provedor';const m=(Array.isArray(p&&p.metrics)?p.metrics:[]).find(x=>x&&x.id===a.metric)||{};const unit=m.unit||'number';const has=m.used!=null&&m.limit!=null;const amount=has?`${unit==='bytes'?metricValue(m.used,unit):num(m.used)} de ${metricValue(m.limit,unit)}`:'';const pct=`${num(a.percent,0)}%`;const over=alertOver(a);const neon=a.provider==='neon';if(/_projection$/.test(String(a.metric||''))){const base=`${name}: projeção de ${amount||pct+' do limite'}${has?' no mês':''}`;if(!over)return `${base} — perto do limite`;if(neon){const when=alertNeonDate(p);return `${base} — o banco será suspenso ${when||'antes do fim do mês'}`;}return `${base} — passa do limite antes do fim do mês`;}const what=String(a.label||m.label||a.metric||'Uso');if(over){const tail=neon&&(a.metric==='compute'||a.metric==='egress')?' — o banco fica suspenso até o próximo período':'';return `${name}: ${what} atingiu o limite${amount?` (${amount})`:''}${tail}`;}return `${name}: ${what} em ${pct} do limite${amount?` (${amount})`:''}`;}function alertGo(e,id){const el=document.getElementById(id);if(!el)return;e.preventDefault();el.scrollIntoView({behavior:window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});try{el.focus({preventScroll:true});}catch{}}
  function ObsAlerts({alerts,providers}){
    const list=Array.isArray(alerts)?alerts.filter(a=>a&&a.provider):[];
    if(!list.length)return null;
    const over=list.some(alertOver);
    const byId=Object.fromEntries((providers||[]).map(p=>[p.id,p]));
    const title=over?(list.length===1?'1 limite estourado ou projetado acima do limite':`${list.length} alertas de limite — pelo menos um acima do limite`):(list.length===1?'1 alerta: perto do limite':`${list.length} alertas: perto do limite`);
    return i.jsxs('div',{className:'wo-banner','data-tone':over?'bad':'warn',role:'region','aria-labelledby':'observability-alerts-title',id:'observability-alerts','data-wa-alerts':over?'over':'near',children:[
      svg(ICON_ALERT,'wo-banner-ico'),
      i.jsxs('div',{className:'wo-banner-copy',children:[i.jsx('p',{id:'observability-alerts-title',className:'wo-banner-title',children:title}),
        i.jsx('ul',{className:'wo-banner-list',children:list.map((a,idx)=>{const p=byId[a.provider];const target=`obs-provider-${a.provider}`;const o=alertOver(a);
          return i.jsxs('li',{children:[i.jsx('span',{className:'wo-pill','data-tone':o?'bad':'warn',children:o?'Acima do limite':'Perto do limite'}),i.jsx('span',{className:'wo-banner-text',children:alertText(a,p)}),
            p?i.jsx('a',{href:`#${target}`,className:'wo-link',onClick:e=>alertGo(e,target),children:`Ver ${p.name||'card'}`}):null]},`${a.provider}:${a.metric}:${idx}`);})})]})]});
  }
  function ObsSkeleton(){
    const bar=(cls)=>i.jsx('span',{className:`wa-sk ${cls}`});
    return i.jsxs('div',{className:'wo-skeleton','aria-busy':'true',children:[
      i.jsx('span',{className:'sr-only',role:'status',children:'Carregando dados de observabilidade'}),
      i.jsx('div',{className:'wo-summary','aria-hidden':'true',children:[0,1,2,3].map(k=>i.jsxs('div',{className:'wo-stat',children:[bar('wa-sk-label'),bar('wa-sk-value')]},k))}),
      i.jsx('div',{className:'wo-grid','aria-hidden':'true',children:[0,1,2,3].map(k=>i.jsxs('div',{className:'wo-card wa-sk-card',children:[
        i.jsxs('div',{className:'wo-card-head',children:[i.jsxs('div',{className:'wo-card-id',children:[bar('wa-sk-mark'),i.jsxs('div',{className:'wo-card-copy',children:[bar('wa-sk-title'),bar('wa-sk-text')]})]}),bar('wa-sk-pill')]}),
        i.jsxs('div',{className:'wo-card-body',children:[i.jsx('div',{className:'wo-metrics',children:[0,1,2,3].map(n=>i.jsxs('div',{className:'wo-metric',children:[bar('wa-sk-label'),bar('wa-sk-value'),bar('wa-sk-bar')]},n))}),
          i.jsxs('div',{className:'wa-sk-rows',children:[bar('wa-sk-row'),bar('wa-sk-row')]})]})]},k))})]});
  }
  function ObsRedirect(){const id=localStorage.getItem('instanceId');return i.jsx(Cj,{to:id?`/manager/instance/${id}/observability`:'/manager/observability',replace:true});}
  function ObservabilityPage({nested}){
    const Root=nested?'div':'main';
    const [cached]=y.useState(()=>readCache());
    const [data,setData]=y.useState(cached?cached.data:null);
    const [staleAt,setStaleAt]=y.useState(cached?Number(cached.savedAt):0);
    const [error,setError]=y.useState('');
    const [refreshing,setRefreshing]=y.useState(false);
    const [updatedAt,setUpdatedAt]=y.useState(0);
    const [now,setNow]=y.useState(Date.now());
    const inFlight=y.useRef(false);
    const alive=y.useRef(true);
    const updatedRef=y.useRef(0);
    const load=y.useCallback(async force=>{
      if(inFlight.current)return;
      inFlight.current=true;
      setRefreshing(true);
      try{
        const response=await bd.get('/observability',{params:force?{refresh:1}:undefined});
        if(!alive.current)return;
        const body=response.data;
        if(!body||!Array.isArray(body.providers))throw new Error('Resposta inválida da API de observabilidade.');
        setData(body);setError('');setStaleAt(0);
        const t=Date.now();setUpdatedAt(t);setNow(t);updatedRef.current=t;
        writeCache(body);
      }catch(err){
        if(!alive.current)return;
        const status=err?.response?.status;
        const message=status===401||status===403?'Sessão expirada ou sem permissão. Entre novamente no painel.':err?.response?.data?.message||err?.response?.data?.error||err?.message||'Não foi possível carregar a observabilidade.';
        setError(String(message));
      }finally{
        if(alive.current)setRefreshing(false);
        inFlight.current=false;
      }
    },[]);
    y.useEffect(()=>{
      alive.current=true;
      load(false);
      const timer=setInterval(()=>{if(!document.hidden)load(false);},60000);
      const tick=setInterval(()=>setNow(Date.now()),15000);
      const visibility=()=>{if(!document.hidden&&updatedRef.current&&Date.now()-updatedRef.current>60000)load(false);};
      document.addEventListener('visibilitychange',visibility);
      return ()=>{alive.current=false;clearInterval(timer);clearInterval(tick);document.removeEventListener('visibilitychange',visibility);};
    },[load]);
    const providers=Array.isArray(data?.providers)?data.providers:[];
    const missing=providers.filter(p=>p.status==='missing').length;
    const issues=providers.filter(p=>p.status==='partial'||p.status==='error').length;
    const errors=providers.filter(p=>p.status==='error').length;
    const okCount=providers.filter(p=>p.status==='ok').length;
    const shownAt=staleAt||updatedAt;
    const label=staleAt?(refreshing?`Dados de ${clock(staleAt)} · atualizando…`:`Dados de ${clock(staleAt)}`):refreshing&&data?'Atualizando…':updatedAt?relative(updatedAt,now):'';
    const header=i.jsxs('div',{className:'wo-head',children:[
      i.jsx('nav',{className:'wo-crumbs','aria-label':'Trilha de navegação',children:i.jsxs('ol',{children:[i.jsx('li',{children:i.jsx(Fu,{to:'/manager/',children:'Instâncias'})}),i.jsx('li',{'aria-current':'page',children:'Observabilidade'})]})}),
      i.jsxs('div',{className:'wo-head-row',children:[
        i.jsxs('div',{className:'wo-head-copy',children:[i.jsx('h1',{className:'wo-title',children:'Observabilidade'}),i.jsx('p',{className:'wo-sub',children:'Storage, compute, deploys e limites dos provedores em um só lugar. Sem abrir vários dashboards.'})]}),
        i.jsxs('div',{className:'wo-actions',children:[
          label?i.jsx('span',{className:'wo-updated','aria-live':'polite','data-stale':staleAt?'true':void 0,children:label}):null,
          i.jsxs('button',{type:'button',className:'wo-btn','data-busy':refreshing?'true':void 0,onClick:()=>load(true),disabled:refreshing,children:[svg(ICON_REFRESH,refreshing?'wo-ico wo-spin':'wo-ico'),refreshing?'Atualizando…':'Atualizar']})]})]})]});
    if(!data)
      return i.jsxs(Root,{className:'wo-page',children:[header,
        error?i.jsx(ObsCallout,{tone:'bad',title:'Falha ao carregar',role:'alert',children:i.jsx('p',{children:error})}):i.jsx(ObsSkeleton,{})]});
    const config=e=>{const d=document.getElementById('observability-config');if(d){e.preventDefault();d.open=true;d.scrollIntoView({behavior:'smooth',block:'start'});}};
    return i.jsxs(Root,{className:'wo-page','aria-busy':refreshing?'true':void 0,children:[
      header,
      error?i.jsx(ObsCallout,{tone:'bad',title:'Falha ao atualizar',role:'alert',children:i.jsxs('p',{children:[error,shownAt?` Mostrando os dados de ${clock(shownAt)}.`:'']})}):null,
      i.jsx(ObsAlerts,{alerts:data?.alerts,providers}),
      i.jsxs('dl',{className:'wo-summary',children:[
        i.jsxs('div',{className:'wo-stat',children:[i.jsx('dt',{children:'Provedores'}),i.jsx('dd',{children:providers.length})]}),
        i.jsxs('div',{className:'wo-stat',children:[i.jsx('dt',{children:'Operacionais'}),i.jsx('dd',{children:okCount})]}),
        i.jsxs('div',{className:'wo-stat','data-tone':missing?'warn':void 0,children:[i.jsx('dt',{children:'Sem chave'}),i.jsx('dd',{children:missing})]}),
        i.jsxs('div',{className:'wo-stat','data-tone':issues?'warn':void 0,children:[i.jsx('dt',{children:'Com alerta'}),i.jsx('dd',{children:issues})]})]}),
      !error&&errors?i.jsx(ObsCallout,{tone:'bad',title:'Provedores com erro',children:i.jsx('p',{children:`${errors} provedor(es) com erro de consulta. Veja os detalhes nos cards.`})}):
      !error&&missing?i.jsx(ObsCallout,{tone:'warn',title:'Chaves pendentes',children:i.jsxs('p',{children:[`${missing} provedor(es) sem chave. `,i.jsx('a',{href:'#observability-config',className:'wo-link',onClick:config,children:'Configure as variáveis'}),' para liberar os dados.']})}):null,
      providers.length?i.jsx('div',{className:'wo-grid',children:providers.map(p=>i.jsx(ObsProviderCard,{provider:p},p.id))}):i.jsx('p',{className:'wo-empty wo-empty-box',children:'Nenhum provedor retornado pela API.'}),
      i.jsxs('details',{id:'observability-config',className:'wo-help',children:[
        i.jsx('summary',{children:'Como configurar as chaves'}),
        i.jsxs('div',{className:'wo-help-body',children:[
          i.jsx('p',{children:'As chaves ficam somente no backend (Render). Nunca coloque tokens no navegador ou no repositório.'}),
          i.jsxs('ul',{children:[
            i.jsx('li',{children:'Neon: NEON_API_KEY, NEON_PROJECT_ID e, opcionalmente, NEON_ORG_ID.'}),
            i.jsx('li',{children:'Render: RENDER_API_KEY e, opcionalmente, RENDER_OWNER_ID ou RENDER_SERVICE_IDS.'}),
            i.jsx('li',{children:'Vercel: VERCEL_TOKEN, VERCEL_TEAM_ID e VERCEL_PROJECT_ID.'}),
            i.jsx('li',{children:'GitHub (opcional): GITHUB_TOKEN (fine-grained, Actions: read e Plan: read) e, para outro repositório, GITHUB_OWNER e GITHUB_REPO.'})]}),
          i.jsx('p',{children:'Depois de salvar as variáveis no Render, use Atualizar ou aguarde o próximo ciclo de 60 segundos.'})]})]}),
      i.jsxs('div',{className:'wo-foot',children:[i.jsx('span',{children:'Atualização automática a cada 60s.'}),i.jsx('span',{children:'Dados de consumo podem ter atraso e nem todo provedor expõe billing via API.'})]})]});
  }
/*ui:end*/
