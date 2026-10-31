#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: Geist-only type, text wordmark, grouped sidebar, skeletons and a
documentation/dashboard look for "Observabilidade".

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/render-style.css (a plain file, edited by hand); the plain files of the
landing, the manual (readme-tab.js/.css) and geist.css are edited by hand too.

Bundle groups (each one is applied once and leaves a marker comment at the top of the bundle):
  brand         - header: the logo image becomes the text wordmark "WhatsAI" (.wa-wordmark, Geist); the
                  instance avatar without a profile picture shows the instance initial instead of the logo;
                  the top bar of the entry screens (WaHomeTop, home-redesign.py) uses the same wordmark.
  sidebar       - instance menu: "Observabilidade" and "Manual" had `mt-auto` (divider items), so they were
                  pushed to the bottom of the screen with a big gap. Now the list is continuous: main group,
                  a thin separator with the small label "Ferramentas", then the two tools ([data-wa-nav],
                  .wa-nav-label). The "Observabilidade" button of the header is shown only where there is no
                  instance menu (instance list, /manager/observability), so it no longer duplicates the menu.
  dashboard     - the instance name on the instance dashboard is its <h1> (the page had none).
  instances     - instance list while GET /instance/fetchInstances runs: skeleton cards and an aria-busy grid
                  instead of "Nenhuma instância encontrada"; the subtitle shows a skeleton line (the text
                  "Carregando instâncias..." stays for screen readers); a failed load says so.
  observability - WhatsAIObservability is replaced as a whole (the current text must have the expected
                  SHA-256, so an unexpected version stops the script): page header with breadcrumb, large title,
                  subtitle and actions (Atualizar + "Atualizado há X"); alerts as a banner; summary strip;
                  provider cards (2 columns when wide) with a clean header, status pill, metrics as large value
                  + thin bar + small legend, resources as light tables, links as secondary buttons, callouts for
                  "Não configurado" / errors. Loading: skeleton of the final layout (aria-busy, screen-reader
                  text, shimmer only without prefers-reduced-motion); "Atualizar" keeps the cards and shows
                  "Atualizando…"; the last good response is saved in localStorage (same API URL, max 24 h, no
                  secrets in it) and shown at once as "Dados de HH:MM · atualizando…"; a failed refresh keeps
                  the data with an error callout. Same API call, same data, same alert texts and anchors
                  (#observability-alerts, #obs-provider-<id>, #observability-config).
Compiled CSS group (marker: a comment at the top of index-DsIrum0U.css):
  fonts         - the two `font-family:"Geist Mono",monospace` rules (code/kbd/pre and .font-mono) become Geist.
index.html group (marker: an HTML comment in <head>):
  html          - render-style.css link after home.css; ?v= of the edited plain files (index CSS 3, geist.css 2,
                  readme-tab.css 8, readme-tab.js 12) and of the icons (favicon.svg is now an SVG link type).
Applying also bumps the bundle ?v= in index.html to CACHE_VERSION (only raised, never lowered).

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.
Order: run after the other scripts (it needs home-redesign.py, observability-ui.py, observability-alerts.py and
observability-grid.py applied).

Usage (from the repository root):
  python3 -I manager/patches/render-style.py           # apply
  python3 -I manager/patches/render-style.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import hashlib
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DIST = os.path.join(ROOT, 'manager', 'dist')
BUNDLE = os.path.join(DIST, 'assets', 'index-b29a5d7a.js')
APP_CSS = os.path.join(DIST, 'assets', 'index-DsIrum0U.css')
INDEX = os.path.join(DIST, 'index.html')
STYLES = os.path.join(DIST, 'assets', 'render-style.css')
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CACHE_VERSION = '14'
CSS_VERSION = '1'
REQUIRED = (
    '/*whatsai-patch:home-redesign:login*/',
    '/*whatsai-patch:home-redesign:instances*/',
    '/*whatsai-patch:observability-ui:v1*/',
    '/*whatsai-patch:observability-alerts:alerts*/',
    '/*whatsai-patch:observability-alerts:main*/',
    '/*whatsai-patch:observability-grid:v1*/',
)


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:render-style:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:render-style:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# ------------------------------------------------------------------------------------------------- brand
# zM = header (e = instance id, s = theme, u = instance), Ei / ki = Avatar / AvatarImage, Fu = Link.
def patch_brand(s):
    s = rep(s,
            'className:"flex h-8 items-center gap-4",children:i.jsx("img",{src:s==="dark"?'
            '"/assets/images/whatsai-logo-white.svg":"/assets/images/whatsai-logo-dark.svg",alt:"Logo",'
            'className:"h-full"})})',
            'className:"flex h-8 items-center gap-4",children:i.jsx("span",{className:"wa-wordmark",'
            'children:"WhatsAI"})})',
            'header logo')
    s = rep(s,
            'e&&i.jsx(Ei,{className:"h-8 w-8",children:i.jsx(ki,{src:u?.profilePicUrl||'
            '"/assets/images/whatsai-logo-dark.svg",alt:u?.name})})',
            'e&&i.jsx(Ei,{className:"h-8 w-8",children:u?.profilePicUrl?i.jsx(ki,{src:u.profilePicUrl,'
            'alt:u?.name||""}):i.jsx("span",{className:"wa-avatar-fallback",title:u?.name,"aria-hidden":"true",'
            'children:String(u?.name||"?").slice(0,1).toUpperCase()})})',
            'header avatar')
    return rep(s,
               'i.jsx("img",{className:"wa-home-logo",src:"/assets/images/whatsai-logo-dark.svg",alt:"WhatsAI"})',
               'i.jsx("span",{className:"wa-wordmark wa-home-wordmark",children:"WhatsAI"})',
               'entry screens top bar logo')


# ----------------------------------------------------------------------------------------------- sidebar
def patch_sidebar(s):
    s = rep(s,
            'i.jsx(se,{variant:"ghost",size:"sm",asChild:!0,children:i.jsxs(Fu,{to:e?'
            '`/manager/instance/${e}/observability`:"/manager/observability",',
            '!e&&i.jsx(se,{variant:"ghost",size:"sm",asChild:!0,children:i.jsxs(Fu,{to:"/manager/observability",',
            'header observability shortcut')
    s = rep(s,
            'return i.jsx("ul",{className:"flex h-full w-full flex-col gap-2 border-r border-border px-2",'
            'children:l.map(u=>i.jsx("li",{className:"divider"in u?"mt-auto":void 0,children:',
            'return i.jsx("ul",{className:"flex h-full w-full flex-col gap-2 border-r border-border px-2",'
            '"data-wa-nav":"",children:l.map((u,waIx)=>["divider"in u&&!(waIx>0&&"divider"in l[waIx-1])?'
            'i.jsx("li",{className:"wa-nav-label",role:"none",children:"Ferramentas"},"wa-nav-tools"):null,'
            'i.jsx("li",{className:"divider"in u?"wa-nav-tool":void 0,children:',
            'sidebar list')
    return rep(s, '},u.title))})}function Ky(', '},u.title)])})}function Ky(', 'sidebar list end')


# --------------------------------------------------------------------------------------------- dashboard
def patch_dashboard(s):
    return rep(s, 'i.jsx("h2",{className:"break-all text-lg font-semibold",children:g.name})',
               'i.jsx("h1",{className:"break-all text-lg font-semibold",children:g.name})', 'dashboard title')


# --------------------------------------------------------------------------------------------- instances
LIST_SKELETON = (
    'function WaListSkeleton(){const b=c=>i.jsx("span",{className:`wa-sk ${c}`});'
    'return [0,1,2,3].map(k=>i.jsxs("div",{className:"wa-sk-instance","aria-hidden":"true",children:['
    'b("wa-sk-title"),b("wa-sk-token"),b("wa-sk-text"),i.jsxs("div",{className:"wa-sk-foot",children:['
    'b("wa-sk-pill"),b("wa-sk-btn")]})]},k))}'
)


def patch_instances(s):
    s = rep(s, 'function CZ(', LIST_SKELETON + 'function CZ(', 'instance list skeleton component')
    s = rep(s, '{data:o,refetch:l}=q5()', '{data:o,refetch:l,isLoading:waListLoading}=q5()', 'instance list query')
    s = rep(s, '"Carregando instâncias..."',
            'waListLoading?i.jsxs("span",{children:[i.jsx("span",{className:"wa-sk wa-sk-inline","aria-hidden":"true"}),'
            'i.jsx("span",{className:"sr-only",children:"Carregando instâncias..."})]}):'
            '"Não foi possível carregar as instâncias. Use o botão de atualizar."',
            'instance list subtitle')
    s = rep(s, '"data-wa-instances":"",', '"data-wa-instances":"","aria-busy":waListLoading?"true":void 0,',
            'instance grid busy')
    return rep(s, 'i.jsx("p",{className:"wa-empty",children:e("dashboard.instancesNotFound")})',
               'waListLoading?WaListSkeleton():i.jsx("p",{className:"wa-empty",children:e("dashboard.instancesNotFound")})',
               'instance list empty state')


# ----------------------------------------------------------------------------------------- observability
OBS_START = 'const WhatsAIObservability=(()=>{'
OBS_END = 'return {Page:ObservabilityPage,Redirect:ObsRedirect};'
# text of the component after observability-ui.py + observability-alerts.py (+ grid) were applied
OBS_SHA256 = 'e1370c02da91ef6a7d15932eff4f1028dd1c9ab2860ec9c580e055017a6f2179'
# Minified names: i = jsx runtime, y = React, bd = axios instance of the API, Cj = Navigate, Fu = Link.
OBS_NEW = r"""const WhatsAIObservability=(()=>{
  const nf=new Intl.NumberFormat('pt-BR');
  function num(value,digits){const n=Number(value);if(!Number.isFinite(n))return '—';return nf.format(Number(n.toFixed(digits==null?(Math.abs(n)>=100?0:Math.abs(n)>=10?1:2):digits)));}
  function bytes(value){const n=Number(value);if(!Number.isFinite(n))return '—';if(n===0)return '0 B';const units=['B','KB','MB','GB','TB'];const i=Math.min(Math.floor(Math.log(Math.abs(n))/Math.log(1024)),units.length-1);return `${num(n/1024**i,i===0?0:2)} ${units[i]}`;}
  function minutes(value){const n=Number(value);if(!Number.isFinite(n))return '—';if(n<1)return `${num(n*60,0)} s`;if(n<60)return `${num(n,n<10?1:0)} min`;const h=Math.floor(n/60);const rest=Math.round(n%60);return `${h}h${rest?` ${rest}min`:''}`;}
  function metricValue(value,unit){if(value==null||Number.isNaN(Number(value)))return '—';if(unit==='bytes')return bytes(value);if(unit==='hours')return `${num(value)} h`;if(unit==='cu_hours')return `${num(value)} CU-h`;if(unit==='minutes')return minutes(value);if(unit==='count')return num(value,0);return num(value);}
  function clock(ts){try{return new Date(ts).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});}catch{return '';}}
  function relative(ts,now){if(!ts)return '';const s=Math.max(0,Math.floor((now-ts)/1000));if(s<5)return 'Atualizado agora';if(s<60)return `Atualizado há ${s}s`;if(s<3600)return `Atualizado há ${Math.floor(s/60)} min`;return `Atualizado às ${clock(ts)}`;}
  function statusLabel(s){return s==='ok'?'Operacional':s==='partial'?'Parcial':s==='missing'?'Não configurado':s==='error'?'Erro':String(s||'—');}
  function statusTone(s){return s==='ok'?'ok':s==='partial'?'warn':s==='error'?'bad':'neutral';}
  function mark(p){return ({neon:'N',render:'R',vercel:'V',github:'G',whatsapp:'W',system:'S'})[p.id]||String(p.name||'?').slice(0,1).toUpperCase();}
  function clamp(v){if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(100,n)):null;}function resourceVariant(s){const v=String(s||'').toLowerCase();if(['desconectada','desconectado','sem resposta','suspenso','suspended','error','failed','build_failed','update_failed','pre_deploy_failed','canceled','cancelled','unavailable'].includes(v))return 'destructive';if(['conectando','reconectando','connecting','queued','building','build_in_progress','update_in_progress','created','initializing'].includes(v))return 'warning';return 'secondary';}/*whatsai-patch:observability-ui:v1*/
  function resourceTone(s){const v=resourceVariant(s);if(v==='destructive')return 'bad';if(v==='warning')return 'warn';return ['online','conectado','conectada','live','active','ready','available','succeeded','deployed','ok'].includes(String(s||'').toLowerCase())?'ok':'neutral';}
  function safeUrl(value){if(!value)return null;try{const u=new URL(value,window.location.origin);return u.protocol==='http:'||u.protocol==='https:'?u.href:null;}catch{return null;}}
  /*whatsai-patch:render-style:observability-component*/
  // last good response, so the page opens with data while GET /observability (several seconds) runs again;
  // the response has no secrets (numbers, names, dashboard links); only reused for the same API URL
  const CACHE_KEY='whatsai-observability-cache-v1';
  const CACHE_MAX_AGE=24*60*60*1000;
  function readCache(){try{const raw=localStorage.getItem(CACHE_KEY);if(!raw)return null;const c=JSON.parse(raw);if(!c||!c.data||!Array.isArray(c.data.providers))return null;if(c.apiUrl!==(localStorage.getItem('apiUrl')||''))return null;const age=Date.now()-Number(c.savedAt);if(!(age>=0&&age<CACHE_MAX_AGE))return null;return c;}catch{return null;}}
  function writeCache(data){try{localStorage.setItem(CACHE_KEY,JSON.stringify({apiUrl:localStorage.getItem('apiUrl')||'',savedAt:Date.now(),data}));}catch{}}
  function svg(paths,cls){return i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:'16',height:'16',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'2',strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',className:cls,children:paths.map((d,k)=>i.jsx('path',{d},k))});}
  const ICON_REFRESH=['M21 12a9 9 0 1 1-2.64-6.36','M21 3v6h-6'];
  const ICON_EXTERNAL=['M15 3h6v6','M10 14 21 3','M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'];
  const ICON_ALERT=['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3','M12 9v4','M12 17h.01'];
"""


def obs_component():
    """Bundle text of the new component: OBS_NEW (helpers) + the UI kept in render-style-observability.js."""
    with open(os.path.join(os.path.dirname(__file__), 'render-style-observability.js'), encoding='utf-8') as fh:
        ui = fh.read()
    start = ui.index('/*ui:start*/')
    end = ui.index('/*ui:end*/')
    return OBS_NEW + ui[start + len('/*ui:start*/'):end].strip('\n') + '\n  ' + OBS_END


def patch_observability(s):
    if s.count(OBS_START) != 1:
        raise PatchError('observability: WhatsAIObservability not found exactly once')
    start = s.index(OBS_START)
    end = s.find(OBS_END, start)
    if end < 0:
        raise PatchError('observability: end of the component not found')
    end += len(OBS_END)
    digest = hashlib.sha256(s[start:end].encode('utf-8')).hexdigest()
    if digest != OBS_SHA256:
        raise PatchError(f'observability: unexpected component text (sha256 {digest[:12]}…); '
                         'run observability-ui.py, observability-alerts.py and observability-grid.py first')
    return s[:start] + obs_component() + s[end:]


GROUPS = [('brand', patch_brand), ('sidebar', patch_sidebar), ('dashboard', patch_dashboard),
          ('instances', patch_instances), ('observability', patch_observability)]


# ------------------------------------------------------------------------------------------ compiled css
def patch_fonts(css):
    old = 'font-family:"Geist Mono",monospace'
    n = css.count(old)
    if n != 2:
        raise PatchError(f'fonts: expected 2 matches of {old}, got {n}')
    return marker('fonts') + css.replace(old, 'font-family:Geist,sans-serif')


# -------------------------------------------------------------------------------------------- index.html
HTML_REPLACEMENTS = [
    ('favicon', '<link rel="icon" type="image/png" href="/assets/images/favicon.svg" />',
     '<link rel="icon" type="image/svg+xml" href="/assets/images/favicon.svg?v=2" />'),
    ('apple icon', '<link rel="apple-touch-icon" href="/assets/images/apple-touch-icon.png" />',
     '<link rel="apple-touch-icon" href="/assets/images/apple-touch-icon.png?v=2" />'),
    ('compiled css', '/assets/index-DsIrum0U.css?v=2"', '/assets/index-DsIrum0U.css?v=3"'),
    ('geist.css', '/assets/geist.css?v=1"', '/assets/geist.css?v=2"'),
    ('readme-tab.css', '/assets/readme-tab.css?v=7"', '/assets/readme-tab.css?v=8"'),
    ('readme-tab.js', '/assets/readme-tab.js?v=11"', '/assets/readme-tab.js?v=12"'),
    ('render-style.css', '    <link rel="stylesheet" href="/assets/home.css?v=1" />\n',
     '    <link rel="stylesheet" href="/assets/home.css?v=1" />\n'
     '    ' + html_marker('html') + '\n'
     '    <link rel="stylesheet" href="/assets/render-style.css?v=' + CSS_VERSION + '" />\n'),
]


def patch_html(html):
    for label, old, new in HTML_REPLACEMENTS:
        html = rep(html, old, new, f'index.html {label}')
    return html


def bump_index(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag not found exactly once')
    end = html.index('"', pos)
    current = html[pos + len(SCRIPT_TAG):end]
    if not current.isdigit():
        raise PatchError(f'index.html: unexpected bundle version ?v={current}')
    if int(current) >= int(CACHE_VERSION):
        return html
    return html[:pos + len(SCRIPT_TAG)] + CACHE_VERSION + html[end:]


def main():
    check = '--check' in sys.argv[1:]
    s = open(BUNDLE, encoding='utf-8').read()
    css = open(APP_CSS, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    if not os.path.isfile(STYLES):
        raise PatchError('manager/dist/assets/render-style.css is missing')
    missing = [name for name, _ in GROUPS if marker(name) not in s]
    if marker('fonts') not in css:
        missing.append('fonts')
    if html_marker('html') not in html:
        missing.append('html')

    if check:
        if bump_index(html) != html:
            missing.append('bundle ?v=')
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    for required in REQUIRED:
        if required not in s:
            raise PatchError(f'run the patch that adds {required} first')

    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_css = css
    if 'fonts' in missing:
        new_css = patch_fonts(css)
        report.append('fonts: applied')
    else:
        report.append('fonts: already applied')
    new_html = html
    if 'html' in missing:
        new_html = patch_html(new_html)
        report.append('html: applied')
    else:
        report.append('html: already applied')
    new_html = bump_index(new_html)

    # everything validated: write
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_css != css:
        open(APP_CSS, 'w', encoding='utf-8').write(new_css)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        report.append(f'index.html written (bundle ?v={CACHE_VERSION}, render-style.css ?v={CSS_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
