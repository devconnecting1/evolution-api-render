#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager and the public pages: colour system with light and dark themes.

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in two plain files edited by hand:
  manager/dist/assets/theme.css         - panel: --m-* tokens per theme (html[data-theme]), deep green sidebar,
                                          greeting band, usage gauge, warning strip, theme menu, chip palette.
  manager/dist/assets/landing-theme.css - landing, /advocacia, /instagram: cream canvas, alternating cream / mint /
                                          deep green sections, dark version through prefers-color-scheme.

Theme of the panel: localStorage "wa-theme" = system | light | dark (default system = prefers-color-scheme). An
inline script in <head> sets <html data-theme> before the first paint (no flash); WaTheme keeps it in sync with
the operating system while the preference is "system" and offers the "Tema" menu in the top bar.

Bundle groups (each one is applied once and leaves a marker comment at the top of the bundle):
  component - WaTheme, an isolated component module (IIFE) placed before the route table: Menu (top bar button
              with a Sistema / Claro / Escuro menu: menuitemradio, arrows/Home/End, Escape and a click outside
              close it, focus returns to the button), greet() ("Bom dia" / "Boa tarde" / "Boa noite" + date).
  header    - top bar (zM, instance pages): WaTheme.Menu in the empty language slot, before "Sair".
  greeting  - instances page (WaUt.Instances of ui-tables.py): "Bom dia · <data>" next to the "Instâncias" title.
  home-menu - instances page: WaTheme.Menu before "Nova instância" (that page hides the top bar zM).
  usage     - WaUsage.Bar ("Visão Geral"): semicircle gauge of the month (earlier days, today, remaining) with a
              legend (value | %) and, from the alert percent on, a warning strip "90% da franquia usada"
              (red at 100%). Same data as before (GET /usage/summary/:instance), no new request.
  prio      - Leads: the priority chip gets class wt-prio and data-prio (alta / normal / baixa); theme.css draws
              a three-bar priority icon (3, 2 or 1 bars filled) instead of the plain dot. Text stays the same.
index.html group (marker: an HTML comment in <head>):
  html      - inline theme script, color-scheme "light dark", theme.css?v=3 linked last, bundle ?v=CACHE_VERSION.
landing group (marker: an HTML comment in <head> of each page):
  landing   - landing-theme.css?v=2 after landing.css / segment.css, color-scheme "light dark".

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.
Order: run after every other script (it needs usage-limits.py, twenty-layout.py, leads.py and ui-tables.py applied).

Usage (from the repository root):
  python3 -I manager/patches/theme.py           # apply
  python3 -I manager/patches/theme.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DIST = os.path.join(ROOT, 'manager', 'dist')
BUNDLE = os.path.join(DIST, 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(DIST, 'index.html')
LANDINGS = [os.path.join(DIST, 'landing', n) for n in ('index.html', 'advocacia.html', 'instagram.html')]
CSS = [os.path.join(DIST, 'assets', 'theme.css'), os.path.join(DIST, 'assets', 'landing-theme.css')]
REQUIRED = ('/*whatsai-patch:usage-limits:component*/', '/*whatsai-patch:twenty-layout:header*/',
            '/*whatsai-patch:home-redesign:instances*/', '/*whatsai-patch:leads:component*/',
            '/*whatsai-patch:ui-tables:v1*/')
CACHE_VERSION = '29'
SCRIPT_TAG = '<script type="module" crossorigin src="/assets/index-b29a5d7a.js?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:theme:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:theme:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# Minified names (bundle index-b29a5d7a.js): i = jsx runtime, y = React, se = Button, zM = top bar,
# WaUsage = module of usage-limits.py (Bar, Page, Icon; fmt, svg, tone, useSummary in its scope).

COMPONENT = r'''const WaTheme=(()=>{
  const KEY='wa-theme',OPTS=[['system','Sistema'],['light','Claro'],['dark','Escuro']];
  const mq=typeof window!=='undefined'&&window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;
  const subs=new Set();
  function read(){try{const v=localStorage.getItem(KEY);return v==='light'||v==='dark'?v:'system'}catch(e){return 'system'}}
  function isDark(p){return p==='dark'||(p==='system'&&!!mq&&mq.matches)}
  function apply(p){const d=document.documentElement,dark=isDark(p);d.setAttribute('data-theme',dark?'dark':'light');d.setAttribute('data-theme-pref',p);
    const m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',dark?'#10100e':'#f5f5f5');}
  function set(p){try{localStorage.setItem(KEY,p)}catch(e){}apply(p);subs.forEach(f=>f(p));}
  if(mq){const on=()=>{const p=read();if(p==='system'){apply(p);subs.forEach(f=>f(p))}};if(mq.addEventListener)mq.addEventListener('change',on);else if(mq.addListener)mq.addListener(on);}
  try{apply(read())}catch(e){}
  const P={system:['M4 5h16v11H4z','M8 20h8','M12 16v4'],light:['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z','M12 2v2','M12 20v2','M4.9 4.9l1.4 1.4','M17.7 17.7l1.4 1.4','M2 12h2','M20 12h2','M4.9 19.1l1.4-1.4','M17.7 6.3l1.4-1.4'],dark:['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'],check:['M5 12l5 5 9-10']};
  function svg(paths,size){return i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:size||16,height:size||16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'1.5',strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',children:paths.map((d,k)=>i.jsx('path',{d},k))});}
  function greet(){const h=new Date().getHours();const g=h>=5&&h<12?'Bom dia':h>=12&&h<18?'Boa tarde':'Boa noite';let d='';try{d=new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'numeric',month:'long'}).format(new Date())}catch(e){}return d?g+' · '+d:g;}
  function Menu(){
    const[pref,setPref]=y.useState(read),[open,setOpen]=y.useState(!1),box=y.useRef(null),btn=y.useRef(null);
    y.useEffect(()=>{const f=p=>setPref(p);subs.add(f);return()=>{subs.delete(f)}},[]);
    y.useEffect(()=>{if(!open)return;
      const items=box.current?[...box.current.querySelectorAll('[role="menuitemradio"]')]:[];
      (items.find(x=>x.getAttribute('aria-checked')==='true')||items[0])?.focus();
      const down=e=>{if(box.current&&!box.current.contains(e.target)&&btn.current&&!btn.current.contains(e.target))setOpen(!1)};
      const key=e=>{if(e.key==='Escape'){e.stopPropagation();setOpen(!1);btn.current?.focus()}};
      document.addEventListener('mousedown',down);document.addEventListener('keydown',key);
      return()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key)}},[open]);
    const nav=e=>{const items=[...box.current.querySelectorAll('[role="menuitemradio"]')],k=items.indexOf(document.activeElement);
      let n=null;if(e.key==='ArrowDown')n=(k+1)%items.length;else if(e.key==='ArrowUp')n=(k-1+items.length)%items.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=items.length-1;else if(e.key==='Tab'){setOpen(!1);return}
      if(n!=null){e.preventDefault();items[n].focus()}};
    const label=OPTS.find(o=>o[0]===pref)[1];
    return i.jsxs('div',{className:'wa-theme',children:[
      i.jsx('button',{ref:btn,type:'button',className:'wa-theme-btn','aria-haspopup':'menu','aria-expanded':open?'true':'false','aria-controls':open?'wa-theme-menu':void 0,'aria-label':'Tema: '+label,title:'Tema: '+label,onClick:()=>setOpen(o=>!o),children:svg(P[pref==='system'?'system':pref],18)}),
      open?i.jsxs('div',{ref:box,id:'wa-theme-menu',className:'wa-theme-menu',role:'menu','aria-label':'Tema',onKeyDown:nav,children:[
        i.jsx('div',{className:'wa-theme-label','aria-hidden':'true',children:'Tema'}),
        ...OPTS.map(([v,lb])=>i.jsxs('button',{type:'button',role:'menuitemradio','aria-checked':pref===v?'true':'false',tabIndex:-1,className:'wa-theme-item',
          onClick:()=>{set(v);setOpen(!1);btn.current?.focus()},children:[svg(P[v]),i.jsx('span',{children:lb}),i.jsx('span',{className:'wa-theme-check',children:svg(P.check)})]},v))]}):null]});
  }
  return {Menu,greet,read,set};
})();

'''

# anchor on the (empty) language slot iM of the top bar, right after the "Observabilidade" link: credentials-vault.py
# inserts its own item after it, so the "Sair" button is not part of the anchor
HEADER_OLD = 'children:"Observabilidade"})]})}),i.jsx(iM,{}),'
HEADER_NEW = 'children:"Observabilidade"})]})}),i.jsx(WaTheme.Menu,{}),'

GREETING_OLD = "children:svg('db',14)}),'Instâncias']}),"
GREETING_NEW = GREETING_OLD + "i.jsx('p',{className:'wt-greet',children:WaTheme.greet()}),"
HOME_MENU_OLD = "i.jsxs('div',{className:'wa-ut-top-actions',children:[create,"
HOME_MENU_NEW = "i.jsxs('div',{className:'wa-ut-top-actions',children:[i.jsx(WaTheme.Menu,{}),create,"

BAR_OLD = r'''  function Bar({instance}){
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

'''

BAR_NEW = r'''  function Bar({instance}){
    const{data}=useSummary(instance?.name);
    if(!data||!data.month)return null;
    const m=data.month,plan=data.limits?.planName,lim=Number(m.limit)||0,used=Number(m.responses)||0,td=Math.min(used,Number(data.today?.responses)||0);
    const pct=lim?used/lim*100:null,tn=tone(pct,m.alertPercent),pc=v=>fmt(Math.round(v))+'%';
    const shown=m.percent!=null?Number(m.percent):pct!=null?Math.round(pct):null;
    const head=i.jsxs('div',{className:'wu-bar-head',children:[
      i.jsxs('h2',{id:'wu-bar-title',className:'wu-bar-title',children:[i.jsx('span',{className:'wu-ico',children:svg(GAUGE,16)}),plan?'Plano '+plan:'Respostas da IA']}),
      i.jsx(Fu,{to:'/manager/instance/'+instance.id+'/usage',className:'wu-link',children:'Plano e limites'})]});
    const note=m.excedente?i.jsx('p',{className:'wu-bar-note','data-tone':'bad',children:'Excedente: '+fmt(m.excedente)+' respostas ('+m.blocks1000+' bloco(s) de 1.000, cerca de R$ '+fmt(m.estimatedBRL)+').'}):null;
    if(!lim)return i.jsxs('section',{className:'wu-bar','aria-labelledby':'wu-bar-title',children:[head,
      i.jsxs('p',{className:'wu-bar-text',children:[i.jsx('strong',{children:monthText(m)}),td?i.jsx('span',{className:'wu-muted',children:' · '+fmt(td)+' hoje'}):null]}),note]});
    const A='M14 96 A82 82 0 0 1 178 96',done=Math.min(100,pct),today=Math.min(done,td/lim*100),before=done-today;
    return i.jsxs('section',{className:'wu-bar','aria-labelledby':'wu-bar-title',children:[head,
      i.jsxs('div',{className:'wt-usage','data-tone':tn,children:[
        i.jsxs('div',{className:'wt-gauge','data-tone':tn,children:[
          i.jsxs('svg',{viewBox:'0 0 192 104',role:'img','aria-label':fmt(used)+' de '+fmt(lim)+' respostas da IA usadas este mês ('+pc(pct)+'), '+fmt(td)+' hoje',children:[
            i.jsx('path',{d:A,className:'wt-gauge-track',fill:'none',strokeWidth:14,strokeLinecap:'round',pathLength:100}),
            before>0.5?i.jsx('path',{d:A,className:'wt-gauge-fill',fill:'none',strokeWidth:14,strokeLinecap:'round',pathLength:100,strokeDasharray:before+' 100'}):null,
            today>0.5?i.jsx('path',{d:A,className:'wt-gauge-today',fill:'none',strokeWidth:14,strokeLinecap:'butt',pathLength:100,strokeDasharray:'0 '+before+' '+today+' 100'}):null]}),
          i.jsxs('div',{className:'wt-gauge-center','aria-hidden':'true',children:[i.jsx('span',{className:'wt-gauge-num',children:fmt(used)}),i.jsx('span',{className:'wt-gauge-cap',children:'de '+fmt(lim)+' respostas'})]})]}),
        i.jsxs('dl',{className:'wt-legend',children:[
          i.jsxs('div',{children:[i.jsx('span',{className:'wt-dot','data-k':'used','aria-hidden':'true'}),i.jsx('dt',{children:'Usadas no mês'}),i.jsx('dd',{children:fmt(used)}),i.jsx('dd',{children:pc(pct)})]}),
          i.jsxs('div',{children:[i.jsx('span',{className:'wt-dot','data-k':'today','aria-hidden':'true'}),i.jsx('dt',{children:'Hoje'}),i.jsx('dd',{children:fmt(td)}),i.jsx('dd',{children:pc(td/lim*100)})]}),
          i.jsxs('div',{children:[i.jsx('span',{className:'wt-dot','data-k':'rest','aria-hidden':'true'}),i.jsx('dt',{children:'Restantes'}),i.jsx('dd',{children:fmt(Math.max(0,lim-used))}),i.jsx('dd',{children:pc(Math.max(0,100-pct))})]})]})]}),
      tn!=='ok'?i.jsxs('div',{className:'wt-strip','data-tone':tn,role:'status',children:[
        i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'1.75',strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',children:[i.jsx('path',{d:'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'}),i.jsx('path',{d:'M12 9v4'}),i.jsx('path',{d:'M12 17h.01'})]}),
        i.jsxs('span',{children:[fmt(shown)+'% da franquia usada',i.jsx('span',{className:'wt-strip-sub',children:tn==='bad'?' · a franquia do mês acabou; veja a regra em Plano e limites':' · faltam '+fmt(Math.max(0,lim-used))+' respostas este mês'})]})]}):null,
      note]});
  }

'''

THEME_SCRIPT = ('    <script>(function(){var p="system",d=document.documentElement;try{p=localStorage.getItem("wa-theme")||"system"}catch(e){}'
                'var k=p==="dark"||(p!=="light"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);'
                'd.setAttribute("data-theme",k?"dark":"light");d.setAttribute("data-theme-pref",p==="light"||p==="dark"?p:"system");'
                'var m=document.querySelector(\'meta[name="theme-color"]\');if(m)m.setAttribute("content",k?"#10100e":"#f5f5f5")})()</script>\n')


def patch_component(s):
    return rep(s, 'const Lse=Z2([', COMPONENT + 'const Lse=Z2([', 'route table')


def patch_header(s):
    return rep(s, HEADER_OLD, HEADER_NEW, 'top bar language slot (iM) after "Observabilidade"')


def patch_greeting(s):
    return rep(s, GREETING_OLD, GREETING_NEW, 'instances page title (WaUt.Instances)')


def patch_home_menu(s):
    return rep(s, HOME_MENU_OLD, HOME_MENU_NEW, 'instances page top bar actions (WaUt.Instances)')


def patch_usage(s):
    return rep(s, BAR_OLD, BAR_NEW, 'WaUsage.Bar')


PRIO_OLD = "function Prio({lead,long}){const p=lead.priority||'normal';return i.jsx('span',{className:'wl-chip','data-tone':"
PRIO_NEW = "function Prio({lead,long}){const p=lead.priority||'normal';return i.jsx('span',{className:'wl-chip wt-prio','data-prio':p,'data-tone':"


def patch_prio(s):
    return rep(s, PRIO_OLD, PRIO_NEW, 'Leads priority chip (WaLeads Prio)')


GROUPS = [('component', patch_component), ('header', patch_header), ('greeting', patch_greeting),
          ('home-menu', patch_home_menu), ('usage', patch_usage), ('prio', patch_prio)]


def patch_html(h):
    h = rep(h, '<meta name="color-scheme" content="light" />', '<meta name="color-scheme" content="light dark" />',
            'index.html color-scheme')
    h = rep(h, '<meta name="theme-color" content="#ffffff" />',
            '<meta name="theme-color" content="#f5f5f5" />\n' + THEME_SCRIPT.rstrip('\n'), 'index.html theme-color')
    anchor = '    <script type="module" crossorigin'
    h = rep(h, anchor, '    ' + html_marker('html') + '\n    <link rel="stylesheet" href="/assets/theme.css?v=3" />\n' + anchor,
            'index.html bundle script')
    i = h.index(SCRIPT_TAG) + len(SCRIPT_TAG)
    j = h.index('"', i)
    return h[:i] + CACHE_VERSION + h[j:]


def patch_landing(h, name):
    h = rep(h, '<meta name="color-scheme" content="light" />', '<meta name="color-scheme" content="light dark" />',
            name + ' color-scheme')
    h = rep(h, '<meta name="theme-color" content="#ffffff" />',
            '<meta name="theme-color" content="#f7f3ea" media="(prefers-color-scheme: light)" />\n'
            '    <meta name="theme-color" content="#0f1311" media="(prefers-color-scheme: dark)" />', name + ' theme-color')
    seg = '<link rel="stylesheet" href="/assets/segment.css?v=1" />'
    anchor = seg if seg in h else '<link rel="stylesheet" href="/assets/landing.css?v=9" />'
    return rep(h, anchor, anchor + '\n    ' + html_marker('landing') + '\n    <link rel="stylesheet" href="/assets/landing-theme.css?v=2" />',
               name + ' stylesheet')


def main():
    check = '--check' in sys.argv[1:]
    with open(BUNDLE, encoding='utf-8') as f:
        s = f.read()
    with open(INDEX, encoding='utf-8') as f:
        html = f.read()
    pages = {}
    for p in LANDINGS:
        with open(p, encoding='utf-8') as f:
            pages[p] = f.read()
    missing = [g for g, _ in GROUPS if marker(g) not in s]
    html_missing = html_marker('html') not in html
    landing_missing = [p for p, h in pages.items() if html_marker('landing') not in h]
    css_missing = [c for c in CSS if not os.path.isfile(c)]
    if check:
        ok = not missing and not html_missing and not landing_missing and not css_missing
        print('theme: ' + ('all groups applied' if ok else 'missing: ' + ', '.join(
            missing + (['html'] if html_missing else []) + [os.path.basename(p) for p in landing_missing] +
            [os.path.basename(c) for c in css_missing])))
        return 0 if ok else 1
    if css_missing:
        raise PatchError('missing stylesheet: ' + ', '.join(css_missing))
    absent = [m for m in REQUIRED if m not in s]
    if absent:
        raise PatchError('run the earlier patches first, missing: ' + ', '.join(absent))
    applied = []
    for g, fn in GROUPS:
        if g in missing:
            s = marker(g) + fn(s)
            applied.append(g)
    if html_missing:
        html = patch_html(html)
        applied.append('html')
    for p in landing_missing:
        pages[p] = patch_landing(pages[p], os.path.basename(p))
        applied.append('landing:' + os.path.basename(p))
    if not applied:
        print('theme: nothing to do')
        return 0
    with open(BUNDLE, 'w', encoding='utf-8') as f:
        f.write(s)
    with open(INDEX, 'w', encoding='utf-8') as f:
        f.write(html)
    for p, h in pages.items():
        with open(p, 'w', encoding='utf-8') as f:
            f.write(h)
    print('theme: applied ' + ', '.join(applied))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as e:
        print('theme: ' + str(e), file=sys.stderr)
        sys.exit(2)
