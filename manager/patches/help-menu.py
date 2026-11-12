#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: the "Ajuda" menu of the header and the keyboard shortcuts dialog
(proposal W, "Ajuda, novidades e atalhos").

Before: the header had Buscar (Ctrl K), the theme and the avatar, and the question mark did nothing. The Manual had
left the panel on 11/11/2026 and nothing took its place. Now:

1. component - WaHelp, an isolated IIFE placed right before the route table (after WaTw): a "Ajuda" button (question
               mark) with a menu that opens by mouse or keyboard and closes with Esc, a click outside or a selection:
               "Falar com o suporte" (the WhatsApp number of the site, CONTACT_WHATSAPP in landing.js), "Guia rápido"
               (the manual in the GitHub repository), "Atalhos do teclado" (opens the shortcuts dialog) and the last
               three "Novidades" with "Ver todas" (/novidades). On phones the menu becomes a sheet at the bottom.
               Shortcuts dialog (Radix Dialog, already in the bundle): Ctrl K, ?, G + C, G + L, P and Esc.
2. header    - the instance top bar (zM) renders WaHelp.Menu between Buscar and the avatar.
3. instances - the instances list top bar (WaUt.Instances) renders WaHelp.Menu before the theme, so the menu is on
               the first page after login too.
4. shell     - the global pages shell (WaShell.Global, app-shell.py) renders WaHelp.Menu next to the theme.
5. html      - links help-menu.css, loads help-shortcuts.js (the global key handler: ?, G + C, G + L, P; it never
               fires inside text fields or with Ctrl/⌘/Alt, so it does not collide with Ctrl K) and raises the
               bundle ?v= to CACHE_VERSION.

Service status: the menu has no status line. The panel has no client-side "API is up" state that can be shown
without a new request or a timer (the instance query is per page and says nothing about the service as a whole),
so the line was left out instead of inventing a monitor or polling the database.

P: opens the contact panel of the open conversation and presses "Pausar IA" / "Retomar IA", which opens the same
confirmation dialog as the button. The confirmation stays with the person; the shortcut never pauses or resumes
without it.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after every other script (it sits before
the route table and after the header patches of app-shell.py and twenty-layout.py).

Usage (from the repository root):
  python3 -I manager/patches/help-menu.py           # apply
  python3 -I manager/patches/help-menu.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'help-menu.css')
JS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'help-shortcuts.js')
CACHE_VERSION = '56'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_TAG = '    <link rel="stylesheet" href="/assets/help-menu.css?v=1" />\n'
JS_TAG = '    <script src="/assets/help-shortcuts.js?v=2"></script>\n'
CSS_ANCHOR = '    <link rel="stylesheet" href="/assets/first-run.css?v=1" />\n'
JS_ANCHOR = '    <script src="/assets/panel-a11y.js?v=1"></script>\n'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:help-menu:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:help-menu:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


COMPONENT = r'''const WaHelp=(()=>{
  const SUPPORT='https://wa.me/5521974699723?text='+encodeURIComponent('Olá! Preciso de ajuda com o WhatsAI.');
  const GUIDE='https://github.com/devconnecting1/evolution-api-render/blob/main/README-WHATSAI.md';
  const NEWS=[
    ['2026-11-12','12/11/2026','Primeiro uso guiado: boas-vindas com três passos para começar.'],
    ['2026-11-12','12/11/2026','Quando a API não responde, a tela diz o que aconteceu e oferece tentar de novo.'],
    ['2026-11-11','11/11/2026','Um layout só no painel: a lateral aparece em todas as páginas e só o conteúdo rola.']];
  const IC={
    help:['M9.1 9a3 3 0 1 1 4.6 2.6c-.9.6-1.7 1.2-1.7 2.4','M12 17h.01','M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],
    chat:['M4 5h16v11H9l-5 4Z'],
    book:['M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20'],
    keyboard:['M3 6h18v12H3Z','M7 10h.01M11 10h.01M15 10h.01M7 14h.01M11 14h.01M15 14h.01'],
    ext:['M15 3h6v6','M10 14 21 3','M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6']};
  function svg(name,size){const d=IC[name]||[];return i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:size||16,height:size||16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'1.6',strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',children:d.map((p,k)=>i.jsx('path',{d:p},k))});}
  function Kbd({children}){return i.jsx('kbd',{className:'wa-help-kbd',children:children})}
  function Shortcuts(){
    const[open,setOpen]=y.useState(!1);
    y.useEffect(()=>{const f=()=>setOpen(!0);window.addEventListener('wa-help:shortcuts',f);return()=>window.removeEventListener('wa-help:shortcuts',f)},[]);
    const ROWS=[['Ctrl K','Buscar conversas e páginas'],['?','Abrir os atalhos do teclado'],['G + C','Ir para Conversas'],['G + L','Ir para Leads'],['P','Pausar ou retomar a IA na conversa aberta'],['Esc','Fechar menus e diálogos']];
    const keys=v=>v.split(' + ').map((part,idx)=>i.jsxs(y.Fragment,{children:[idx?i.jsx('span',{className:'wa-help-plus',children:'+'},'p'):null,i.jsx(Kbd,{children:part},part)]},part));
    return i.jsx(Pt,{open,onOpenChange:setOpen,children:i.jsxs(Nt,{className:'wa-help-dialog',children:[
      i.jsxs(Mt,{children:[i.jsx(zt,{children:'Atalhos do teclado'}),i.jsx(eo,{children:'Funcionam no painel, fora dos campos de texto. No celular, use o menu Ajuda.'})]}),
      i.jsx('dl',{className:'wa-help-keys',children:ROWS.map(([k,t])=>i.jsxs('div',{children:[i.jsx('dt',{children:keys(k)}),i.jsx('dd',{children:t})]},k))}),
      i.jsx(Yt,{children:i.jsx(se,{variant:'outline',onClick:()=>setOpen(!1),children:'Fechar'})})]})});
  }
  function Menu(){
    const[open,setOpen]=y.useState(!1),box=y.useRef(null),btn=y.useRef(null);
    const close=y.useCallback(()=>{setOpen(!1);btn.current&&btn.current.focus()},[]);
    y.useEffect(()=>{if(!open)return;
      const down=e=>{if(box.current&&!box.current.contains(e.target)&&btn.current&&!btn.current.contains(e.target))setOpen(!1)};
      const key=e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();close()}};
      document.addEventListener('mousedown',down);document.addEventListener('keydown',key,!0);
      const f=setTimeout(()=>{const first=box.current&&box.current.querySelector('[role="menuitem"]');first&&first.focus()},0);
      return()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key,!0);clearTimeout(f)}},[open,close]);
    const nav=e=>{const items=box.current?[...box.current.querySelectorAll('[role="menuitem"]')]:[],k=items.indexOf(document.activeElement);
      let n=null;if(e.key==='ArrowDown')n=(k+1)%items.length;else if(e.key==='ArrowUp')n=(k-1+items.length)%items.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=items.length-1;else if(e.key==='Tab'){setOpen(!1);return}
      if(n!=null){e.preventDefault();items[n].focus()}};
    const shortcuts=()=>{close();window.dispatchEvent(new CustomEvent('wa-help:shortcuts'))};
    return i.jsxs('div',{className:'wa-help',children:[
      i.jsx('button',{ref:btn,type:'button',className:'wa-help-btn','aria-haspopup':'menu','aria-expanded':open?'true':'false','aria-controls':open?'wa-help-menu':void 0,'aria-label':'Ajuda',title:'Ajuda',onClick:()=>setOpen(o=>!o),onKeyDown:e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(!0)}},children:svg('help',18)}),
      open?i.jsxs(i.Fragment,{children:[
        i.jsx('div',{className:'wa-help-scrim','aria-hidden':'true',onClick:close}),
        i.jsxs('div',{ref:box,id:'wa-help-menu','data-wa-help-menu':'',role:'menu','aria-label':'Ajuda',className:'wa-help-menu',onKeyDown:nav,children:[
          i.jsx('p',{className:'wa-help-label',role:'presentation',children:'Ajuda'}),
          i.jsxs('a',{role:'menuitem',className:'wa-help-item',href:SUPPORT,target:'_blank',rel:'noopener noreferrer',children:[svg('chat',16),i.jsxs('span',{className:'wa-help-item-text',children:[i.jsx('span',{children:'Falar com o suporte'}),i.jsx('span',{className:'wa-help-item-hint',children:'WhatsApp'})]}),svg('ext',13)]}),
          i.jsxs('a',{role:'menuitem',className:'wa-help-item',href:GUIDE,target:'_blank',rel:'noopener noreferrer',children:[svg('book',16),i.jsxs('span',{className:'wa-help-item-text',children:[i.jsx('span',{children:'Guia rápido'}),i.jsx('span',{className:'wa-help-item-hint',children:'Manual no GitHub'})]}),svg('ext',13)]}),
          i.jsxs('button',{type:'button',role:'menuitem',className:'wa-help-item',onClick:shortcuts,children:[svg('keyboard',16),i.jsxs('span',{className:'wa-help-item-text',children:[i.jsx('span',{children:'Atalhos do teclado'}),i.jsx('span',{className:'wa-help-item-hint',children:'Ver todos os atalhos'})]}),i.jsx(Kbd,{children:'?'})]}),
          i.jsx('div',{className:'wa-help-sep',role:'separator'}),
          i.jsxs('div',{className:'wa-help-news',role:'group','aria-labelledby':'wa-help-news-label',children:[
            i.jsx('p',{id:'wa-help-news-label',className:'wa-help-label',children:'Novidades'}),
            i.jsx('ul',{children:NEWS.map(n=>i.jsx('li',{children:i.jsxs('a',{role:'menuitem',href:'/novidades',target:'_blank',rel:'noopener noreferrer',children:[i.jsx('time',{dateTime:n[0],children:n[1]}),i.jsx('span',{children:n[2]})]})},n[0]+n[2]))})]}),
          i.jsxs('a',{role:'menuitem',className:'wa-help-all',href:'/novidades',target:'_blank',rel:'noopener noreferrer',children:['Ver todas',svg('ext',12)]})]})]}):null,
      i.jsx(Shortcuts,{})]});
  }
  return{Menu,Shortcuts};
})();
'''

HEADER_OLD = 'e&&i.jsx(WaTw.CmdButton,{}),e&&i.jsx(Ei,{className:"h-8 w-8"'
HEADER_NEW = 'e&&i.jsx(WaTw.CmdButton,{}),e&&i.jsx(WaHelp.Menu,{}),e&&i.jsx(Ei,{className:"h-8 w-8"'

INSTANCES_OLD = "i.jsxs('div',{className:'wa-ut-top-actions',children:[i.jsx(WaTheme.Menu,{}),create,"
INSTANCES_NEW = "i.jsxs('div',{className:'wa-ut-top-actions',children:[i.jsx(WaHelp.Menu,{}),i.jsx(WaTheme.Menu,{}),create,"

SHELL_OLD = "i.jsx('div',{className:'wa-ut-top-actions',children:i.jsx(WaTheme.Menu,{})})"
SHELL_NEW = "i.jsx('div',{className:'wa-ut-top-actions',children:i.jsxs(i.Fragment,{children:[i.jsx(WaHelp.Menu,{}),i.jsx(WaTheme.Menu,{})]})})"


def g_component(s):
    return rep(s, '\n\nconst Lse=Z2([', '\n\n' + COMPONENT + '\nconst Lse=Z2([', 'route table')


def g_header(s):
    return rep(s, HEADER_OLD, HEADER_NEW, 'instance top bar')


def g_instances(s):
    return rep(s, INSTANCES_OLD, INSTANCES_NEW, 'instances list top bar')


def g_shell(s):
    return rep(s, SHELL_OLD, SHELL_NEW, 'global shell top bar')


GROUPS = [('component', g_component), ('header', g_header), ('instances', g_instances), ('shell', g_shell)]


def patch_html(html):
    if CSS_TAG not in html:
        if html.count(CSS_ANCHOR) != 1:
            raise PatchError('index.html: first-run.css link expected once')
        html = html.replace(CSS_ANCHOR, CSS_ANCHOR + CSS_TAG, 1)
    if JS_TAG not in html:
        if html.count(JS_ANCHOR) != 1:
            raise PatchError('index.html: panel-a11y.js script expected once')
        html = html.replace(JS_ANCHOR, JS_ANCHOR + JS_TAG, 1)
    if html_marker('html') not in html:
        html = html.replace('</head>', '    ' + html_marker('html') + '\n  </head>', 1)
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


def main():
    check = '--check' in sys.argv[1:]
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    missing = [name for name, _ in GROUPS if marker(name) not in s]
    if html_marker('html') not in html or CSS_TAG not in html or JS_TAG not in html:
        missing.append('html')
    if bump_index(html) != html:
        missing.append('index.html cache version')
    if not os.path.isfile(CSS):
        missing.append('help-menu.css')
    if not os.path.isfile(JS):
        missing.append('help-shortcuts.js')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    if not os.path.isfile(CSS) or not os.path.isfile(JS):
        raise PatchError('manager/dist/assets/help-menu.css and help-shortcuts.js are required')
    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = patch_html(html) if 'html' in missing else html
    new_html = bump_index(new_html)
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: help-menu.css and help-shortcuts.js, bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
