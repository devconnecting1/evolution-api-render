#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: one app shell, like the shadcn/ui Sidebar blocks.

Before: the instance list had a sidebar, the instance pages had another one, and the global pages (Observabilidade,
Chaves e credenciais, Retenção) had none, only the old top bar. The list grew with its rows and the whole page
scrolled. Now:

1. expose - WaUt also exports its icon helper (svg) and ConfirmDialog, used by the shell.
2. shell  - WaShell.Global: the same sidebar as the instance list (Espaço de trabalho: Instâncias, Observabilidade,
            Chaves e credenciais, Retenção (LGPD); Outros: Sair), a header with the menu button and the theme, and
            the page in a card that scrolls by itself. Same classes as the list (ui-tables.css), so on phones and
            tablets the sidebar is a drawer and on desktop it collapses.
3. layout - B5 (layout of the global pages) renders WaShell.Global instead of the old top bar; the instance list
            (/manager/, CZ) has its own shell and no longer goes through B5.
4. logout - "Sair do painel?" no longer mentions the server URL (the login asks only for the key).
   notice - the Evolution API usage notice required by its license (LICENSE, condition 1b: visible to the
            administrators, inside the system) at the foot of both sidebars. It used to be in the Manual footer,
            which left the panel. Clients (wac_ codes) never see these sidebars.
5. html   - links app-shell.css?v=CSS_VERSION (viewport-height shell: the page never scrolls, the content does) and raises the
            bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after ui-tables.py, client-portal.py and
no-manual.py.

Usage (from the repository root):
  python3 -I manager/patches/app-shell.py           # apply
  python3 -I manager/patches/app-shell.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'app-shell.css')
CACHE_VERSION = '40'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_VERSION = '2'
CSS_LINK = '    <link rel="stylesheet" href="/assets/app-shell.css?v=' + CSS_VERSION + '" />\n'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:app-shell:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:app-shell:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


EXPOSE_OLD = '  return{Instances,UsageChip,Checklist,toastIcon,ToastClose,navLabel,convStatus};\n})();\n'
EXPOSE_NEW = '  return{Instances,UsageChip,Checklist,toastIcon,ToastClose,navLabel,convStatus,svg,ConfirmDialog};\n})();\n'

# Global pages of the panel, in menu order: [icon, label, path]. The instance list is /manager/.
SHELL = r"""
const WaShell=(()=>{
  const PAGES=[['db','Instâncias','/manager/'],['pulse','Observabilidade','/manager/observability'],
    ['lock','Chaves e credenciais','/manager/chaves'],['cal','Retenção (LGPD)','/manager/retencao']];
  function ls_(k,v){try{if(v===void 0)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){}return null}
  // License of Evolution API, condition 1b: usage notice visible to the administrators inside the system.
  function Notice(){return i.jsx('p',{className:'wa-ut-side-note wa-shell-notice',children:'Este sistema usa o Evolution API (licença Apache 2.0 com condições adicionais).'})}
  function Global({children}){
    const {pathname}=Pi(),nav=dn(),svg=WaUt.svg;
    const [side,setSide]=y.useState(()=>ls_('wa-shell-side')==='closed'?'closed':'open'),[drawer,setDrawer]=y.useState(!1),[bye,setBye]=y.useState(!1);
    y.useEffect(()=>{setDrawer(!1)},[pathname]);
    y.useEffect(()=>{if(!drawer)return;const k=e=>{e.key==='Escape'&&setDrawer(!1)};window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[drawer]);
    const setS=v=>{setSide(v);ls_('wa-shell-side',v)};
    const cur=PAGES.find(p=>p[2]!=='/manager/'&&pathname.startsWith(p[2]))||null;
    const item=(p)=>i.jsx('li',{children:i.jsxs(Fu,{to:p[2],className:'wa-ut-nav-item','aria-current':cur===p?'page':void 0,children:[svg(p[0],15),i.jsx('span',{children:p[1]})]})},p[2]);
    return i.jsxs('div',{className:'wa-ut-app wa-shell','data-shell':'global','data-side':side,'data-drawer':drawer?'true':void 0,children:[
      drawer?i.jsx('div',{className:'wa-ut-scrim','aria-hidden':'true',onClick:()=>setDrawer(!1)}):null,
      i.jsxs('nav',{className:'wa-ut-side',id:'wa-shell-side','aria-label':'Menu do painel',children:[
        i.jsxs('div',{className:'wa-ut-side-top',children:[
          i.jsx(Fu,{to:'/manager/',className:'wa-ut-ws','aria-label':'WhatsAI: instâncias',children:i.jsx('span',{className:'wa-wordmark',children:'WhatsAI'})}),
          i.jsx('div',{className:'wa-ut-side-icons',children:i.jsx('button',{type:'button',className:'wa-ut-ibtn wa-ut-side-collapse','aria-label':'Recolher menu',title:'Recolher menu',onClick:()=>{setDrawer(!1);setS('closed')},children:svg('panel',15)})})]}),
        i.jsx('p',{className:'wa-ut-side-label',children:'Espaço de trabalho'}),
        i.jsx('ul',{className:'wa-ut-nav',children:PAGES.map(item)}),
        i.jsx('p',{className:'wa-ut-side-label',children:'Outros'}),
        i.jsx('ul',{className:'wa-ut-nav',children:i.jsx('li',{children:i.jsxs('button',{type:'button',className:'wa-ut-nav-item',onClick:()=>setBye(!0),children:[svg('logout',15),i.jsx('span',{children:'Sair'})]})})}),
        i.jsx(Notice,{})]}),
      i.jsxs('section',{className:'wa-ut-main','aria-label':cur?cur[1]:'Painel',children:[
        i.jsxs('header',{className:'wa-ut-top',children:[
          i.jsx('button',{type:'button',className:'wa-ut-ibtn wa-ut-side-open','aria-label':'Abrir menu','aria-expanded':drawer||side==='open'?'true':'false','aria-controls':'wa-shell-side',onClick:()=>{if(window.matchMedia('(min-width: 1024px)').matches)setS('open');else setDrawer(d=>!d)},children:svg('menu',17)}),
          i.jsxs('p',{className:'wa-ut-title',children:[i.jsx('span',{className:'wa-ut-title-ic',children:svg(cur?cur[0]:'db',14)}),cur?cur[1]:'Painel']}),
          i.jsx('div',{className:'wa-ut-top-actions',children:i.jsx(WaTheme.Menu,{})})]}),
        i.jsx('div',{className:'wa-shell-body',children})]}),
      bye?i.jsx(WaUt.ConfirmDialog,{open:!0,onOpenChange:setBye,title:'Sair do painel?',desc:'Para entrar de novo você vai precisar da chave de acesso.',danger:!0,action:'Sair',onAction:()=>{Pj();nav('/manager/login')}}):null]});
  }
  return{Global,Notice,PAGES};
})();
"""

B5_OLD = ('function B5({children:e}){return i.jsxs("div",{className:"flex h-full min-h-screen flex-col",children:['
          'i.jsx(zM,{}),i.jsx("main",{className:"flex-1",children:e}),i.jsx(Vb,{})]})}')
B5_NEW = 'function B5({children:e}){return i.jsx(WaShell.Global,{children:e})}'

BYE_OLD = "desc:'Para entrar de novo você vai precisar da URL do servidor e da chave de API.'"
BYE_NEW = "desc:'Para entrar de novo você vai precisar da chave de acesso.'"


def g_expose(s):
    return rep(s, EXPOSE_OLD, EXPOSE_NEW, 'WaUt exports')


def g_shell(s):
    anchor = EXPOSE_NEW if EXPOSE_NEW in s else EXPOSE_OLD
    return rep(s, anchor, anchor + SHELL, 'WaShell after WaUt')


LIST_OLD = 'path:"/manager/",element:i.jsx(tn,{children:i.jsx(B5,{children:i.jsx(CZ,{})})})'
LIST_NEW = 'path:"/manager/",element:i.jsx(tn,{children:i.jsx(CZ,{})})'


def g_layout(s):
    s = rep(s, LIST_OLD, LIST_NEW, 'instance list route')
    return rep(s, B5_OLD, B5_NEW, 'B5 layout')


def g_logout(s):
    return rep(s, BYE_OLD, BYE_NEW, 'logout text')


NOTICE_OLD = "        null]}),\n      i.jsxs('section',{className:'wa-ut-main','aria-labelledby':'wa-ut-title'"
NOTICE_NEW = "        i.jsx(WaShell.Notice,{})]}),\n      i.jsxs('section',{className:'wa-ut-main','aria-labelledby':'wa-ut-title'"


def g_notice(s):
    return rep(s, NOTICE_OLD, NOTICE_NEW, 'list sidebar notice')


GROUPS = [('expose', g_expose), ('shell', g_shell), ('layout', g_layout), ('logout', g_logout), ('notice', g_notice)]


def patch_html(html):
    anchor = '    <link rel="stylesheet" href="/assets/client-portal.css?v='
    if html.count(anchor) != 1:
        raise PatchError('index.html: client-portal.css link expected once (run client-portal.py first)')
    out = html.replace(anchor, CSS_LINK + anchor, 1)
    return out.replace('</head>', '    ' + html_marker('html') + '\n  </head>', 1)


def bump_css(html):
    import re
    return re.sub(r'(/assets/app-shell\.css\?v=)(\d+)',
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
    missing = [name for name, _ in GROUPS if marker(name) not in s]
    if html_marker('html') not in html:
        missing.append('html')
    if bump_index(html) != html:
        missing.append('index.html cache version')
    if bump_css(html) != html:
        missing.append('index.html app-shell.css version')
    if not os.path.isfile(CSS):
        missing.append('app-shell.css')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/app-shell.css is missing')
    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = patch_html(html) if 'html' in missing else html
    new_html = bump_css(bump_index(new_html))
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: app-shell.css?v={CSS_VERSION}, bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
