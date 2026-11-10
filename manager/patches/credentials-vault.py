#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Chaves e credenciais", an admin-only page with the secrets of every
instance (masked) and an on-demand reveal of one value.

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/credentials-vault.css (a plain file, edited by hand, only var(--m-*) tokens
of minimal.css, linked after twenty-layout.css).

Backend (same release): GET /admin/credentials (masked list) and POST /admin/credentials/reveal
{kind, id, confirmPassword}, both accepted ONLY with the global key (adminOnlyGuard: an instance token gets 403).
Requests go through `bd`, the bundle's axios instance that always sends the key of the login (jn.TOKEN), never the
token of the last opened instance (jn.INSTANCE_TOKEN, used by `Ee`).

Admin session: the global login (verify-creds accepts only the global key) stores it in jn.TOKEN. The nav entry is
shown only when jn.TOKEN is set and differs from jn.INSTANCE_TOKEN (a session opened with an instance token has no
jn.TOKEN, or the same value). The page also shows "Acesso restrito" when opened directly by a non-admin session or
when the API answers 401/403: the backend guard is the real protection, the UI check only hides the entry.

Revealed values: kept only in React state (never localStorage/sessionStorage, never the react-query cache), shown
for 30 s with a countdown and a "Copiar" button, then masked again; cleared when the page unmounts (route change)
and when the tab is hidden. The admin key typed in the dialog is dropped as soon as the request returns.

Bundle changes (one marker, MARKER, inside the component block; every anchor is left intact so the other scripts
that use the same anchors keep matching):
  component - WaVault (IIFE) inserted between the last component block and the route table:
              Page (table Instância · Tipo · Nome · Valor · ações, filters by instance and type, search, reveal
              dialog) and Nav (top bar link, admin only).
  route     - /manager/chaves after /manager/observability (same guard tn and top-level layout B5).
  nav       - WaVault.Nav in the top bar of the top-level pages, after the theme slot (iM).
index.html group (marker: an HTML comment in <head>):
  html      - links credentials-vault.css?v=1 after twenty-layout.css and bumps the bundle ?v= to CACHE_VERSION
              (only raised).

Every anchor must match exactly once, otherwise the script stops without writing anything. Re-running is safe.
Order: run after root-redirect.py (REQUIRED).

Usage (from the repository root):
  python3 -I manager/patches/credentials-vault.py           # apply
  python3 -I manager/patches/credentials-vault.py --check   # exit 1 unless applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'credentials-vault.css')
MARKER = '/*whatsai-patch:credentials-vault:v1*/'
HTML_MARKER = '<!-- whatsai-patch:credentials-vault:html -->'
REQUIRED = ('/*whatsai-patch:root-redirect:v1*/', '/*whatsai-patch:usage-limits:component*/')
CACHE_VERSION = '27'
SCRIPT_TAG = '<script type="module" crossorigin src="/assets/index-b29a5d7a.js?v='
CSS_ANCHOR = '    <link rel="stylesheet" href="/assets/twenty-layout.css?v='


class PatchError(Exception):
    pass


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# Minified names (bundle index-b29a5d7a.js): i = jsx runtime, y = React, bd = axios instance that always sends the
# login key (jn.TOKEN), dr = localStorage.getItem, jn = storage keys, me = toast, se = Button, Fu = react-router
# Link, tn = protected route, B5 = top-level layout (top bar + footer), zM = top bar (e = instanceId).

COMPONENT = MARKER + r'''const WaVault=(()=>{
  const SECONDS=30;
  const KEY=['M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z'];
  const STATUS={open:['ok','Conectada'],connecting:['warn','Conectando'],close:['bad','Desconectada']};
  function svg(paths,size,extra){return i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:size||16,height:size||16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'1.75',strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',children:[...paths.map((d,k)=>i.jsx('path',{d},k)),extra||null]});}
  function Icon({size}){return svg(KEY,Number(size)||16,i.jsx('circle',{cx:'16.5',cy:'7.5',r:'.5',fill:'currentColor'},'c'));}
  function isAdmin(){try{const t=dr(jn.TOKEN);return!!t&&t!==dr(jn.INSTANCE_TOKEN)}catch{return!1}}
  function errText(e){const st=e?.response?.status,m=e?.response?.data?.response?.message??e?.response?.data?.message;const flat=[].concat(m??[]).flat(4).map(x=>typeof x==='string'?x:'').filter(Boolean);
    if(st===403&&!flat.length)return 'Chave do administrador incorreta.';if(flat.length)return flat.join(' ');if(st===404)return 'Credencial não encontrada.';return 'Não foi possível falar com a API. Tente de novo em instantes.';}
  async function copy(text){try{await navigator.clipboard.writeText(text);me.success('Copiado.')}catch{me.error('Não foi possível copiar. Selecione o valor e copie manualmente.')}}

  function Nav(){
    if(!isAdmin())return null;
    return i.jsx(se,{variant:'ghost',size:'sm',asChild:!0,children:i.jsxs(Fu,{to:'/manager/chaves',className:'gap-2 wv-nav','aria-label':'Chaves e credenciais',children:[i.jsx(Icon,{size:16}),i.jsx('span',{className:'hidden sm:inline',children:'Chaves'})]})});
  }

  function Restricted(){
    return i.jsx('main',{className:'wv-page',children:i.jsxs('div',{className:'wv-empty',role:'alert',children:[i.jsx('span',{className:'wv-empty-ico',children:i.jsx(Icon,{size:20})}),
      i.jsx('h1',{className:'wv-empty-title',children:'Acesso restrito'}),
      i.jsx('p',{className:'wv-muted',children:'Só o administrador, conectado com a chave global, vê as chaves e credenciais das instâncias.'}),
      i.jsx(Fu,{to:'/manager/',className:'wv-btn',children:'Voltar para Instâncias'})]})});
  }

  function Dialog({target,onClose,onRevealed}){
    const[pwd,setPwd]=y.useState(''),[busy,setBusy]=y.useState(!1),[err,setErr]=y.useState('');
    const input=y.useRef(null),back=y.useRef(document.activeElement);
    y.useEffect(()=>{input.current?.focus();const prev=back.current;return()=>{try{prev&&prev.focus&&prev.focus()}catch{}}},[]);
    y.useEffect(()=>{const k=ev=>{if(ev.key==='Escape'&&!busy)onClose()};document.addEventListener('keydown',k);return()=>document.removeEventListener('keydown',k)},[busy,onClose]);
    const submit=async ev=>{ev.preventDefault();if(!pwd||busy)return;setBusy(!0);setErr('');const confirmPassword=pwd;setPwd('');
      try{const r=await bd.post('/admin/credentials/reveal',{kind:target.kind,id:target.id,confirmPassword});onRevealed(target,String(r.data?.value??''))}
      catch(e){setErr(errText(e));setBusy(!1);setTimeout(()=>input.current?.focus(),0)}};
    return i.jsx('div',{className:'wv-overlay',onMouseDown:ev=>{if(ev.target===ev.currentTarget&&!busy)onClose()},children:
      i.jsxs('form',{className:'wv-dialog',role:'dialog','aria-modal':'true','aria-labelledby':'wv-dialog-title','aria-describedby':'wv-dialog-desc',onSubmit:submit,children:[
        i.jsx('h2',{id:'wv-dialog-title',className:'wv-dialog-title',children:'Revelar credencial'}),
        i.jsxs('p',{id:'wv-dialog-desc',className:'wv-muted',children:[target.label,target.name?' · '+target.name:'',' de ',i.jsx('strong',{children:target.instance}),'. O valor aparece por '+SECONDS+' segundos e o acesso fica registrado.']}),
        i.jsx('label',{htmlFor:'wv-pwd',className:'wv-label',children:'Chave do administrador'}),
        i.jsx('input',{id:'wv-pwd',ref:input,className:'wv-input',type:'password',autoComplete:'off',spellCheck:!1,value:pwd,disabled:busy,'aria-invalid':err?'true':void 0,'aria-describedby':err?'wv-pwd-err':void 0,onChange:ev=>{setPwd(ev.target.value);setErr('')}}),
        err?i.jsx('p',{id:'wv-pwd-err',className:'wv-error',role:'alert',children:err}):null,
        i.jsxs('div',{className:'wv-dialog-actions',children:[
          i.jsx('button',{type:'button',className:'wv-btn',onClick:onClose,disabled:busy,children:'Cancelar'}),
          i.jsx('button',{type:'submit',className:'wv-btn wv-btn-primary',disabled:!pwd||busy,'aria-busy':busy?'true':void 0,children:busy?'Verificando…':'Revelar'})]})]})});
  }

  function Page(){
    const admin=isAdmin();
    const[data,setData]=y.useState(null),[error,setError]=y.useState(''),[denied,setDenied]=y.useState(!admin),[loading,setLoading]=y.useState(admin);
    const[q,setQ]=y.useState(''),[inst,setInst]=y.useState(''),[kind,setKind]=y.useState('');
    const[target,setTarget]=y.useState(null),[shown,setShown]=y.useState(null),[now,setNow]=y.useState(Date.now());
    const load=y.useCallback(async()=>{if(!isAdmin()){setDenied(!0);return}setLoading(!0);setError('');
      try{const r=await bd.get('/admin/credentials');setData(r.data);setDenied(!1)}
      catch(e){const st=e?.response?.status;if(st===401||st===403)setDenied(!0);else setError(errText(e))}finally{setLoading(!1)}},[]);
    y.useEffect(()=>{load()},[load]);
    // The revealed value lives only here: re-masked after SECONDS, when the tab is hidden and when the page unmounts
    y.useEffect(()=>{if(!shown)return;const t=setInterval(()=>{const n=Date.now();setNow(n);if(n>=shown.until)setShown(null)},250);return()=>clearInterval(t)},[shown]);
    y.useEffect(()=>{const hide=()=>{if(document.visibilityState==='hidden')setShown(null)};document.addEventListener('visibilitychange',hide);return()=>{document.removeEventListener('visibilitychange',hide);setShown(null)}},[]);
    if(denied)return i.jsx(Restricted,{});
    const instances=Array.isArray(data?.instances)?data.instances:[];
    const kinds=Array.isArray(data?.kinds)?data.kinds:[];
    const rows=[];
    for(const it of instances){
      for(const c of it.items||[])rows.push({...c,instance:it.name,instanceId:it.id,status:it.connectionStatus,key:c.kind+':'+c.id});
      if(it.openaiGlobalFallback)rows.push({kind:'openai',label:'OpenAI',id:'',name:'chave global do servidor',masked:'',global:!0,instance:it.name,instanceId:it.id,status:it.connectionStatus,key:'global:'+it.id});
    }
    const term=q.trim().toLowerCase();
    const visible=rows.filter(r=>(!inst||r.instanceId===inst)&&(!kind||r.kind===kind)&&(!term||[r.instance,r.label,r.name,r.masked].some(v=>String(v||'').toLowerCase().includes(term))));
    const left=shown?Math.max(0,Math.ceil((shown.until-now)/1000)):0;
    const reveal=(row,thenCopy)=>setTarget({kind:row.kind,id:row.id,label:row.label,name:row.name,instance:row.instance,key:row.key,thenCopy});
    const onRevealed=(t,value)=>{setTarget(null);setNow(Date.now());setShown({key:t.key,value,until:Date.now()+SECONDS*1e3});if(t.thenCopy)copy(value)};
    const head=i.jsxs('header',{className:'wv-head',children:[
      i.jsx('p',{className:'wv-crumb',children:'Painel WhatsAI'}),
      i.jsx('h1',{className:'wv-title',children:'Chaves e credenciais'}),
      i.jsx('p',{className:'wv-muted',children:'Chaves de todas as instâncias, sempre mascaradas. Para ver um valor, confirme a chave do administrador: ele aparece por '+SECONDS+' segundos e cada acesso fica registrado no log.'})]});
    const bar=i.jsxs('div',{className:'wv-bar',role:'search',children:[
      i.jsx('input',{type:'search',className:'wv-input wv-search',placeholder:'Buscar instância, tipo ou nome',value:q,'aria-label':'Buscar',onChange:ev=>setQ(ev.target.value)}),
      i.jsxs('select',{className:'wv-input wv-select',value:inst,'aria-label':'Filtrar por instância',onChange:ev=>setInst(ev.target.value),children:[i.jsx('option',{value:'',children:'Todas as instâncias'}),...instances.map(it=>i.jsx('option',{value:it.id,children:it.name},it.id))]}),
      i.jsxs('select',{className:'wv-input wv-select',value:kind,'aria-label':'Filtrar por tipo',onChange:ev=>setKind(ev.target.value),children:[i.jsx('option',{value:'',children:'Todos os tipos'}),...kinds.filter(k=>rows.some(r=>r.kind===k.kind)).map(k=>i.jsx('option',{value:k.kind,children:k.label},k.kind))]}),
      i.jsx('span',{className:'wv-count','aria-live':'polite',children:visible.length+(visible.length===1?' chave':' chaves')}),
      i.jsx('button',{type:'button',className:'wv-btn',onClick:load,disabled:loading,children:loading?'Atualizando…':'Atualizar'})]});
    const globalNote=data?i.jsxs('p',{className:'wv-note',children:[i.jsx('span',{className:'wv-dot','data-tone':data.openaiGlobalKey?.configured?'ok':'off','aria-hidden':'true'}),
      data.openaiGlobalKey?.configured?'Chave OpenAI global do servidor configurada (nunca exibida aqui).':'Sem chave OpenAI global no servidor: cada instância usa a própria credencial.']}):null;
    let body;
    if(error)body=i.jsxs('div',{className:'wv-callout',role:'alert',children:[i.jsx('p',{children:error}),i.jsx('button',{type:'button',className:'wv-btn',onClick:load,children:'Tentar de novo'})]});
    else if(!data)body=i.jsx('div',{className:'wv-table wv-skeleton','aria-busy':'true',children:i.jsx('span',{className:'sr-only',children:'Carregando…'})});
    else if(!visible.length)body=i.jsx('div',{className:'wv-empty',children:i.jsx('p',{className:'wv-muted',children:rows.length?'Nenhuma chave com esses filtros.':'Nenhuma chave guardada nas instâncias.'})});
    else body=i.jsxs('div',{className:'wv-table',role:'table','aria-label':'Chaves e credenciais',children:[
      i.jsxs('div',{className:'wv-row wv-row-head',role:'row',children:['Instância','Tipo','Nome','Valor',''].map((h,k)=>i.jsx('span',{role:'columnheader',className:'wv-cell',children:h?h:i.jsx('span',{className:'sr-only',children:'Ações'})},k))}),
      ...visible.map(r=>{const open=shown&&shown.key===r.key,st=STATUS[r.status]||['off',String(r.status||'—')];
        return i.jsxs('div',{className:'wv-row',role:'row','data-revealed':open?'true':void 0,children:[
          i.jsxs('span',{role:'cell',className:'wv-cell wv-inst',children:[i.jsx('span',{className:'wv-dot','data-tone':st[0],title:st[1],'aria-label':st[1]}),i.jsx('span',{className:'wv-inst-name',children:r.instance})]}),
          i.jsx('span',{role:'cell',className:'wv-cell',children:i.jsx('span',{className:'wv-chip','data-kind':r.kind,children:r.label})}),
          i.jsx('span',{role:'cell',className:'wv-cell wv-name',children:r.name||i.jsx('span',{className:'wv-muted',children:'—'})}),
          i.jsx('span',{role:'cell',className:'wv-cell wv-value',children:r.global?i.jsx('span',{className:'wv-muted',children:'usa OPENAI_API_KEY_GLOBAL'}):open?i.jsxs('span',{className:'wv-revealed',children:[i.jsx('code',{className:'wv-mono wv-mono-open',children:shown.value}),i.jsx('span',{className:'wv-timer','aria-live':'polite',children:left+' s'})]}):i.jsx('code',{className:'wv-mono',children:r.masked})}),
          i.jsx('span',{role:'cell',className:'wv-cell wv-actions',children:r.global?null:open?i.jsxs(i.Fragment,{children:[
              i.jsx('button',{type:'button',className:'wv-btn wv-btn-primary wv-btn-sm',onClick:()=>copy(shown.value),children:'Copiar'}),
              i.jsx('button',{type:'button',className:'wv-btn wv-btn-sm',onClick:()=>setShown(null),children:'Ocultar'})]}):i.jsxs(i.Fragment,{children:[
              i.jsx('button',{type:'button',className:'wv-btn wv-btn-sm',onClick:()=>reveal(r,!1),'aria-label':'Revelar '+r.label+(r.name?' '+r.name:'')+' de '+r.instance,children:'Revelar'}),
              i.jsx('button',{type:'button',className:'wv-btn wv-btn-sm wv-btn-ghost',onClick:()=>reveal(r,!0),'aria-label':'Copiar '+r.label+(r.name?' '+r.name:'')+' de '+r.instance,title:'Pede a chave do administrador e copia o valor',children:'Copiar'})]})})]},r.key)})]});
    return i.jsxs('main',{className:'wv-page',children:[head,bar,globalNote,body,target?i.jsx(Dialog,{target,onClose:()=>setTarget(null),onRevealed}):null]});
  }
  return {Page,Nav,Icon};
})();

'''

ROUTE_ANCHOR = ('{path:"/manager/observability",element:i.jsx(tn,{children:i.jsx(B5,{children:'
                'i.jsx(WhatsAIObservability.Page,{nested:!0})})})},')
ROUTE_NEW = '{path:"/manager/chaves",element:i.jsx(tn,{children:i.jsx(B5,{children:i.jsx(WaVault.Page,{})})})},'
NAV_ANCHOR = 'children:"Observabilidade"})]})}),i.jsx(iM,{}),'
TABLE_ANCHOR = '})();\n\nconst Lse=Z2(['


def apply(s):
    # Inserted between the last component block and the route table: the anchor stays exactly as it was
    s = rep(s, TABLE_ANCHOR, '})();\n\n' + COMPONENT + 'const Lse=Z2([', 'route table (after the component blocks)')
    s = rep(s, ROUTE_ANCHOR, ROUTE_ANCHOR + ROUTE_NEW, 'observability route')
    return rep(s, NAV_ANCHOR, NAV_ANCHOR + '!e&&i.jsx(WaVault.Nav,{}),', 'top bar Observabilidade link')


def patch_html(html):
    pos = html.find(CSS_ANCHOR)
    if pos < 0 or html.count(CSS_ANCHOR) != 1:
        raise PatchError('index.html: twenty-layout.css link not found exactly once (run twenty-layout.py first)')
    end = html.index('\n', pos) + 1
    return (html[:end] + '    ' + HTML_MARKER + '\n    <link rel="stylesheet" href="/assets/credentials-vault.css?v=1" />\n'
            + html[end:])


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
    missing = []
    if MARKER not in s:
        missing.append('bundle')
    if HTML_MARKER not in html:
        missing.append('html')
    if bump_index(html) != html:
        missing.append('index.html cache version')
    if not os.path.isfile(CSS):
        missing.append('credentials-vault.css')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/credentials-vault.css is missing')
    for required in REQUIRED:
        if required not in s:
            raise PatchError(f'run the patch that adds {required} first')

    report = []
    new_s = s
    if 'bundle' in missing:
        new_s = apply(s)
        report.append('bundle: applied (component, route, nav)')
    else:
        report.append('bundle: already applied')
    new_html = html
    if 'html' in missing:
        new_html = patch_html(new_html)
        report.append('html: applied')
    else:
        report.append('html: already applied')
    new_html = bump_index(new_html)

    # everything validated: write
    if new_s != s:
        open(BUNDLE, 'w', encoding='utf-8').write(new_s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        report.append(f'index.html written (credentials-vault.css ?v=1, bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
