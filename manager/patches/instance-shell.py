#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: the instance pages get the same Twenty layout as the instance list.

Before: the list of instances (and the global pages) used the Twenty-like shell of app-shell.py: gray sidebar with
the WhatsAI wordmark on top, the page inside a bordered card, small title. The pages of an instance (Visão Geral,
Conversas, Leads, Agenda, Processos, Configurações...) still had the old layout: a white top bar across the whole
width with the wordmark, a white sidebar with a border, the page loose on a gray background and titles of 20 to 24px
in different weights. Going from "Instâncias" to an instance looked like another product.

1. shell      - layout "un": classes for instance-shell.css (wa-is, wa-is-row, wa-is-nav, wa-is-main, wa-is-page),
                the WhatsAI wordmark and a "Recolher menu" button at the top of the sidebar (WaIs.Top), the license
                notice (WaShell.Notice) at its foot, and the menu state shared with the global pages
                (localStorage wa-shell-side): on desktop the menu button of the top bar opens the collapsed sidebar,
                below 1024px it still opens the drawer.
2. logout     - "Sair do painel?" of the instance top bar no longer mentions the server URL (the login asks only
                for the key; app-shell.py fixed the same text in the global shell).
3. evolution  - "Nova instância" offers only the two WhatsApp channels: WhatsApp pelo QR code (Baileys, now the
                default, the channel the description of the dialog talks about) and WhatsApp Cloud API (oficial da
                Meta). The "Evolution" channel (an Evolution-to-Evolution bridge nobody here uses) is gone from the
                options and from the form schema. Existing instances are not touched.
4. crumbs     - the breadcrumb and the Ctrl K menu (WaTw.PAGES) also know Contatos da IA, Processos, Conexão and
                Acesso do cliente: the trilha showed only "Instâncias / <instância>" on those pages.
5. html       - links instance-shell.css?v=CSS_VERSION last and raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after app-shell.py and confirmacoes.py.

Usage (from the repository root):
  python3 -I manager/patches/instance-shell.py           # apply
  python3 -I manager/patches/instance-shell.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'instance-shell.css')
REQUIRED = ('/*whatsai-patch:app-shell:shell*/',)
CACHE_VERSION = '44'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_VERSION = '1'
CSS_LINK = '    <link rel="stylesheet" href="/assets/instance-shell.css?v=' + CSS_VERSION + '" />\n'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:instance-shell:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:instance-shell:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


# ------------------------------------------------------------------------------------------------- 1. shell
WAIS_ANCHOR = 'return{Global,Notice,PAGES};\n})();\n'
WAIS = r"""
const WaIs=(()=>{
  // Top of the instance sidebar: same wordmark and collapse button as WaShell.Global.
  function Top({onCollapse}){
    const svg=WaUt.svg;
    return i.jsxs('div',{className:'wa-ut-side-top wa-is-top',children:[
      i.jsx(Fu,{to:'/manager/',className:'wa-ut-ws','aria-label':'WhatsAI: voltar para as instâncias',children:i.jsx('span',{className:'wa-wordmark',children:'WhatsAI'})}),
      i.jsx('div',{className:'wa-ut-side-icons',children:i.jsx('button',{type:'button',className:'wa-ut-ibtn wa-ut-side-collapse','aria-label':'Recolher menu',title:'Recolher menu',onClick:onCollapse,children:svg('panel',15)})})]});
  }
  function readSide(){try{return localStorage.getItem('wa-shell-side')==='closed'?'closed':'open'}catch(e){return'open'}}
  function saveSide(v){try{localStorage.setItem('wa-shell-side',v)}catch(e){}}
  function desktop(){return!!(window.matchMedia&&window.matchMedia('(min-width: 1024px)').matches)}
  return{Top,readSide,saveSide,desktop};
})();
"""

STATE_OLD = '[waOpen,waSetOpen]=y.useState(!1)'
STATE_NEW = ('[waOpen,waSetOpen]=y.useState(!1),[waSide,waSetSideRaw]=y.useState(()=>WaIs.readSide()),'
             'waSetSide=v=>{waSetSideRaw(v);WaIs.saveSide(v)}')
ROOT_OLD = ('i.jsxs("div",{className:"flex h-screen flex-col","data-wa-layout":"",children:['
            'i.jsx(zM,{instanceId:t,onMenu:()=>waSetOpen(v=>!v),menuOpen:waOpen})')
ROOT_NEW = ('i.jsxs("div",{className:"flex h-screen flex-col wa-is","data-wa-layout":"","data-side":waSide,children:['
            'i.jsx(zM,{instanceId:t,onMenu:()=>{if(WaIs.desktop())waSetSide(waSide==="closed"?"open":"closed");'
            'else waSetOpen(v=>!v)},menuOpen:waOpen})')
ROW_OLD = '"flex min-h-[calc(100vh_-_56px)] flex-1 flex-col md:flex-row"'
ROW_NEW = '"flex min-h-[calc(100vh_-_56px)] flex-1 flex-col md:flex-row wa-is-row"'
NAV_OLD = 'i.jsx(Wy,{className:"mr-2 py-6 md:w-64",id:"wa-sidebar"'
NAV_NEW = 'i.jsx(Wy,{className:"mr-2 py-6 md:w-64 wa-is-nav",id:"wa-sidebar"'
NAVBODY_OLD = 'i.jsx("div",{className:"flex h-full",children:i.jsx(j5,{})})'
NAVBODY_NEW = ('i.jsxs("div",{className:"flex h-full wa-is-side",children:[i.jsx(WaIs.Top,{onCollapse:()=>waSetSide("closed")}),'
               'i.jsx(j5,{}),i.jsx(WaShell.Notice,{})]})')
MAIN_OLD = ('i.jsx(Wy,{className:"w-full",children:i.jsxs("div",{className:"flex h-full flex-col",children:['
            'i.jsx("div",{className:"my-2 flex flex-1 flex-col gap-2 pl-2 pr-4",children:e})')
MAIN_NEW = ('i.jsx(Wy,{className:"w-full wa-is-main",children:i.jsxs("div",{className:"flex h-full flex-col",children:['
            'i.jsx("div",{className:"my-2 flex flex-1 flex-col gap-2 pl-2 pr-4 wa-is-page",children:e})')


def g_shell(s):
    s = rep(s, WAIS_ANCHOR, WAIS_ANCHOR + WAIS, 'WaIs after WaShell')
    for old, new, label in ((STATE_OLD, STATE_NEW, 'layout state'), (ROOT_OLD, ROOT_NEW, 'layout root'),
                            (ROW_OLD, ROW_NEW, 'layout row'), (NAV_OLD, NAV_NEW, 'layout sidebar'),
                            (NAVBODY_OLD, NAVBODY_NEW, 'sidebar body'), (MAIN_OLD, MAIN_NEW, 'layout main')):
        s = rep(s, old, new, label)
    return s


# ------------------------------------------------------------------------------------------------- 2. logout
BYE_OLD = 'i.jsx(eo,{children:"Para entrar de novo você vai precisar da URL do servidor e da chave de API."})'
BYE_NEW = 'i.jsx(eo,{children:"Para entrar de novo você vai precisar da chave de acesso."})'


def g_logout(s):
    return rep(s, BYE_OLD, BYE_NEW, 'instance logout text')


# ------------------------------------------------------------------------------------------------- 3. evolution
ENUM_OLD = 'integration:P.enum(["WHATSAPP-BUSINESS","WHATSAPP-BAILEYS","EVOLUTION"])'
ENUM_NEW = 'integration:P.enum(["WHATSAPP-BUSINESS","WHATSAPP-BAILEYS"])'
OPTS_OLD = ('o=[{value:"WHATSAPP-BAILEYS",label:t("instance.form.integration.baileys")},{value:"WHATSAPP-BUSINESS",'
            'label:t("instance.form.integration.whatsapp")},{value:"EVOLUTION",label:t("instance.form.integration.evolution")}]')
OPTS_NEW = ('o=[{value:"WHATSAPP-BAILEYS",label:"WhatsApp pelo QR code (Baileys)"},{value:"WHATSAPP-BUSINESS",'
            'label:"WhatsApp Cloud API (oficial da Meta)"}]')
DEFAULT_OLD = 'defaultValues:{name:"",integration:"WHATSAPP-BUSINESS",token:E1().replace("-","").toUpperCase()'
DEFAULT_NEW = 'defaultValues:{name:"",integration:"WHATSAPP-BAILEYS",token:E1().replace("-","").toUpperCase()'
RESET_OLD = 'l.reset({name:"",integration:"WHATSAPP-BUSINESS",token:E1().replace("-","").toLocaleUpperCase()'
RESET_NEW = 'l.reset({name:"",integration:"WHATSAPP-BAILEYS",token:E1().replace("-","").toLocaleUpperCase()'
DESC_OLD = ('"Dê um nome e escolha a integração. Depois de criar, leia o QR Code na página da instância para conectar o '
            'WhatsApp."')
DESC_NEW = ('"Dê um nome e escolha o canal. Pelo QR code, depois de criar, leia o código na página da instância com o '
            'WhatsApp do celular."')


def g_evolution(s):
    for old, new, label in ((ENUM_OLD, ENUM_NEW, 'integration enum'), (OPTS_OLD, OPTS_NEW, 'integration options'),
                            (DEFAULT_OLD, DEFAULT_NEW, 'default integration'), (RESET_OLD, RESET_NEW, 'reset integration'),
                            (DESC_OLD, DESC_NEW, 'dialog description')):
        s = rep(s, old, new, label)
    return s


# ------------------------------------------------------------------------------------------------- 4. crumbs
CRUMBS_OLD = "['observability','Observabilidade','pulse'],['settings','Comportamento','cog']];"
CRUMBS_NEW = ("['observability','Observabilidade','pulse'],['settings','Comportamento','cog'],"
              "['contatos-ia','Contatos da IA','bot'],['processos','Processos','book'],['conexao','Conexão','phone'],"
              "['acesso-cliente','Acesso do cliente','users']];")


def g_crumbs(s):
    return rep(s, CRUMBS_OLD, CRUMBS_NEW, 'WaTw pages')


GROUPS = [('shell', g_shell), ('logout', g_logout), ('evolution', g_evolution), ('crumbs', g_crumbs)]


def patch_html(html):
    anchor = '    <link rel="stylesheet" href="/assets/client-portal.css?v='
    if html.count(anchor) != 1:
        raise PatchError('index.html: client-portal.css link expected once')
    out = html
    pos = out.find('\n', out.find(anchor)) + 1
    out = out[:pos] + CSS_LINK + out[pos:]
    return out.replace('</head>', '    ' + html_marker('html') + '\n  </head>', 1)


def bump_css(html):
    return re.sub(r'(/assets/instance-shell\.css\?v=)(\d+)',
                  lambda m: m.group(1) + (CSS_VERSION if int(m.group(2)) < int(CSS_VERSION) else m.group(2)), html)


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


def main():
    check = '--check' in sys.argv[1:]
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    for req in REQUIRED:
        if req not in s:
            raise PatchError(f'required patch missing: {req}')
    if not os.path.isfile(CSS):
        raise PatchError('instance-shell.css not found')
    missing = [name for name, _ in GROUPS if marker(name) not in s]
    if html_marker('html') not in html:
        missing.append('html')
    if bump_index(bump_css(html)) != html:
        missing.append('index.html versions')
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
    new_html = patch_html(html) if 'html' in missing else html
    new_html = bump_index(bump_css(new_html))
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: instance-shell.css?v={CSS_VERSION}, bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
