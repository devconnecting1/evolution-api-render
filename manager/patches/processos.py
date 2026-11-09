#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Processos" page (court case monitoring, DataJud + DJEN).

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/processos.css (a plain file, edited by hand, only var(--m-*) tokens of
minimal.css; it also reuses the .wa-tw-* primitives of twenty-layout.css), linked right after the last stylesheet.

Backend (same release): /processos/:instanceName (list, add, bulk, badge, export.csv, settings, oab,
publicacoes, :id, :id/sync, :id/seen). Requests go through the bundle's axios instance (Ee: API URL + apikey).

Bundle groups (each one is applied once and leaves a marker comment at the top of the bundle):
  component - WaProc, an isolated component module (IIFE) placed right before the route table: Page (tabs
              Processos / Publicações (DJEN) / Configurações; Twenty-like table with Processo, Apelido/Cliente,
              Tribunal, Classe, Última movimentação, Atualizado and the status chip Em dia / Nova movimentação /
              Erro; views Todos · Com novidade · Arquivados with counts; Filtro (tribunal, período); search;
              "Adicionar processo" dialog for one or many numbers with live check-digit validation; side panel
              with the timeline (newest first), linked contact, toggles avisar equipe / avisar cliente / IA pode
              responder / segredo de justiça and "Sincronizar agora"; OAB watches and publications with "marcar
              como vista"; settings), NavIcon (sidebar icon + badge with the unseen count, refreshed every 2 min).
  route     - /manager/instance/:instanceId/processos inside the instance layout (same guards as the dashboard).
  sidebar   - "Processos" item inserted right before the "Configurações" group, i.e. after every item of the top
              section (Visão Geral, Conversas, Plano e limites and any item added later, such as Leads or Agenda).
index.html group (marker: an HTML comment in <head>):
  html      - links processos.css?v=1 after the last stylesheet link and bumps the bundle ?v= to CACHE_VERSION.

Anchors are chosen so that items or components added by other patches before or after this one do not break
them: the component goes before "const Lse=Z2([" (the route table), the route after the instance dashboard
route, the sidebar item before the "Configurações" nav label. Every anchor must match exactly once, otherwise
the script stops without writing anything. Re-running is safe: groups whose marker is present are skipped.
Order: run after root-redirect.py (and after any other patch).

Usage (from the repository root):
  python3 -I manager/patches/processos.py           # apply
  python3 -I manager/patches/processos.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'processos.css')
REQUIRED = ('/*whatsai-patch:root-redirect:v1*/',)
CACHE_VERSION = '25'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_LINK = '    <link rel="stylesheet" href="/assets/processos.css?v=1" />\n'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:processos:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:processos:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# Minified names (bundle index-b29a5d7a.js): i = jsx runtime, y = React, Ee = axios instance of the API (base URL +
# apikey), me = toast, ct = useInstance (instance context), tn = protected route, un = instance layout (sidebar).

COMPONENT = r'''const WaProc=(()=>{
  const nf=new Intl.NumberFormat('pt-BR');
  const P=d=>i.jsx('path',{d},d);
  function svg(paths,size){return i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:size||16,height:size||16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'1.75',strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',children:paths.map(P)});}
  const IC={scale:['M12 3v18','M7 21h10','M5 7h14','M5 7l-3 7a3.5 3.5 0 0 0 6 0Z','M19 7l-3 7a3.5 3.5 0 0 0 6 0Z'],x:['M18 6 6 18','m6 6 12 12'],filter:['M3 6h18','M7 12h10','M10 18h4'],plus:['M12 5v14','M5 12h14'],sync:['M21 12a9 9 0 1 1-3-6.7L21 8','M21 3v5h-5'],dl:['M12 3v12','m7 10 5 5 5-5','M5 21h14'],ext:['M15 3h6v6','M10 14 21 3','M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6']};
  const STATUS={em_dia:['ok','Em dia'],novidade:['warn','Nova movimentação'],erro:['bad','Erro'],aguardando:['','Aguardando consulta']};
  const enc=encodeURIComponent;
  const dBR=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})};
  const dtBR=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})};
  const dsBR=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})};
  function errText(e){const m=e?.response?.data?.response?.message??e?.response?.data?.message;const flat=[].concat(m??[]).flat(4).map(x=>typeof x==='string'?x:x&&x.message?String(x.message):'').filter(Boolean);if(flat.length)return flat.join(' ');if(e?.response?.status===404)return 'A API ainda não tem o recurso Processos: atualize o backend.';return 'Não foi possível falar com a API. Tente de novo em instantes.';}
  // CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO, DD = 98 - (N AAAA J TR OOOO 00 mod 97)
  const UF={'01':'ac','02':'al','03':'ap','04':'am','05':'ba','06':'ce','07':'df','08':'es','09':'go','10':'ma','11':'mt','12':'ms','13':'mg','14':'pa','15':'pb','16':'pr','17':'pe','18':'pi','19':'rj','20':'rn','21':'rs','22':'ro','23':'rr','24':'sc','25':'se','26':'sp','27':'to'};
  function alias(dg){const j=dg[13],tr=dg.slice(14,16),uf=UF[tr],n=Number(tr);if(j==='3')return'stj';if(j==='4')return n>=1&&n<=6?'trf'+n:null;if(j==='5')return tr==='00'?'tst':n>=1&&n<=24?'trt'+n:null;if(j==='6')return tr==='00'?'tse':uf?(uf==='df'?'tre-dft':'tre-'+uf):null;if(j==='7')return'stm';if(j==='8')return uf?(uf==='df'?'tjdft':'tj'+uf):null;if(j==='9')return{'13':'tjmmg','21':'tjmrs','26':'tjmsp'}[tr]||null;return null;}
  function checkCnj(raw){const dg=String(raw||'').replace(/\D/g,'');if(dg.length!==20)return{ok:!1,error:'precisa ter 20 dígitos'};let dv;try{dv=String(98n-BigInt(dg.slice(0,7)+dg.slice(9)+'00')%97n).padStart(2,'0')}catch(e){return{ok:!1,error:'número inválido'}}if(dv!==dg.slice(7,9))return{ok:!1,error:'dígito verificador não confere'};if(dg[13]==='1')return{ok:!1,error:'STF não está no DataJud'};const a=alias(dg);if(!a)return{ok:!1,error:'tribunal não identificado'};return{ok:!0,digits:dg,alias:a,formatted:dg.slice(0,7)+'-'+dg.slice(7,9)+'.'+dg.slice(9,13)+'.'+dg[13]+'.'+dg.slice(14,16)+'.'+dg.slice(16)};}
  function scan(text){const out=[],seen=new Set();for(const line of String(text||'').split(/\r?\n/)){const t=line.trim();if(!t)continue;const found=t.match(/\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/g);if(!found){out.push({input:t,ok:!1,error:'nenhum número CNJ'});continue}for(const f of found){const r=checkCnj(f);const k=r.digits||f;if(seen.has(k))continue;seen.add(k);out.push({input:f,...r})}}return out;}
  function Chip({status}){const s=STATUS[status]||STATUS.aguardando;return i.jsxs('span',{className:'wa-tw-badge','data-tone':s[0]||void 0,children:[i.jsx('span',{className:'wa-tw-badge-dot','aria-hidden':'true'}),s[1]]});}
  function Toggle({id,label,hint,checked,onChange,disabled}){return i.jsxs('label',{className:'wp-toggle',htmlFor:id,children:[i.jsx('input',{id,type:'checkbox',role:'switch',checked:!!checked,disabled,onChange:e=>onChange(e.target.checked)}),i.jsxs('span',{children:[i.jsx('span',{className:'wp-toggle-title',children:label}),hint?i.jsx('span',{className:'wa-tw-hint',children:hint}):null]})]});}

  function useBadge(name){const[n,setN]=y.useState(0);y.useEffect(()=>{if(!name)return;let alive=!0;const load=()=>Ee.get('/processos/'+enc(name)+'/badge').then(r=>{if(alive)setN(Number(r.data?.total)||0)}).catch(()=>{});load();const t=setInterval(load,12e4);const on=()=>load();window.addEventListener('wa-proc-refresh',on);return()=>{alive=!1;clearInterval(t);window.removeEventListener('wa-proc-refresh',on)}},[name]);return n;}
  function NavIcon({size}){const{instance:g}=ct();const n=useBadge(g?.name);return i.jsxs(i.Fragment,{children:[svg(IC.scale,Number(size)||15),n>0?i.jsxs('span',{className:'wp-nav-badge',children:[nf.format(n),i.jsx('span',{className:'sr-only',children:' novidades não vistas'})]}):null]});}
  const refresh=()=>{try{window.dispatchEvent(new Event('wa-proc-refresh'))}catch(e){}};

  function AddDialog({name,onClose,onDone}){
    const[text,setText]=y.useState(''),[apelido,setApelido]=y.useState(''),[cliente,setCliente]=y.useState(''),[busy,setBusy]=y.useState(!1),[err,setErr]=y.useState('');
    const items=scan(text),valid=items.filter(x=>x.ok),bad=items.filter(x=>!x.ok);
    y.useEffect(()=>{const k=e=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[onClose]);
    const submit=async e=>{e.preventDefault();if(!valid.length||bad.length&&valid.length===0)return;setBusy(!0);setErr('');
      try{if(valid.length===1&&items.length===1){await Ee.post('/processos/'+enc(name),{numero:valid[0].formatted,apelido:apelido.trim()||null,clientName:cliente.trim()||null});me.success('Processo adicionado. A primeira consulta ao DataJud roda em segundo plano.')}
      else{const r=await Ee.post('/processos/'+enc(name)+'/bulk',{lista:valid.map(v=>v.formatted).join('\n')});const d=r.data||{};me.success((d.added?.length||0)+' adicionado(s)'+(d.duplicates?.length?', '+d.duplicates.length+' já estava(m) na lista':'')+'.')}
      onDone()}catch(x){setErr(errText(x))}finally{setBusy(!1)}};
    return i.jsx('div',{className:'wp-overlay',onMouseDown:e=>{if(e.target===e.currentTarget)onClose()},children:i.jsxs('form',{className:'wp-dialog',role:'dialog','aria-modal':'true','aria-labelledby':'wp-add-title',onSubmit:submit,children:[
      i.jsxs('div',{className:'wp-dialog-head',children:[i.jsx('h2',{id:'wp-add-title',className:'wp-h2',children:'Adicionar processo'}),i.jsx('button',{type:'button',className:'wa-tw-ibtn',onClick:onClose,'aria-label':'Fechar',children:svg(IC.x,16)})]}),
      i.jsx('label',{htmlFor:'wp-add-numbers',className:'wp-label',children:'Número CNJ (um por linha para vários)'}),
      i.jsx('textarea',{id:'wp-add-numbers',className:'wp-input wp-textarea',rows:4,autoFocus:!0,placeholder:'0001234-04.2026.8.19.0001',value:text,onChange:e=>setText(e.target.value),'aria-describedby':'wp-add-check'}),
      i.jsx('div',{id:'wp-add-check',className:'wp-check','aria-live':'polite',children:items.length?items.slice(0,50).map((x,k)=>i.jsxs('div',{className:'wp-check-row','data-ok':x.ok?'true':'false',children:[i.jsx('span',{className:'wp-mono',children:x.formatted||x.input}),i.jsx('span',{children:x.ok?x.alias.toUpperCase():x.error})]},k)):i.jsx('span',{className:'wa-tw-hint',children:'Cole um ou vários números. O dígito verificador é conferido aqui mesmo.'})}),
      valid.length===1&&items.length===1?i.jsxs('div',{className:'wp-grid2',children:[
        i.jsxs('div',{children:[i.jsx('label',{htmlFor:'wp-add-apelido',className:'wp-label',children:'Apelido (opcional)'}),i.jsx('input',{id:'wp-add-apelido',className:'wp-input',maxLength:120,placeholder:'Ex.: Silva x Banco',value:apelido,onChange:e=>setApelido(e.target.value)})]}),
        i.jsxs('div',{children:[i.jsx('label',{htmlFor:'wp-add-cliente',className:'wp-label',children:'Cliente (opcional)'}),i.jsx('input',{id:'wp-add-cliente',className:'wp-input',maxLength:120,value:cliente,onChange:e=>setCliente(e.target.value)})]})]}):null,
      err?i.jsx('p',{className:'wp-error',role:'alert',children:err}):null,
      i.jsxs('div',{className:'wp-dialog-foot',children:[i.jsx('span',{className:'wa-tw-hint',children:valid.length?nf.format(valid.length)+' válido(s)'+(bad.length?' · '+bad.length+' com problema (ignorado)':''):''}),
        i.jsx('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:onClose,children:'Cancelar'}),
        i.jsx('button',{type:'submit',className:'wa-tw-sbtn',disabled:busy||!valid.length,children:busy?'Adicionando…':valid.length>1?'Adicionar '+valid.length:'Adicionar'})]})]})});
  }

  function Panel({name,id,onClose,onChanged}){
    const[p,setP]=y.useState(null),[err,setErr]=y.useState(''),[busy,setBusy]=y.useState(''),[form,setForm]=y.useState(null);
    const load=y.useCallback(async()=>{try{const r=await Ee.get('/processos/'+enc(name)+'/'+enc(id));setP(r.data);setForm({apelido:r.data.apelido||'',clientName:r.data.clientName||'',remoteJid:String(r.data.remoteJid||'').replace(/@s\.whatsapp\.net$/,'')});setErr('')}catch(e){setErr(errText(e))}},[name,id]);
    y.useEffect(()=>{setP(null);load()},[load]);
    y.useEffect(()=>{const k=e=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[onClose]);
    const put=async(patch,ok)=>{setBusy('save');try{await Ee.put('/processos/'+enc(name)+'/'+enc(id),patch);if(ok)me.success(ok);await load();onChanged()}catch(e){me.error(errText(e))}finally{setBusy('')}};
    const act=async(path,ok)=>{setBusy(path);try{await Ee.post('/processos/'+enc(name)+'/'+enc(id)+'/'+path);if(ok)me.success(ok);await load();onChanged();refresh()}catch(e){me.error(errText(e))}finally{setBusy('')}};
    const del=async()=>{if(!window.confirm('Remover este processo do monitoramento? As movimentações guardadas serão apagadas.'))return;try{await Ee.delete('/processos/'+enc(name)+'/'+enc(id));me.success('Processo removido.');onChanged();onClose()}catch(e){me.error(errText(e))}};
    const body=!p?(err?i.jsx('p',{className:'wp-error',role:'alert',children:err}):i.jsx('div',{className:'wp-skeleton','aria-busy':'true'})):i.jsxs(i.Fragment,{children:[
      i.jsxs('div',{className:'wp-panel-meta',children:[i.jsx(Chip,{status:p.status}),i.jsx('span',{className:'wp-mono wa-tw-muted',children:p.numeroCnj}),i.jsx('span',{className:'wa-tw-muted',children:String(p.tribunalAlias).toUpperCase()})]}),
      p.lastError?i.jsx('p',{className:'wp-callout','data-tone':'bad',children:p.lastError}):null,
      i.jsxs('dl',{className:'wp-dl',children:[
        i.jsx('dt',{children:'Classe'}),i.jsx('dd',{children:p.classe||'—'}),
        i.jsx('dt',{children:'Assuntos'}),i.jsx('dd',{children:p.assuntos||'—'}),
        i.jsx('dt',{children:'Órgão julgador'}),i.jsx('dd',{children:p.orgaoJulgador||'—'}),
        i.jsx('dt',{children:'Ajuizamento'}),i.jsx('dd',{children:dBR(p.dataAjuizamento)}),
        i.jsx('dt',{children:'Consultado em'}),i.jsx('dd',{children:dtBR(p.lastCheckedAt)})]}),
      i.jsxs('form',{className:'wp-panel-form',onSubmit:e=>{e.preventDefault();put({apelido:form.apelido.trim()||null,clientName:form.clientName.trim()||null,remoteJid:form.remoteJid.trim()||null},'Dados salvos.')},children:[
        i.jsx('label',{className:'wp-label',htmlFor:'wp-p-apelido',children:'Apelido'}),i.jsx('input',{id:'wp-p-apelido',className:'wp-input',maxLength:120,value:form.apelido,onChange:e=>setForm({...form,apelido:e.target.value})}),
        i.jsx('label',{className:'wp-label',htmlFor:'wp-p-cliente',children:'Cliente'}),i.jsx('input',{id:'wp-p-cliente',className:'wp-input',maxLength:120,value:form.clientName,onChange:e=>setForm({...form,clientName:e.target.value})}),
        i.jsx('label',{className:'wp-label',htmlFor:'wp-p-jid',children:'Contato vinculado (WhatsApp do cliente)'}),i.jsx('input',{id:'wp-p-jid',className:'wp-input',inputMode:'tel',placeholder:'5521999990000',value:form.remoteJid,onChange:e=>setForm({...form,remoteJid:e.target.value}),'aria-describedby':'wp-p-jid-hint'}),
        i.jsx('p',{id:'wp-p-jid-hint',className:'wa-tw-hint',children:'Só a equipe vincula o contato. Sem contato, o cliente nunca recebe aviso e a IA não fala do processo.'}),
        i.jsx('button',{type:'submit',className:'wa-tw-sbtn wa-tw-sbtn--ghost',disabled:busy==='save',children:'Salvar dados'})]}),
      i.jsxs('fieldset',{className:'wp-fieldset',children:[i.jsx('legend',{className:'wp-label',children:'Avisos'}),
        i.jsx(Toggle,{id:'wp-t-team',label:'Avisar equipe',hint:'Mensagem com o detalhe da movimentação para os números da equipe.',checked:p.notifyTeam,onChange:v=>put({notifyTeam:v})}),
        i.jsx(Toggle,{id:'wp-t-client',label:'Avisar cliente',hint:'Só a frase neutra ("Houve uma atualização no seu processo..."), nunca o conteúdo. Desligado em segredo de justiça.',checked:p.notifyClient,disabled:p.segredoJustica,onChange:v=>put({notifyClient:v})}),
        i.jsx(Toggle,{id:'wp-t-ai',label:'IA pode responder',hint:'A IA só informa a data da última atualização e oferece encaminhar ao advogado.',checked:p.allowAiAnswer,disabled:p.segredoJustica,onChange:v=>put({allowAiAnswer:v})}),
        i.jsx(Toggle,{id:'wp-t-secret',label:'Segredo de justiça',hint:'Bloqueia aviso ao cliente e resposta da IA.',checked:p.segredoJustica,onChange:v=>put({segredoJustica:v})})]}),
      i.jsxs('div',{className:'wp-panel-actions',children:[
        i.jsxs('button',{type:'button',className:'wa-tw-sbtn',onClick:()=>act('sync','Consulta feita.'),disabled:!!busy,children:[svg(IC.sync,14),busy==='sync'?'Consultando…':'Sincronizar agora']}),
        p.unseen?i.jsx('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:()=>act('seen'),disabled:!!busy,children:'Marcar como visto'}):null,
        i.jsx('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:()=>put({active:!p.active},p.active?'Processo arquivado.':'Processo reativado.'),children:p.active?'Arquivar':'Reativar'}),
        i.jsx('button',{type:'button',className:'wa-tw-lbtn wp-danger',onClick:del,children:'Remover'})]}),
      i.jsx('h3',{className:'wp-h3',children:'Movimentações'}),
      p.movements?.length?i.jsx('ol',{className:'wp-timeline',children:p.movements.map(m=>i.jsxs('li',{'data-new':m.seen?void 0:'true',children:[i.jsxs('div',{className:'wp-tl-head',children:[i.jsx('span',{className:'wp-tl-date',children:dtBR(m.occurredAt)}),m.seen?null:i.jsx('span',{className:'wp-new',children:'nova'})]}),i.jsx('p',{className:'wp-tl-name',children:m.name}),m.complement?i.jsx('p',{className:'wa-tw-hint',children:m.complement}):null]},m.id))}):i.jsx('p',{className:'wa-tw-muted',children:'Nenhuma movimentação ainda.'}),
      p.publications?.length?i.jsxs(i.Fragment,{children:[i.jsx('h3',{className:'wp-h3',children:'Publicações no DJEN'}),i.jsx('ul',{className:'wp-plain',children:p.publications.map(x=>i.jsxs('li',{children:[dBR(x.disponibilizadaEm),' · ',x.tipo||'Comunicação',' · ',x.siglaTribunal,x.link?i.jsx('a',{href:x.link,target:'_blank',rel:'noreferrer',className:'wp-link',children:' abrir'}):null]},x.id))})]}):null]});
    return i.jsxs('aside',{className:'wp-panel',role:'dialog','aria-modal':'false','aria-labelledby':'wp-panel-title',children:[
      i.jsxs('div',{className:'wp-panel-head',children:[i.jsx('h2',{id:'wp-panel-title',className:'wp-h2',children:p?(p.apelido||p.numeroCnj):'Processo'}),i.jsx('button',{type:'button',className:'wa-tw-ibtn',onClick:onClose,'aria-label':'Fechar painel',children:svg(IC.x,16)})]}),
      i.jsx('div',{className:'wp-panel-body',children:body})]});
  }

  function ProcessTab({name}){
    const[data,setData]=y.useState(null),[err,setErr]=y.useState(''),[view,setView]=y.useState('all'),[q,setQ]=y.useState(''),[trib,setTrib]=y.useState(''),[from,setFrom]=y.useState(''),[to,setTo]=y.useState(''),[pop,setPop]=y.useState(!1),[add,setAdd]=y.useState(!1),[open,setOpen]=y.useState(null);
    const load=y.useCallback(async()=>{try{const r=await Ee.get('/processos/'+enc(name),{params:{view,tribunal:trib||void 0,from:from||void 0,to:to||void 0}});setData(r.data);setErr('')}catch(e){setErr(errText(e))}},[name,view,trib,from,to]);
    y.useEffect(()=>{load()},[load]);
    const items=(data?.items||[]).filter(p=>{const t=q.trim().toLowerCase();if(!t)return!0;const dg=t.replace(/\D/g,'');return[p.apelido,p.clientName,p.classe,p.numeroCnj].join(' ').toLowerCase().includes(t)||dg.length>=4&&p.numeroDigits.includes(dg)});
    const c=data?.counts||{},nActive=(trib?1:0)+(from||to?1:0);
    const exportCsv=async()=>{try{const r=await Ee.get('/processos/'+enc(name)+'/export.csv',{responseType:'blob'});const a=document.createElement('a');a.href=URL.createObjectURL(r.data);a.download='processos-'+name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2e3)}catch(e){me.error(errText(e))}};
    const VIEWS=[['all','Todos',c.all],['news','Com novidade',c.news],['archived','Arquivados',c.archived]];
    return i.jsxs('div',{className:'wp-tab',children:[
      i.jsxs('div',{className:'wp-viewbar',children:[
        i.jsx('div',{className:'wp-seg',role:'tablist','aria-label':'Visões',children:VIEWS.map(([k,lb,n])=>i.jsxs('button',{type:'button',role:'tab','aria-selected':view===k,className:'wp-seg-btn',onClick:()=>setView(k),children:[lb,n!=null?i.jsx('span',{className:'wa-tw-lbtn-n',children:nf.format(n)}):null]},k))}),
        i.jsxs('div',{className:'wp-viewbar-right',children:[
          i.jsx('input',{type:'search',className:'wp-input wp-search',placeholder:'Buscar apelido, cliente ou número',value:q,onChange:e=>setQ(e.target.value),'aria-label':'Buscar processos'}),
          i.jsxs('div',{className:'wp-pop-wrap',children:[i.jsxs('button',{type:'button',className:'wa-tw-lbtn','aria-expanded':pop,'data-active':nActive?'true':void 0,onClick:()=>setPop(!pop),children:[svg(IC.filter,14),'Filtro',nActive?i.jsx('span',{className:'wa-tw-lbtn-n',children:nActive}):null]}),
            pop?i.jsxs('div',{className:'wa-tw-pop wp-pop',role:'dialog','aria-label':'Filtro',children:[
              i.jsx('label',{className:'wp-label',htmlFor:'wp-f-trib',children:'Tribunal'}),i.jsxs('select',{id:'wp-f-trib',className:'wp-input',value:trib,onChange:e=>setTrib(e.target.value),children:[i.jsx('option',{value:'',children:'Todos'}),(data?.tribunals||[]).map(t=>i.jsx('option',{value:t,children:t.toUpperCase()},t))]}),
              i.jsx('span',{className:'wp-label',children:'Última movimentação entre'}),i.jsxs('div',{className:'wp-grid2',children:[i.jsx('input',{type:'date',className:'wp-input',value:from,onChange:e=>setFrom(e.target.value),'aria-label':'De'}),i.jsx('input',{type:'date',className:'wp-input',value:to,onChange:e=>setTo(e.target.value),'aria-label':'Até'})]}),
              i.jsx('button',{type:'button',className:'wa-tw-lbtn',onClick:()=>{setTrib('');setFrom('');setTo('')},children:'Limpar filtros'})]}):null]}),
          i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:exportCsv,children:[svg(IC.dl,14),'CSV']}),
          i.jsxs('button',{type:'button',className:'wa-tw-sbtn',onClick:()=>setAdd(!0),children:[svg(IC.plus,14),'Adicionar processo']})]})]}),
      err?i.jsx('p',{className:'wp-callout','data-tone':'bad',role:'alert',children:err}):null,
      !data&&!err?i.jsx('div',{className:'wp-skeleton','aria-busy':'true'}):null,
      data&&!items.length?i.jsxs('div',{className:'wa-tw-empty',children:[i.jsx('span',{className:'wa-tw-empty-icon',children:svg(IC.scale,20)}),i.jsx('p',{className:'wa-tw-empty-title',children:view==='news'?'Nenhuma novidade':view==='archived'?'Nenhum processo arquivado':'Nenhum processo ainda'}),i.jsx('p',{className:'wa-tw-empty-text',children:view==='all'&&!q?'Adicione os processos do escritório pelo número CNJ; o DataJud é consultado automaticamente.':'Nada com estes filtros.'}),view==='all'&&!q?i.jsx('button',{type:'button',className:'wa-tw-sbtn',onClick:()=>setAdd(!0),children:'Adicionar processo'}):null]}):null,
      data&&items.length?i.jsx('div',{className:'wp-table-wrap',children:i.jsxs('table',{className:'wp-table',children:[
        i.jsx('thead',{children:i.jsxs('tr',{children:[i.jsx('th',{children:'Processo'}),i.jsx('th',{children:'Apelido / Cliente'}),i.jsx('th',{children:'Tribunal'}),i.jsx('th',{children:'Classe'}),i.jsx('th',{children:'Última movimentação'}),i.jsx('th',{children:'Atualizado'}),i.jsx('th',{children:'Situação'})]})}),
        i.jsx('tbody',{children:items.map(p=>i.jsxs('tr',{tabIndex:0,'aria-selected':open===p.id,onClick:()=>setOpen(p.id),onKeyDown:e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setOpen(p.id)}},children:[
          i.jsx('td',{className:'wp-mono wp-nowrap',children:p.numeroCnj}),
          i.jsx('td',{children:i.jsxs('div',{className:'wp-cell2',children:[i.jsx('span',{children:p.apelido||'—'}),p.clientName?i.jsx('span',{className:'wa-tw-hint',children:p.clientName}):null]})}),
          i.jsx('td',{children:String(p.tribunalAlias).toUpperCase()}),
          i.jsx('td',{children:i.jsx('span',{className:'wp-ellipsis',title:p.classe||'',children:p.classe||'—'})}),
          i.jsx('td',{children:p.lastMovement?i.jsxs('div',{className:'wp-cell2',children:[i.jsx('span',{className:'wp-ellipsis',title:p.lastMovement.name,children:p.lastMovement.name}),i.jsx('span',{className:'wa-tw-hint',children:dBR(p.lastMovement.occurredAt)})]}):'—'}),
          i.jsx('td',{className:'wa-tw-hint wp-nowrap',children:dsBR(p.lastSyncedAt)}),
          i.jsx('td',{children:i.jsxs('span',{className:'wp-status',children:[i.jsx(Chip,{status:p.status}),p.unseen?i.jsx('span',{className:'wa-tw-lbtn-n',title:'Movimentações não vistas',children:p.unseen}):null]})})]},p.id))})]})}):null,
      i.jsx('p',{className:'wa-tw-hint wp-foot',children:'Fonte: DataJud (CNJ), dados públicos que podem atrasar dias; processos em segredo de justiça não aparecem. Não substitui a conferência nos sistemas oficiais de intimação.'}),
      add?i.jsx(AddDialog,{name,onClose:()=>setAdd(!1),onDone:()=>{setAdd(!1);load();setTimeout(load,4e4)}}):null,
      open?i.jsx(Panel,{name,id:open,onClose:()=>setOpen(null),onChanged:load}):null]});
  }

  function PubTab({name}){
    const[oabs,setOabs]=y.useState(null),[pubs,setPubs]=y.useState(null),[err,setErr]=y.useState(''),[unseen,setUnseen]=y.useState(!0),[f,setF]=y.useState({numeroOab:'',ufOab:'RJ',label:''});
    const load=y.useCallback(async()=>{try{const[a,b]=await Promise.all([Ee.get('/processos/'+enc(name)+'/oab'),Ee.get('/processos/'+enc(name)+'/publicacoes',{params:{unseen:unseen?'1':void 0,limit:50}})]);setOabs(a.data||[]);setPubs(b.data);setErr('')}catch(e){setErr(errText(e))}},[name,unseen]);
    y.useEffect(()=>{load()},[load]);
    const addOab=async e=>{e.preventDefault();try{await Ee.post('/processos/'+enc(name)+'/oab',{numeroOab:f.numeroOab,ufOab:f.ufOab,label:f.label||null});me.success('OAB adicionada. A primeira busca no DJEN não gera avisos.');setF({...f,numeroOab:'',label:''});load()}catch(x){me.error(errText(x))}};
    const seen=async body=>{try{await Ee.post('/processos/'+enc(name)+'/publicacoes/seen',body);load();refresh()}catch(x){me.error(errText(x))}};
    return i.jsxs('div',{className:'wp-tab',children:[
      err?i.jsx('p',{className:'wp-callout','data-tone':'bad',role:'alert',children:err}):null,
      i.jsxs('section',{className:'wp-card','aria-labelledby':'wp-oab-title',children:[i.jsx('h2',{id:'wp-oab-title',className:'wp-h2',children:'OABs acompanhadas no DJEN'}),
        i.jsx('p',{className:'wa-tw-hint',children:'Busca as intimações e publicações do Diário de Justiça Eletrônico Nacional (Comunica PJe) pelo número da OAB. Se o tribunal usar sufixo (123456-A), cadastre também essa variação.'}),
        oabs&&oabs.length?i.jsx('ul',{className:'wp-oabs',children:oabs.map(o=>i.jsxs('li',{children:[i.jsxs('span',{className:'wp-mono',children:[o.numeroOab,'/',o.ufOab]}),o.label?i.jsx('span',{className:'wa-tw-muted',children:o.label}):null,o.lastError?i.jsxs('span',{className:'wa-tw-badge','data-tone':'bad',title:o.lastError,children:[i.jsx('span',{className:'wa-tw-badge-dot'}),'Erro']}):i.jsx('span',{className:'wa-tw-hint',children:o.lastCheckedAt?'consultado '+dtBR(o.lastCheckedAt):'aguardando consulta'}),
          i.jsx('button',{type:'button',className:'wa-tw-lbtn',onClick:async()=>{try{await Ee.put('/processos/'+enc(name)+'/oab/'+enc(o.id),{active:!o.active});load()}catch(x){me.error(errText(x))}},children:o.active?'Pausar':'Retomar'}),
          i.jsx('button',{type:'button',className:'wa-tw-lbtn wp-danger',onClick:async()=>{if(!window.confirm('Parar de acompanhar esta OAB?'))return;try{await Ee.delete('/processos/'+enc(name)+'/oab/'+enc(o.id));load()}catch(x){me.error(errText(x))}},children:'Remover'})]},o.id))}):i.jsx('p',{className:'wa-tw-muted',children:'Nenhuma OAB cadastrada.'}),
        i.jsxs('form',{className:'wp-oab-form',onSubmit:addOab,children:[
          i.jsx('input',{className:'wp-input',placeholder:'Número da OAB',inputMode:'numeric',required:!0,maxLength:12,value:f.numeroOab,onChange:e=>setF({...f,numeroOab:e.target.value}),'aria-label':'Número da OAB'}),
          i.jsx('input',{className:'wp-input wp-uf',placeholder:'UF',maxLength:2,required:!0,value:f.ufOab,onChange:e=>setF({...f,ufOab:e.target.value.toUpperCase()}),'aria-label':'UF da OAB'}),
          i.jsx('input',{className:'wp-input',placeholder:'Advogado(a) (opcional)',maxLength:120,value:f.label,onChange:e=>setF({...f,label:e.target.value}),'aria-label':'Nome do advogado'}),
          i.jsx('button',{type:'submit',className:'wa-tw-sbtn',children:'Adicionar OAB'})]})]}),
      i.jsxs('section',{className:'wp-card','aria-labelledby':'wp-pub-title',children:[i.jsxs('div',{className:'wp-card-head',children:[i.jsx('h2',{id:'wp-pub-title',className:'wp-h2',children:'Publicações'}),
          i.jsxs('div',{className:'wp-seg',role:'tablist',children:[i.jsx('button',{type:'button',role:'tab','aria-selected':unseen,className:'wp-seg-btn',onClick:()=>setUnseen(!0),children:'Não vistas'}),i.jsx('button',{type:'button',role:'tab','aria-selected':!unseen,className:'wp-seg-btn',onClick:()=>setUnseen(!1),children:'Todas'})]}),
          pubs?.items?.some(x=>!x.seenAt)?i.jsx('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:()=>seen({all:!0}),children:'Marcar todas como vistas'}):null]}),
        !pubs?i.jsx('div',{className:'wp-skeleton','aria-busy':'true'}):pubs.items.length?i.jsx('ul',{className:'wp-pubs',children:pubs.items.map(x=>i.jsxs('li',{'data-new':x.seenAt?void 0:'true',children:[
          i.jsxs('div',{className:'wp-pub-head',children:[i.jsx('span',{className:'wp-tl-date',children:dBR(x.disponibilizadaEm)}),i.jsx('span',{className:'wa-tw-badge',children:x.siglaTribunal||'—'}),i.jsx('span',{children:x.tipo||'Comunicação'}),i.jsx('span',{className:'wp-mono wa-tw-muted',children:x.processNumber||''}),x.Process?i.jsx('span',{className:'wa-tw-hint',children:'· '+(x.Process.apelido||'processo monitorado')}):null]}),
          i.jsx('p',{className:'wp-pub-text',children:String(x.texto||'').slice(0,600)}),
          i.jsxs('div',{className:'wp-pub-actions',children:[x.link?i.jsxs('a',{className:'wa-tw-lbtn',href:x.link,target:'_blank',rel:'noreferrer',children:[svg(IC.ext,13),'Abrir no tribunal']}):null,x.seenAt?null:i.jsx('button',{type:'button',className:'wa-tw-lbtn',onClick:()=>seen({ids:[x.id]}),children:'Marcar como vista'})]})]},x.id))}):i.jsx('p',{className:'wa-tw-muted',children:unseen?'Nenhuma publicação nova.':'Nenhuma publicação encontrada ainda.'}),
        i.jsx('p',{className:'wa-tw-hint',children:'Cópia do DJEN para conferência rápida. O prazo conta pela publicação oficial: confira sempre no tribunal.'})]})]});
  }

  function SettingsTab({name}){
    const[s,setS]=y.useState(null),[err,setErr]=y.useState(''),[busy,setBusy]=y.useState(!1);
    y.useEffect(()=>{Ee.get('/processos/'+enc(name)+'/settings').then(r=>{const v=r.data.settings;setS({...v,numbers:(v.notifyNumbers||[]).join('\n')})}).catch(e=>setErr(errText(e)))},[name]);
    if(err)return i.jsx('p',{className:'wp-callout','data-tone':'bad',role:'alert',children:err});
    if(!s)return i.jsx('div',{className:'wp-skeleton','aria-busy':'true'});
    const q=s.quietHours||{};
    const save=async e=>{e.preventDefault();setBusy(!0);try{const r=await Ee.post('/processos/'+enc(name)+'/settings',{enabled:s.enabled,checkEveryHours:Number(s.checkEveryHours),djenDays:Number(s.djenDays),notifyNumbers:s.numbers.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean),quietHours:q,clientMessageTemplate:s.clientMessageTemplate||null});const v=r.data.settings;setS({...v,numbers:(v.notifyNumbers||[]).join('\n')});me.success('Configurações salvas.')}catch(x){me.error(errText(x))}finally{setBusy(!1)}};
    return i.jsxs('form',{className:'wp-card wp-settings',onSubmit:save,children:[
      i.jsx(Toggle,{id:'wp-s-on',label:'Monitoramento ligado',hint:'Desligado: nada é consultado automaticamente e ninguém recebe aviso (o "Sincronizar agora" continua funcionando).',checked:s.enabled,onChange:v=>setS({...s,enabled:v})}),
      i.jsxs('div',{className:'wp-grid2',children:[
        i.jsxs('div',{children:[i.jsx('label',{className:'wp-label',htmlFor:'wp-s-h',children:'Consultar a cada (horas)'}),i.jsx('input',{id:'wp-s-h',className:'wp-input',type:'number',min:2,max:48,value:s.checkEveryHours,onChange:e=>setS({...s,checkEveryHours:e.target.value})})]}),
        i.jsxs('div',{children:[i.jsx('label',{className:'wp-label',htmlFor:'wp-s-d',children:'DJEN: dias para trás'}),i.jsx('input',{id:'wp-s-d',className:'wp-input',type:'number',min:1,max:30,value:s.djenDays,onChange:e=>setS({...s,djenDays:e.target.value})})]})]}),
      i.jsx('label',{className:'wp-label',htmlFor:'wp-s-n',children:'Números da equipe (um por linha)'}),
      i.jsx('textarea',{id:'wp-s-n',className:'wp-input wp-textarea',rows:3,placeholder:(s.leadsNumbers||[]).join('\n')||'5521999990000',value:s.numbers,onChange:e=>setS({...s,numbers:e.target.value}),'aria-describedby':'wp-s-n-hint'}),
      i.jsx('p',{id:'wp-s-n-hint',className:'wa-tw-hint',children:(s.leadsNumbers||[]).length&&!s.numbers.trim()?'Vazio: os avisos vão para os números da equipe configurados em Leads ('+s.leadsNumbers.join(', ')+').':'Vazio: usa os números configurados em Leads, se houver.'}),
      i.jsxs('fieldset',{className:'wp-fieldset',children:[i.jsx('legend',{className:'wp-label',children:'Horário de silêncio'}),
        i.jsx(Toggle,{id:'wp-s-q',label:'Segurar avisos à noite',hint:'Os avisos ficam guardados e saem quando o horário de silêncio acaba.',checked:q.enabled,onChange:v=>setS({...s,quietHours:{...q,enabled:v}})}),
        q.enabled?i.jsxs('div',{className:'wp-grid2',children:[i.jsx('input',{type:'time',className:'wp-input',value:q.start,onChange:e=>setS({...s,quietHours:{...q,start:e.target.value}}),'aria-label':'Início do silêncio'}),i.jsx('input',{type:'time',className:'wp-input',value:q.end,onChange:e=>setS({...s,quietHours:{...q,end:e.target.value}}),'aria-label':'Fim do silêncio'})]}):null]}),
      i.jsx('label',{className:'wp-label',htmlFor:'wp-s-t',children:'Mensagem para o cliente (quando "Avisar cliente" estiver ligado no processo)'}),
      i.jsx('textarea',{id:'wp-s-t',className:'wp-input wp-textarea',rows:3,maxLength:500,value:s.clientMessageTemplate,onChange:e=>setS({...s,clientMessageTemplate:e.target.value}),'aria-describedby':'wp-s-t-hint'}),
      i.jsx('p',{id:'wp-s-t-hint',className:'wa-tw-hint',children:'Só aceita o campo {nome}. O cliente nunca recebe o conteúdo da movimentação, prazos ou decisões.'}),
      i.jsx('div',{className:'wp-actions',children:i.jsx('button',{type:'submit',className:'wa-tw-sbtn',disabled:busy,children:busy?'Salvando…':'Salvar'})})]});
  }

  function Page(){
    const{instance:g}=ct(),name=g?.name;const[tab,setTab]=y.useState('proc');
    if(!g)return null;
    const TABS=[['proc','Processos'],['pub','Publicações (DJEN)'],['cfg','Configurações']];
    return i.jsxs('main',{className:'wp-page',children:[
      i.jsxs('header',{className:'wp-head',children:[i.jsx('h1',{className:'wp-title',children:'Processos'}),i.jsx('p',{className:'wa-tw-muted',children:'Andamentos dos processos do escritório (DataJud/CNJ) e intimações do DJEN, com aviso para a equipe.'})]}),
      i.jsx('div',{className:'wp-tabs',role:'tablist','aria-label':'Seções',children:TABS.map(([k,lb])=>i.jsx('button',{type:'button',role:'tab','aria-selected':tab===k,className:'wp-tab-btn',onClick:()=>setTab(k),children:lb},k))}),
      tab==='proc'?i.jsx(ProcessTab,{name}):tab==='pub'?i.jsx(PubTab,{name}):i.jsx(SettingsTab,{name})]});
  }
  return{Page,NavIcon,checkCnj};
})();

'''

ROUTE_ANCHOR = '{path:"/manager/instance/:instanceId/dashboard",element:i.jsx(tn,{children:i.jsx(un,{children:i.jsx(PX,{})})})},'
ROUTE_NEW = '{path:"/manager/instance/:instanceId/processos",element:i.jsx(tn,{children:i.jsx(un,{children:i.jsx(WaProc.Page,{})})})},'
SIDEBAR_ANCHOR = '{navLabel:!0,title:e("sidebar.configurations")'
SIDEBAR_ITEM = '{id:"processos",title:"Processos",icon:WaProc.NavIcon,path:"processos"},'


def patch_component(s):
    return rep(s, '\nconst Lse=Z2([', '\n' + COMPONENT + 'const Lse=Z2([', 'route table (const Lse=Z2([)')


def patch_route(s):
    return rep(s, ROUTE_ANCHOR, ROUTE_ANCHOR + ROUTE_NEW, 'instance dashboard route')


def patch_sidebar(s):
    return rep(s, SIDEBAR_ANCHOR, SIDEBAR_ITEM + SIDEBAR_ANCHOR, 'sidebar "Configurações" group')


GROUPS = [('component', patch_component), ('route', patch_route), ('sidebar', patch_sidebar)]


def patch_html(html):
    links = [m for m in re.finditer(r'^    <link rel="stylesheet"[^\n]*\n', html, re.M)]
    if not links:
        raise PatchError('index.html: no stylesheet link found')
    end = links[-1].end()
    return html[:end] + '    ' + html_marker('html') + '\n' + CSS_LINK + html[end:]


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


def apply(bundle, html):
    """Pure function (used by --check and by the anchor self-test): returns (bundle, html, report)."""
    report = []
    for name, fn in GROUPS:
        if marker(name) in bundle:
            report.append(f'{name}: already applied')
            continue
        bundle = marker(name) + fn(bundle)
        report.append(f'{name}: applied')
    if html_marker('html') not in html:
        html = patch_html(html)
        report.append('html: applied')
    else:
        report.append('html: already applied')
    return bundle, bump_cache(html), report


def main():
    check = '--check' in sys.argv[1:]
    with open(BUNDLE, encoding='utf-8') as f:
        bundle = f.read()
    with open(INDEX, encoding='utf-8') as f:
        html = f.read()
    missing = [name for name, _ in GROUPS if marker(name) not in bundle]
    if html_marker('html') not in html:
        missing.append('html')
    if bump_cache(html) != html:
        missing.append('index.html cache version')
    if not os.path.isfile(CSS):
        missing.append('processos.css')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/processos.css is missing')
    for required in REQUIRED:
        if required not in bundle:
            raise PatchError(f'run the patch that adds {required} first')

    new_bundle, new_html, report = apply(bundle, html)
    if new_bundle != bundle:
        with open(BUNDLE, 'w', encoding='utf-8') as f:
            f.write(new_bundle)
    if new_html != html:
        with open(INDEX, 'w', encoding='utf-8') as f:
            f.write(new_html)
        report.append(f'index.html written (processos.css ?v=1, bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
