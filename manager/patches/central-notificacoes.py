#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: the notifications center (proposal Y, "Central de notificações").

Before: each warning lived on its own screen (the Processos counter in the menu, the plan limit in "Plano e
limites", the disconnection in "Instâncias") and the "Tudo certo" toast covered the header. Now:

1. component - WaNotifBell, an isolated component placed right before the route table (after WaHelp): a bell in the
               header with the items that ask for attention, in order of urgency, and the shortcut to fix each one
               ("Abrir conexão" goes to the existing /manager/instance/:id/conexao page). Two tabs ("Não vistas"
               and "Todas"), "Marcar tudo como visto" and one "Marcar como visto" per item. Seen state lives in
               localStorage (central-notificacoes.js); the panel is a popover on desktop and a sheet under the
               header on phones. The name is WaNotifBell because acabamento-listas.py (proposal F) already has a
               WaNotif page module for its "Notificações" page and sidebar counter.
2. feed      - response interceptors on the two axios instances of the bundle (Ee and bd) send the responses of
               requests the screens ALREADY make to window.WaNotif.ingest: GET /instance/fetchInstances
               (connectionStatus), /usage/summary/:instance, /processos/:instance and /processos/:instance/badge,
               the agenda page fetch /agenda/:instance (from/to covering today, never the one-contact query of
               the dashboard) and the pending-appointment count that the "Notificações" sidebar item of
               acabamento-listas.py already loads on every instance page. Nothing here starts a request, a timer
               or a poll, and the connection is never touched.
3. header    - the instance top bar (zM) renders WaNotifBell.Menu between the Ajuda menu and the avatar.
4. instances - the instances list top bar (WaUt.Instances) renders WaNotifBell.Menu before the theme.
5. shell     - the global pages shell (WaShell.Global, app-shell.py) renders WaNotifBell.Menu before the theme.
6. html      - links central-notificacoes.css and loads central-notificacoes.js immediately before the bundle
               (the stylesheet is the last one and the classic script runs after the other classic scripts, so
               window.WaNotif exists when the headers render) at ASSET_VERSION; raises the bundle ?v= to
               CACHE_VERSION. The stylesheet also moves the "salvo" toasts below the header.

What it does not read: there is no client-side source for a disconnection instant or for today's appointment
count without the agenda page (the pending count of the existing sidebar query is used instead), and the plan
usage only exists after one of the screens fetches it. The store is in memory: a hard reload starts empty until
the first screen feeds it again (SPA navigation keeps it), so a hard reload straight into a global page knows
nothing about other instances until the instances list is visited. Instead of inventing polling, those gaps stay
empty and are written down in the PR.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after every other script (it needs the
headers of help-menu.py, app-shell.py and ui-tables.py already patched).

Usage (from the repository root):
  python3 -I manager/patches/central-notificacoes.py           # apply
  python3 -I manager/patches/central-notificacoes.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'central-notificacoes.css')
JS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'central-notificacoes.js')
CACHE_VERSION = '69'
ASSET_VERSION = '1'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_TAG = '    <link rel="stylesheet" href="/assets/central-notificacoes.css?v=' + ASSET_VERSION + '" />\n'
JS_TAG = '    <script src="/assets/central-notificacoes.js?v=' + ASSET_VERSION + '"></script>\n'
BUNDLE_TAG = '    <script type="module" crossorigin src="/assets/index-b29a5d7a.js'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:central-notificacoes:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:central-notificacoes:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


COMPONENT = r'''const WaNotifBell=(()=>{
  const IC={bell:['M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8','M10.3 21a1.94 1.94 0 0 0 3.4 0'],
    check:['M20 6 9 17l-5-5']};
  function icons(name,size){const d=IC[name]||[];return i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:size||16,height:size||16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'1.7',strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',children:d.map((p,k)=>i.jsx('path',{d:p},k))});}
  function store(){return window.WaNotif||{list:()=>[],subscribe:()=>()=>{},markSeen:()=>{},markAllSeen:()=>{}}}
  function Menu(){
    const[open,setOpen]=y.useState(!1),[tab,setTab]=y.useState('unseen'),[items,setItems]=y.useState(()=>store().list(!0));
    const box=y.useRef(null),btn=y.useRef(null),[coords,setCoords]=y.useState(null);
    const sync=y.useCallback(()=>{setItems(store().list(!0))},[]);
    const place=y.useCallback(()=>{const r=btn.current&&btn.current.getBoundingClientRect();if(!r)return;setCoords({top:r.bottom+6,right:Math.max(8,window.innerWidth-r.right)})},[]);
    y.useEffect(()=>{const off=store().subscribe(sync);return()=>{off&&off()}},[sync]);
    y.useEffect(()=>{if(!open)return;
      place();
      const down=e=>{if(box.current&&!box.current.contains(e.target)&&btn.current&&!btn.current.contains(e.target))setOpen(!1)};
      const key=e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();setOpen(!1);btn.current&&btn.current.focus()}};
      document.addEventListener('mousedown',down);document.addEventListener('keydown',key,!0);
      window.addEventListener('resize',place);document.addEventListener('scroll',place,!0);
      const focus=setTimeout(()=>{box.current&&box.current.focus()},0);
      return()=>{clearTimeout(focus);document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key,!0);
        window.removeEventListener('resize',place);document.removeEventListener('scroll',place,!0)}},[open,place]);
    const unseen=items.filter(x=>!x.seen),shown=tab==='unseen'?unseen:items;
    const seenOne=it=>{store().markSeen(it);sync()},seenAll=()=>{store().markAllSeen();sync()};
    return i.jsxs('div',{className:'wa-notif',children:[
      i.jsx('button',{ref:btn,type:'button',className:'wa-notif-btn','aria-haspopup':'dialog','aria-expanded':open?'true':'false','aria-controls':open?'wa-notif-panel':void 0,'aria-label':unseen.length?'Notificações, '+unseen.length+' não vistas':'Notificações',title:'Notificações',onClick:()=>{if(!open)place();setOpen(o=>!o)},children:icons('bell',18)}),
      unseen.length?i.jsx('span',{className:'wa-notif-badge','aria-hidden':'true',children:unseen.length>9?'9+':unseen.length}):null,
      open?Ib.createPortal(i.jsxs('div',{ref:box,id:'wa-notif-panel',className:'wa-notif-panel',role:'dialog','aria-label':'Notificações',tabIndex:-1,style:{'--wan-top':coords?coords.top+'px':'56px','--wan-right':coords?coords.right+'px':'16px'},children:[
        i.jsxs('div',{className:'wa-notif-head',children:[
          i.jsx('p',{className:'wa-notif-h',children:'Notificações'}),
          i.jsx('button',{type:'button',className:'wa-notif-all',onClick:seenAll,disabled:!unseen.length,children:'Marcar tudo como visto'})]}),
        i.jsxs('div',{className:'wa-notif-tabs',role:'group','aria-label':'Filtro de notificações',children:[
          i.jsxs('button',{type:'button','aria-pressed':tab==='unseen'?'true':'false',className:'wa-notif-tab',onClick:()=>setTab('unseen'),children:['Não vistas',unseen.length?i.jsx('span',{className:'wa-notif-n',children:unseen.length>99?'99+':unseen.length}):null]}),
          i.jsx('button',{type:'button','aria-pressed':tab==='all'?'true':'false',className:'wa-notif-tab',onClick:()=>setTab('all'),children:'Todas'})]}),
        shown.length?i.jsx('ul',{className:'wa-notif-list',children:shown.map(it=>i.jsxs('li',{className:'wa-notif-item','data-tone':it.tone,'data-seen':it.seen?'true':void 0,children:[
          i.jsx('span',{className:'wa-notif-ic',children:WaUt.svg(it.icon,15)}),
          i.jsxs('span',{className:'wa-notif-txt',children:[i.jsx('span',{className:'wa-notif-title',children:it.title}),i.jsx('span',{className:'wa-notif-meta',children:it.meta})]}),
          i.jsxs('span',{className:'wa-notif-foot',children:[
            it.href?i.jsxs(Fu,{to:it.href,className:'wa-notif-act',onClick:()=>setOpen(!1),children:[it.action,WaUt.svg('arrow',12)]}):i.jsx('span',{className:'wa-notif-meta',children:it.action}),
            it.seen?null:i.jsx('button',{type:'button',className:'wa-notif-check',title:'Marcar como visto','aria-label':'Marcar como visto',onClick:()=>seenOne(it),children:icons('check',14)})]})]},it.key))}):i.jsx('p',{className:'wa-notif-empty',children:tab==='unseen'?i.jsxs(i.Fragment,{children:[i.jsx('strong',{children:'Tudo em dia'}),'Nada pedindo atenção agora.']}):i.jsxs(i.Fragment,{children:[i.jsx('strong',{children:'Nada por aqui ainda'}),'As notificações aparecem conforme você usa o painel.']})})
      ]}),document.body):null]});
  }
  return{Menu};
})();
'''

EE_OLD = r'''Ee.interceptors.request.use(async e=>{const t=dr(jn.API_URL);if(t&&(e.baseURL=t.toString()),!e.headers.apiKey||e.headers.apiKey===""){const n=dr(jn.INSTANCE_TOKEN)||dr(jn.TOKEN);n&&(e.headers.apikey=`${n}`)}return e},e=>Promise.reject(e));'''
BD_OLD = r'''bd.interceptors.request.use(async e=>{const t=dr(jn.API_URL);if(t&&(e.baseURL=t.toString()),!e.headers.apiKey||e.headers.apiKey===""){const n=dr(jn.TOKEN);n&&(e.headers.apikey=`${n}`)}return e},e=>Promise.reject(e));'''
FEED = (
    'try{window.WaNotif&&window.WaNotif.ingest(r&&r.config&&r.config.url,r&&r.data,r&&r.config)}catch(e){}\n'
)


def feed_line(instance):
    return (instance + '.interceptors.response.use(function(r){' + FEED +
            'return r},function(e){return Promise.reject(e)});')


def g_feed(s):
    s = rep(s, EE_OLD, EE_OLD + feed_line('Ee'), 'Ee response interceptor')
    return rep(s, BD_OLD, BD_OLD + feed_line('bd'), 'bd response interceptor')


HEADER_OLD = 'e&&i.jsx(WaTw.CmdButton,{}),e&&i.jsx(WaHelp.Menu,{}),e&&i.jsx(Ei,{className:"h-8 w-8"'
HEADER_NEW = ('e&&i.jsx(WaTw.CmdButton,{}),e&&i.jsx(WaHelp.Menu,{}),e&&i.jsx(WaNotifBell.Menu,{}),'
              'e&&i.jsx(Ei,{className:"h-8 w-8"')

INSTANCES_OLD = "children:[i.jsx(WaHelp.Menu,{}),i.jsx(WaTheme.Menu,{}),create,"
INSTANCES_NEW = "children:[i.jsx(WaHelp.Menu,{}),i.jsx(WaNotifBell.Menu,{}),i.jsx(WaTheme.Menu,{}),create,"

SHELL_OLD = ("i.jsx('div',{className:'wa-ut-top-actions',children:i.jsxs(i.Fragment,{children:"
             "[i.jsx(WaHelp.Menu,{}),i.jsx(WaTheme.Menu,{})]})})")
SHELL_NEW = ("i.jsx('div',{className:'wa-ut-top-actions',children:i.jsxs(i.Fragment,{children:"
             "[i.jsx(WaHelp.Menu,{}),i.jsx(WaNotifBell.Menu,{}),i.jsx(WaTheme.Menu,{})]})})")


def g_component(s):
    return rep(s, 'const Lse=Z2([', COMPONENT + '\nconst Lse=Z2([', 'route table')


def g_header(s):
    return rep(s, HEADER_OLD, HEADER_NEW, 'instance top bar')


def g_instances(s):
    return rep(s, INSTANCES_OLD, INSTANCES_NEW, 'instances list top bar')


def g_shell(s):
    return rep(s, SHELL_OLD, SHELL_NEW, 'global shell top bar')


GROUPS = [('component', g_component), ('feed', g_feed), ('header', g_header),
          ('instances', g_instances), ('shell', g_shell)]


def patch_html(html):
    # Right before the bundle: the stylesheet is the last one and the classic script runs after the other
    # classic scripts, so a later patch that adds CSS or JS does not change the cascade or the load order.
    if CSS_TAG not in html or JS_TAG not in html:
        if html.count(BUNDLE_TAG) != 1:
            raise PatchError('index.html: bundle script tag expected once')
        add = ''
        if CSS_TAG not in html:
            add += CSS_TAG
        if JS_TAG not in html:
            add += JS_TAG
        html = html.replace(BUNDLE_TAG, add + BUNDLE_TAG, 1)
    if html_marker('html') not in html:
        html = html.replace('</head>', '    ' + html_marker('html') + '\n  </head>', 1)
    return html


def bump_assets(html):
    return re.sub(r'(/assets/central-notificacoes\.(?:js|css)\?v=)(\d+)',
                  lambda m: m.group(1) + (ASSET_VERSION if int(m.group(2)) < int(ASSET_VERSION) else m.group(2)), html)


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
    if bump_assets(html) != html:
        missing.append('index.html asset version')
    if not os.path.isfile(CSS):
        missing.append('central-notificacoes.css')
    if not os.path.isfile(JS):
        missing.append('central-notificacoes.js')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    if not os.path.isfile(CSS) or not os.path.isfile(JS):
        raise PatchError('manager/dist/assets/central-notificacoes.css and central-notificacoes.js are required')
    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = patch_html(html) if 'html' in missing else html
    new_html = bump_assets(bump_index(new_html))
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: central-notificacoes.js/css ?v={ASSET_VERSION}, bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
