#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: honest error and loading states (proposal T).

When the API did not answer, the panel either went blank or showed the server's raw English text:
- if the instance itself could not be loaded, every instance page (Visão Geral, Conversas, Leads, Agenda, Processos…)
  rendered nothing, and Conversas read "Nenhuma conversa ainda" as if the data were gone;
- Leads, Agenda and Processos printed "Internal Server Error"; Processos had no way to try again;
- Instâncias said "use Mais → Atualizar lista" instead of offering the button;
- Leads showed only the words "Carregando leads…" while the database woke up.

1. friendly - every errText() of the patched pages maps a 5xx without a real message ("Internal Server Error",
              "Bad Gateway"…) to "O servidor não respondeu agora. Seus dados continuam salvos…". Messages written by
              the API (validation, 4xx, meaningful 5xx) are kept as they are.
2. gate     - the instance provider also exposes isLoading/isError; the instance layout shows a skeleton while the
              instance loads and, if it fails, a block "Não deu para carregar esta instância" with "Tentar de novo"
              (refetches the instance) instead of a blank page.
3. proc     - Processos: the error callout gets "Tentar de novo".
4. inst     - Instâncias: when the list could not be loaded, a "Tentar de novo" button in the empty block.
5. leads    - Leads: a table skeleton while the first page loads.
6. html     - links /assets/states.css and raises the bundle ?v= to CACHE_VERSION.

Every anchor must match the expected number of times, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after a11y-404.py.

Usage (from the repository root):
  python3 -I manager/patches/states.py           # apply
  python3 -I manager/patches/states.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '50'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_VERSION = '1'
CSS_TAG = '<link rel="stylesheet" href="/assets/states.css?v=' + CSS_VERSION + '" />'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:states:' + name + '*/'


def rep(s, old, new, label, times=1):
    n = s.count(old)
    if n != times:
        raise PatchError(f'{label}: anchor expected {times}x, got {n}')
    return s.replace(old, new)


SERVER_DOWN = 'O servidor não respondeu agora. Seus dados continuam salvos; tente de novo em alguns segundos.'
FRIENDLY = (
    'function waFriendlyErr(e){const st=e?.response?.status;if(!e?.response||!(st>=500))return null;'
    'const m=e.response.data?.response?.message??e.response.data?.message??e.response.data?.error;'
    "const t=[].concat(m??[]).flat(4).map(x=>typeof x==='string'?x:'').join(' ').trim();"
    "return !t||/^(internal server error|bad gateway|service unavailable|gateway timeout|error)$/i.test(t)?'"
    + SERVER_DOWN + "':null}\n"
)


def g_friendly(s):
    s = rep(s, 'function errText(e){', 'function errText(e){const waF=waFriendlyErr(e);if(waF)return waF;',
            'errText helpers', times=5)
    return FRIENDLY + s


PROVIDER_OLD = (
    '{data:s,refetch:o}=vT({instanceId:n});return y.useEffect(()=>{t.instanceId?r(t.instanceId):r(null)},[t]),'
    'i.jsx(UM.Provider,{value:{instance:s??null,reloadInstance:async()=>{await o()}},children:e})};'
)
PROVIDER_NEW = (
    '{data:s,refetch:o,isLoading:waILoad,isError:waIErr}=vT({instanceId:n});return y.useEffect(()=>{t.instanceId?r(t.instanceId):r(null)},[t]),'
    'i.jsx(UM.Provider,{value:{instance:s??null,instanceLoading:!!n&&waILoad,instanceError:waIErr,reloadInstance:async()=>{await o()}},children:e})};'
    'function WaInstGate({children:e}){const c=y.useContext(UM),[busy,setBusy]=y.useState(!1);'
    'if(c&&!c.instance&&c.instanceError)return i.jsxs("div",{className:"wa-tw-empty wa-state-block",role:"alert",children:['
    'i.jsx("p",{className:"wa-tw-empty-title",children:"Não deu para carregar esta instância"}),'
    'i.jsx("p",{className:"wa-tw-empty-text",children:"O servidor não respondeu a tempo. Seus dados continuam salvos; nada foi apagado."}),'
    'i.jsx("button",{type:"button",className:"wa-tw-sbtn",disabled:busy,onClick:async()=>{setBusy(!0);try{await c.reloadInstance()}finally{setBusy(!1)}},'
    'children:busy?"Tentando…":"Tentar de novo"})]});'
    'if(c&&!c.instance&&c.instanceLoading)return i.jsxs("div",{className:"wa-state-skel",role:"status","aria-busy":"true",children:['
    'i.jsx("span",{className:"sr-only",children:"Carregando…"}),'
    'i.jsx("span",{className:"wa-sk wa-state-sk-title"}),i.jsx("span",{className:"wa-sk wa-state-sk-line"}),'
    'i.jsx("span",{className:"wa-sk wa-state-sk-box"})]});return e}'
)
LAYOUT_OLD = 'i.jsx("div",{className:"my-2 flex flex-1 flex-col gap-2 pl-2 pr-4 wa-is-page",children:e})'
LAYOUT_NEW = 'i.jsx("div",{className:"my-2 flex flex-1 flex-col gap-2 pl-2 pr-4 wa-is-page",children:i.jsx(WaInstGate,{children:e})})'


def g_gate(s):
    s = rep(s, PROVIDER_OLD, PROVIDER_NEW, 'instance provider')
    return rep(s, LAYOUT_OLD, LAYOUT_NEW, 'instance layout')


PROC_OLD = (
    "err?i.jsx('p',{className:'wp-callout','data-tone':'bad',role:'alert',children:err}):null,\n"
    "      !data&&!err?i.jsx('div',{className:'wp-skeleton','aria-busy':'true'}):null,"
)
PROC_NEW = (
    "err?i.jsxs('div',{className:'wp-callout wa-state-callout','data-tone':'bad',role:'alert',children:[i.jsx('p',{children:err}),"
    "i.jsx('button',{type:'button',className:'wa-tw-sbtn',onClick:()=>{setErr('');load()},children:'Tentar de novo'})]}):null,\n"
    "      !data&&!err?i.jsx('div',{className:'wp-skeleton','aria-busy':'true'}):null,"
)


def g_proc(s):
    return rep(s, PROC_OLD, PROC_NEW, 'processos error callout')


INST_OLD = (
    "all.length&&(q||chipsOn||v.view!=='all')?i.jsx('button',{type:'button',className:'wa-ut-tbtn wa-ut-tbtn--line',"
    "onClick:()=>{setQ('');set({view:'all',ints:[]})},children:i.jsx('span',{children:'Mostrar todas'})}):null]}):null,"
)
INST_NEW = (
    "all.length&&(q||chipsOn||v.view!=='all')?i.jsx('button',{type:'button',className:'wa-ut-tbtn wa-ut-tbtn--line',"
    "onClick:()=>{setQ('');set({view:'all',ints:[]})},children:i.jsx('span',{children:'Mostrar todas'})}):null,"
    "!all.length&&!list?i.jsx('button',{type:'button',className:'wa-ut-tbtn wa-ut-tbtn--line',onClick:()=>refresh(),"
    "children:i.jsx('span',{children:'Tentar de novo'})}):null]}):null,"
)


def g_inst(s):
    s = rep(s, "'Confira a conexão e use Mais → Atualizar lista.'", "'O servidor não respondeu. Seus dados continuam salvos.'",
            'instances empty text')
    return rep(s, INST_OLD, INST_NEW, 'instances empty actions')


LEADS_OLD = (
    "else if(!d)body=i.jsx('div',{className:'wa-tw-empty',role:'status',children:i.jsx('p',{className:'wa-tw-empty-text',"
    "children:'Carregando leads…'})});"
)
LEADS_NEW = (
    "else if(!d)body=i.jsxs('div',{className:'wa-state-rows',role:'status','aria-busy':'true',children:["
    "i.jsx('span',{className:'sr-only',children:'Carregando leads…'}),"
    "[0,1,2,3,4,5].map(k=>i.jsxs('div',{className:'wa-state-row','aria-hidden':'true',children:["
    "i.jsx('span',{className:'wa-sk wa-state-c1'}),i.jsx('span',{className:'wa-sk wa-state-c2'}),"
    "i.jsx('span',{className:'wa-sk wa-state-c3'}),i.jsx('span',{className:'wa-sk wa-state-c4'})]},k))]});"
)


def g_leads(s):
    return rep(s, LEADS_OLD, LEADS_NEW, 'leads loading')


GROUPS = [('friendly', g_friendly), ('gate', g_gate), ('proc', g_proc), ('inst', g_inst), ('leads', g_leads)]


def patch_index(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag expected once')
    start = pos + len(SCRIPT_TAG)
    end = start
    while end < len(html) and html[end].isdigit():
        end += 1
    current = html[start:end]
    if not current or int(current) < int(CACHE_VERSION):
        html = html[:start] + CACHE_VERSION + html[end:]
    if CSS_TAG not in html:
        if '/assets/states.css' in html:
            raise PatchError('index.html: states.css present with another version; edit CSS_VERSION')
        anchor = '    <script src="/assets/client-portal.js'
        if html.count(anchor) != 1:
            raise PatchError('index.html: client-portal.js script line expected once')
        html = html.replace(anchor, '    ' + CSS_TAG + '\n' + anchor, 1)
    return html


def main():
    check = '--check' in sys.argv[1:]
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    missing = [name for name, _ in GROUPS if marker(name) not in s]
    if patch_index(html) != html:
        missing.append('index.html')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = patch_index(html)
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: bundle ?v={CACHE_VERSION}, states.css ?v={CSS_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
