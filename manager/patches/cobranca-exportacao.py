#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Cobrança" and "Exportar dados" tabs of "Plano e limites".

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/cobranca-exportacao.css (a plain file, edited by hand, only var(--m-*) tokens
of minimal.css, linked right after usage-limits.css).

Backend (same release):
  GET /usage/billing/:instanceName  - plan + empty billing history in its final shape (no billing source yet)
  GET /usage/export/:instanceName   - streaming ZIP download (datasets=conversas,mensagens,contatos,leads,agenda)

The page gets three tabs: "Uso" (the existing usage card and form), "Cobrança" (plan, next due date, monthly history
with receipt link and invoice data, honest empty state while the system does not register charges) and
"Exportar dados" (checkbox per dataset, streaming ZIP download, read-only notice and LGPD note).

Client access code ("wac_...", window.WaPortal.client set by assets/client-portal.js before this bundle): only "Uso"
and "Cobrança" are shown. "Exportar dados" stays with the administrator and the instance token, because the export
route is not allowed for client codes in src/utils/client-access.ts (the server answers 403 there as well).

Bundle groups (each one is applied once and leaves a marker comment at the top of the bundle):
  component - TabBar, Billing and ExportData inside the existing WaUsage IIFE (they reuse Page, Usage, fmt, errText).
  tabs      - the tab state in Page and the two returns: header + TabBar + the selected panel.
index.html group (marker: an HTML comment in <head>):
  html      - links cobranca-exportacao.css?v=1 after usage-limits.css and bumps the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.
Order: run after usage-limits.py (it needs the WaUsage component and the usage-limits.css link).

Usage (from the repository root):
  python3 -I manager/patches/cobranca-exportacao.py           # apply
  python3 -I manager/patches/cobranca-exportacao.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'cobranca-exportacao.css')
REQUIRED = ('/*whatsai-patch:usage-limits:component*/', '<!-- whatsai-patch:usage-limits:html -->')
CACHE_VERSION = '68'
SCRIPT_TAG = '<script type="module" crossorigin src="/assets/index-b29a5d7a.js?v='
CSS_ANCHOR = '    <link rel="stylesheet" href="/assets/usage-limits.css?v=1" />\n'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:cobranca-exportacao:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:cobranca-exportacao:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# Minified names: i = jsx runtime, y = React, Ee = axios instance of the API (base URL + apikey), fmt/monthLabel/errText
# come from the WaUsage IIFE (usage-limits.py).

COMPONENT = r'''
  const WC_TABS=[['uso','Uso'],['cobranca','Cobrança'],['exportar','Exportar dados']];
  const wctabs=()=>WC_TABS.filter(t=>t[0]!=='exportar'||!window.WaPortal||!window.WaPortal.client);
  const WC_BILL_STATUS={pago:['ok','Pago'],pendente:['warn','Pendente'],atrasado:['bad','Atrasado']};
  const WC_SETS=[
    ['conversas','Conversas','Lista de conversas, com nome, rótulos e não lidas.'],
    ['mensagens','Mensagens','Todo o histórico, com texto, tipo e data.'],
    ['contatos','Contatos','Nome, telefone (JID) e foto do perfil.'],
    ['leads','Leads e triagem','Fichas de triagem, prioridade e próximo passo.'],
    ['agenda','Agenda','Compromissos, horários e situação.']];
  const wctext=v=>v==null||v===''?'':String(v);
  const wcbrl=v=>v==null||!Number.isFinite(Number(v))?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v));
  const wcdate=v=>{if(!v)return '';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('pt-BR'):String(v)};

  function TabBar({tab,onTab}){
    return i.jsx('nav',{className:'wc-tabs',role:'tablist','aria-label':'Seções de Plano e limites',children:wctabs().map(([id,label])=>i.jsx('button',{type:'button',role:'tab',id:'wc-tab-'+id,'aria-selected':tab===id?'true':'false',className:'wc-tab','data-active':tab===id?'true':void 0,onClick:()=>onTab(id),children:label},id))});
  }

  function useBilling(name){
    const[st,set]=y.useState({data:null,error:'',loading:!0});
    const load=y.useCallback(async()=>{if(!name)return;set(p=>({...p,loading:!0}));try{const r=await Ee.get('/usage/billing/'+encodeURIComponent(name));set({data:r.data,error:'',loading:!1})}catch(e){set({data:null,error:errText(e),loading:!1})}},[name]);
    y.useEffect(()=>{load()},[load]);
    return{...st,reload:load};
  }

  function Billing({instance}){
    const{data,error,reload}=useBilling(instance?.name);
    if(error)return i.jsxs('div',{className:'wu-callout','data-tone':'bad',role:'alert',children:[i.jsx('p',{children:error}),i.jsx('button',{type:'button',className:'wu-btn',onClick:reload,children:'Tentar de novo'})]});
    if(!data)return i.jsx('section',{className:'wu-card wu-skeleton','aria-busy':'true',children:i.jsx('span',{className:'sr-only',children:'Carregando a cobrança…'})});
    const plan=data.plan||{},invoice=data.invoice||{},history=Array.isArray(data.history)?data.history:[];
    return i.jsxs('div',{className:'wc-panel',role:'tabpanel',id:'wc-panel-cobranca','aria-labelledby':'wc-tab-cobranca',children:[
      i.jsxs('section',{className:'wu-card','aria-labelledby':'wc-plan-title',children:[
        i.jsxs('div',{className:'wu-card-head',children:[
          i.jsx('h2',{id:'wc-plan-title',className:'wu-card-title',children:'Plano'}),
          i.jsx('span',{className:'wu-chip','data-tone':plan.configured?'ok':'warn',children:plan.configured?'Configurado':'Plano padrão'})]}),
        i.jsx('p',{className:'wu-big',children:plan.name?'Plano '+plan.name:'Nenhum plano configurado'}),
        i.jsx('p',{className:'wu-muted',children:plan.monthlyResponses?fmt(plan.monthlyResponses)+' respostas por mês incluídas no plano.':plan.name?'Plano sem franquia definida.':'Defina o plano na aba Uso para acompanhar a franquia.'})]}),
      i.jsxs('section',{className:'wu-card','aria-labelledby':'wc-due-title',children:[
        i.jsx('h2',{id:'wc-due-title',className:'wu-card-title',children:'Próximo vencimento'}),
        data.nextDueDate?i.jsx('p',{className:'wu-big',children:wcdate(data.nextDueDate)}):i.jsx('p',{className:'wu-muted',children:'Nenhuma cobrança registrada ainda.'}),
        data.paymentMethod?i.jsx('p',{className:'wu-hint',children:'Forma de pagamento: '+wctext(data.paymentMethod)}):null]}),
      i.jsxs('section',{className:'wu-card','aria-labelledby':'wc-history-title',children:[
        i.jsx('h2',{id:'wc-history-title',className:'wu-card-title',children:'Histórico mensal'}),
        history.length?i.jsx('div',{className:'wc-table-wrap',children:i.jsxs('table',{className:'wc-table',children:[
          i.jsx('thead',{children:i.jsx('tr',{children:['Mês','Valor','Situação','Comprovante'].map(h=>i.jsx('th',{scope:'col',children:h},h))})}),
          i.jsx('tbody',{children:history.map((row,k)=>{const st=WC_BILL_STATUS[row.status]||[];return i.jsxs('tr',{children:[
            i.jsx('td',{children:monthLabel(row.period)||wctext(row.period)}),
            i.jsx('td',{className:'wc-money',children:wcbrl(row.amountBRL)}),
            i.jsx('td',{children:st[0]?i.jsxs('span',{className:'wu-chip','data-tone':st[0],children:[i.jsx('span',{className:'wu-dot','aria-hidden':'true'}),st[1]]}):wctext(row.status)||'—'}),
            i.jsx('td',{children:row.receiptUrl?i.jsx('a',{className:'wu-link',href:row.receiptUrl,target:'_blank',rel:'noopener noreferrer',children:'Abrir comprovante'}):'—'})]},wctext(row.period)+'-'+k)})})]})})
          :i.jsxs('div',{className:'wc-empty',children:[i.jsx('strong',{children:'Nenhuma cobrança registrada ainda.'}),i.jsx('span',{children:wctext(data.note)})]})]}),
      i.jsxs('section',{className:'wu-card','aria-labelledby':'wc-invoice-title',children:[
        i.jsx('h2',{id:'wc-invoice-title',className:'wu-card-title',children:'Dados para nota fiscal'}),
        invoice.legalName||invoice.taxId||invoice.email||invoice.address?i.jsxs('dl',{className:'wu-stats',children:[
          i.jsxs('div',{children:[i.jsx('dt',{children:'Razão social ou nome'}),i.jsx('dd',{children:wctext(invoice.legalName)||'—'})]}),
          i.jsxs('div',{children:[i.jsx('dt',{children:'CPF ou CNPJ'}),i.jsx('dd',{children:wctext(invoice.taxId)||'—'})]}),
          i.jsxs('div',{children:[i.jsx('dt',{children:'E-mail'}),i.jsx('dd',{children:wctext(invoice.email)||'—'})]}),
          i.jsxs('div',{children:[i.jsx('dt',{children:'Endereço'}),i.jsx('dd',{children:wctext(invoice.address)||'—'})]})]})
          :i.jsx('div',{className:'wc-empty',children:i.jsx('span',{children:'Os dados para nota fiscal ainda não foram preenchidos. Quando a cobrança for registrada, eles ficam guardados aqui.'})})]})
    ]});
  }

  function ExportData({instance}){
    const[selected,setSelected]=y.useState(WC_SETS.map(s=>s[0]));
    const[busy,setBusy]=y.useState(!1),[error,setError]=y.useState(''),[done,setDone]=y.useState('');
    const toggle=id=>setSelected(cur=>cur.includes(id)?cur.filter(x=>x!==id):[...cur,id]);
    const download=async()=>{
      if(!selected.length||busy)return;
      setBusy(!0);setError('');setDone('');
      try{
        const r=await Ee.get('/usage/export/'+encodeURIComponent(instance?.name),{params:{datasets:selected.join(',')},responseType:'blob'});
        const found=/filename="([^"]+)"/.exec(String(r.headers?.['content-disposition']||''));
        const file=found?found[1]:'dados-'+instance?.name+'-'+new Date().toISOString().slice(0,10)+'.zip';
        const url=URL.createObjectURL(r.data);
        const link=document.createElement('a');
        link.href=url;link.download=file;document.body.appendChild(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),30000);
        setDone('Download iniciado: '+file+'.');
      }catch(e){setError(errText(e))}
      finally{setBusy(!1)}
    };
    return i.jsxs('div',{className:'wc-panel',role:'tabpanel',id:'wc-panel-exportar','aria-labelledby':'wc-tab-exportar',children:[
      i.jsxs('section',{className:'wu-card','aria-labelledby':'wc-export-title',children:[
        i.jsx('h2',{id:'wc-export-title',className:'wu-card-title',children:'Exportar dados da instância'}),
        i.jsx('p',{className:'wu-muted',children:'Baixe uma cópia dos dados desta instância em um arquivo ZIP com planilhas CSV. As planilhas abrem direto no Excel em português.'}),
        i.jsx('div',{className:'wc-checks',role:'group','aria-label':'O que exportar',children:WC_SETS.map(([id,label,hint])=>i.jsxs('label',{className:'wc-check',children:[
          i.jsx('input',{type:'checkbox',checked:selected.includes(id),onChange:()=>toggle(id)}),
          i.jsxs('span',{children:[i.jsx('span',{className:'wc-check-title',children:label}),i.jsx('span',{className:'wu-hint',children:hint})]})]},id))}),
        i.jsxs('div',{className:'wu-actions',children:[
          i.jsx('button',{type:'button',className:'wu-btn',disabled:selected.length===WC_SETS.length||busy,onClick:()=>setSelected(WC_SETS.map(s=>s[0])),children:'Selecionar tudo'}),
          i.jsx('button',{type:'button',className:'wu-btn wu-btn-primary',disabled:!selected.length||busy,onClick:download,'aria-busy':busy?'true':void 0,children:busy?'Gerando o arquivo…':'Baixar ZIP'})]}),
        done?i.jsx('p',{className:'wc-done',role:'status',children:done}):null,
        error?i.jsxs('div',{className:'wu-callout','data-tone':'bad',role:'alert',children:[i.jsx('p',{children:error}),i.jsx('button',{type:'button',className:'wu-btn',onClick:download,children:'Tentar de novo'})]}):null,
        !selected.length?i.jsx('p',{className:'wu-hint',children:'Escolha pelo menos uma opção para exportar.'}):null,
        i.jsxs('div',{className:'wc-note',children:[
          i.jsx('strong',{children:'Somente leitura'}),
          i.jsx('p',{children:'A exportação não apaga nem altera nada e não toca na conexão do WhatsApp. O arquivo é gerado durante o download: instâncias com muitas mensagens podem demorar alguns minutos.'}),
          i.jsx('p',{children:'O arquivo contém conversas e dados pessoais dos contatos. Guarde com cuidado: a exportação atende ao direito de portabilidade da LGPD.'})]})]})]});
  }

'''

PAGE_STATE_OLD = '    y.useEffect(()=>{loadLimits()},[loadLimits]);\n    if(!g)return null;'
PAGE_STATE_NEW = ('    y.useEffect(()=>{loadLimits()},[loadLimits]);\n'
                  "    const[tab,setTab]=y.useState('uso');\n    if(!g)return null;")

LOADING_OLD = "if(!form)return i.jsxs('main',{className:'wu-page',children:[header,usage,loadError?"
LOADING_NEW = ("if(!form)return i.jsxs('main',{className:'wu-page',children:[header,i.jsx(TabBar,{tab,onTab:setTab}),"
               "tab==='uso'?usage:null,tab==='cobranca'?i.jsx(Billing,{instance:g}):null,"
               "tab==='exportar'?i.jsx(ExportData,{instance:g}):null,tab==='uso'&&loadError?")

CONTENT_OLD = "    return i.jsxs('main',{className:'wu-page',children:[header,usage,\n      i.jsxs('form',"
CONTENT_NEW = ("    return i.jsxs('main',{className:'wu-page',children:[header,i.jsx(TabBar,{tab,onTab:setTab}),"
               "tab==='uso'?usage:null,tab==='cobranca'?i.jsx(Billing,{instance:g}):null,"
               "tab==='exportar'?i.jsx(ExportData,{instance:g}):null,tab==='uso'?i.jsxs('form',")

FORM_END_OLD = "children:saving?'Salvando…':'Salvar'})]})]})]});"
# The form becomes the last child of a ternary: close it with ":null" and then close <main>
FORM_END_NEW = FORM_END_OLD[:-4] + ':null' + FORM_END_OLD[-4:]

COMPONENT_ANCHOR = '  return {Page,Bar,Icon};'


def patch_component(s):
    return rep(s, COMPONENT_ANCHOR, COMPONENT + COMPONENT_ANCHOR, 'WaUsage return (run usage-limits.py first)')


def patch_tabs(s):
    s = rep(s, PAGE_STATE_OLD, PAGE_STATE_NEW, 'Page tab state')
    s = rep(s, LOADING_OLD, LOADING_NEW, 'Page loading return')
    s = rep(s, CONTENT_OLD, CONTENT_NEW, 'Page content return')
    return rep(s, FORM_END_OLD, FORM_END_NEW, 'Page form close')


GROUPS = [('component', patch_component), ('tabs', patch_tabs)]


def patch_html(html):
    return rep(html, CSS_ANCHOR,
               CSS_ANCHOR + '    ' + html_marker('html') + '\n'
               '    <link rel="stylesheet" href="/assets/cobranca-exportacao.css?v=1" />\n',
               'index.html usage-limits.css link (run usage-limits.py first)')


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
        missing.append('cobranca-exportacao.css')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/cobranca-exportacao.css is missing')
    for required in REQUIRED:
        if required not in s and required not in html:
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
        report.append(f'index.html written (cobranca-exportacao.css ?v=1, bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
