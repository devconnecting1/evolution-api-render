#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager bundle: limit alerts on "Observabilidade" and a single <main>.

Same method as openai-fields.py, responsive.py, openai-media.py and observability-ui.py: manager/dist is the
upstream evolution-manager-v2 2.3.5 build plus manual customizations, so changes are exact string replacements
on the minified bundle instead of a rebuild. Frontend only: it reads what GET /observability already returns.

Groups (each one is applied once and leaves a marker comment at the top of the bundle):
  alerts - a banner at the top of the page lists `alerts` of the response in plain PT-BR (yellow when near a
           limit, red at 100% or more, projections included; e.g. "Neon: projeção de 137 de 100 CU-h no mês —
           o banco será suspenso por volta de 23/11"), each with a link that scrolls to the provider card
           (cards get id="obs-provider-<id>"). Nothing is shown without alerts. The compiled CSS has no
           `.underline` utility, so these links and "Configure as variáveis" get it inline.
  main   - /manager/observability is rendered inside the layout B5, which already has a <main>: the page
           there now renders a <div> (prop nested). On /manager/instance/:id/observability (layout without
           <main>) it keeps its own <main>, so each route has exactly one.
Applying also bumps the bundle ?v= in index.html to CACHE_VERSION (only raised, never lowered).

Every anchor must match exactly once (the two roots of the page: exactly twice), otherwise the script stops
without writing anything. Re-running is safe: groups whose marker is present are skipped.
Order: run after observability-ui.py (the anchors are inside the page it already patched).

Usage (from the repository root):
  python3 -I manager/patches/observability-alerts.py           # apply
  python3 -I manager/patches/observability-alerts.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CACHE_VERSION = '12'
REQUIRED = ('/*whatsai-patch:observability-ui:v1*/',)


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:observability-alerts:' + name + '*/'


def rep(s, old, new, label, count=1):
    n = s.count(old)
    if n != count:
        raise PatchError(f'{label}: expected {count} match(es), got {n}')
    return s.replace(old, new)


def svg(paths, size='16'):
    """Inline lucide-style icon (the bundle has no TriangleAlert component)."""
    children = ','.join('i.jsx("path",{d:"%s"})' % d for d in paths)
    return ('i.jsxs("svg",{xmlns:"http://www.w3.org/2000/svg",width:"%s",height:"%s",viewBox:"0 0 24 24",'
            'fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",'
            '"aria-hidden":"true",focusable:"false",children:[%s]})') % (size, size, children)


# ----------------------------------------------------------------------------------------------- alerts
# Inside WhatsAIObservability (observability-ui.py): metricValue / num / vu (Badge) / rI, sI, RX (Alert,
# AlertTitle, AlertDescription). Alert = {provider, metric, label, percent, status, message}
# (src/api/services/observability.shared.ts); used / limit / unit come from the metric of the provider.
TRIANGLE = svg(['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'])

ALERTS = (
    # the compiled CSS has no `.underline` utility (only hover:underline): links get it inline
    "const LINK={textDecorationLine:'underline',textUnderlineOffset:'4px'};"
    "function alertOver(a){const n=Number(a&&a.percent);return Number.isFinite(n)&&n>=100;}"
    # Neon writes the exhaustion date in a note: "acabam por volta de 23/11, 14:00" (period in progress) or
    # "acabariam por volta do dia 23" (first, short period projected to a full month: day of the next period)
    "function alertNeonDate(p){const notes=(Array.isArray(p&&p.notes)?p.notes:[]).map(String);"
    "for(const n of notes){const m=n.match(/por volta de (\\d{2}\\/\\d{2})/);if(m)return `por volta de ${m[1]}`;}"
    "for(const n of notes){const m=n.match(/por volta do dia (\\d{1,2})/);if(!m)continue;"
    "const end=notes.map(x=>x.match(/termina em (\\d{2})\\/(\\d{2})/)).find(Boolean);"
    "if(!end)return `por volta do dia ${m[1]} do próximo mês`;"
    "const next=new Date(new Date().getFullYear(),Number(end[2])-1,Number(end[1])+1);"
    "return `por volta de ${String(m[1]).padStart(2,'0')}/${String(next.getMonth()+1).padStart(2,'0')}`;}"
    "return null;}"
    "function alertText(a,p){const name=p&&p.name||a.provider||'Provedor';"
    "const m=(Array.isArray(p&&p.metrics)?p.metrics:[]).find(x=>x&&x.id===a.metric)||{};"
    "const unit=m.unit||'number';const has=m.used!=null&&m.limit!=null;"
    "const amount=has?`${unit==='bytes'?metricValue(m.used,unit):num(m.used)} de ${metricValue(m.limit,unit)}`:'';"
    "const pct=`${num(a.percent,0)}%`;const over=alertOver(a);const neon=a.provider==='neon';"
    "if(/_projection$/.test(String(a.metric||''))){"
    "const base=`${name}: projeção de ${amount||pct+' do limite'}${has?' no mês':''}`;"
    "if(!over)return `${base} — perto do limite`;"
    "if(neon){const when=alertNeonDate(p);return `${base} — o banco será suspenso ${when||'antes do fim do mês'}`;}"
    "return `${base} — passa do limite antes do fim do mês`;}"
    "const what=String(a.label||m.label||a.metric||'Uso');"
    "if(over){const tail=neon&&(a.metric==='compute'||a.metric==='egress')?' — o banco fica suspenso até o próximo período':'';"
    "return `${name}: ${what} atingiu o limite${amount?` (${amount})`:''}${tail}`;}"
    "return `${name}: ${what} em ${pct} do limite${amount?` (${amount})`:''}`;}"
    "function alertGo(e,id){const el=document.getElementById(id);if(!el)return;e.preventDefault();"
    "el.scrollIntoView({behavior:window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});"
    "try{el.focus({preventScroll:true});}catch{}}"
    "function ObsAlerts({alerts,providers}){"
    "const list=Array.isArray(alerts)?alerts.filter(a=>a&&a.provider):[];if(!list.length)return null;"
    "const over=list.some(alertOver);const byId=Object.fromEntries((providers||[]).map(p=>[p.id,p]));"
    "const title=over?(list.length===1?'1 limite estourado ou projetado acima do limite':`${list.length} alertas de limite — "
    "pelo menos um acima do limite`):(list.length===1?'1 alerta: perto do limite':`${list.length} alertas: perto do limite`);"
    "return i.jsxs(rI,{variant:over?'destructive':'warning',role:'region','aria-labelledby':'observability-alerts-title',"
    "id:'observability-alerts','data-wa-alerts':over?'over':'near',children:[" + TRIANGLE + ","
    "i.jsx(sI,{id:'observability-alerts-title',className:'font-semibold',children:title}),"
    "i.jsx(RX,{children:i.jsx('ul',{className:'mt-2 space-y-2',children:list.map((a,idx)=>{const p=byId[a.provider];"
    "const target=`obs-provider-${a.provider}`;const o=alertOver(a);"
    "return i.jsxs('li',{className:'flex flex-wrap items-center gap-2',children:["
    "i.jsx(vu,{variant:o?'destructive':'warning',children:o?'Acima do limite':'Perto do limite'}),"
    "i.jsx('span',{className:'min-w-0 break-words',children:alertText(a,p)}),"
    "p?i.jsx('a',{href:`#${target}`,className:'font-medium underline-offset-4',style:LINK,onClick:e=>alertGo(e,target),"
    "children:`Ver ${p.name||'card'}`}):null"
    "]},`${a.provider}:${a.metric}:${idx}`);})})})"
    "]});}"
)


def patch_alerts(s):
    start = s.find('const WhatsAIObservability=(()=>{')
    end = s.find('return {Page:ObservabilityPage,Redirect:ObsRedirect};', start)
    if s.count('const WhatsAIObservability=(()=>{') != 1 or end < 0:
        raise PatchError('component: WhatsAIObservability not found exactly once')
    c = s[start:end]
    c = rep(c, '  function ObsRedirect(){', '  ' + ALERTS + '\n  function ObsRedirect(){', 'alerts component')
    c = rep(c, "return i.jsxs(So,{className:'flex flex-col',children:[",
            "return i.jsxs(So,{className:'flex flex-col',id:`obs-provider-${p.id}`,tabIndex:-1,"
            "style:{scrollMarginTop:16},children:[",
            'provider card id')
    c = rep(c, "i.jsx('a',{href:'#observability-config',className:'underline underline-offset-4',onClick:",
            "i.jsx('a',{href:'#observability-config',className:'underline underline-offset-4',style:LINK,onClick:",
            '"Configure as variáveis" link underline')
    c = rep(c, '      header,\n      summary,\n',
            '      header,\n      i.jsx(ObsAlerts,{alerts:data?.alerts,providers}),\n      summary,\n', 'alerts banner')
    return s[:start] + c + s[end:]


# ------------------------------------------------------------------------------------------------- main
def patch_main(s):
    start = s.find('const WhatsAIObservability=(()=>{')
    end = s.find('return {Page:ObservabilityPage,Redirect:ObsRedirect};', start)
    if start < 0 or end < 0:
        raise PatchError('component: WhatsAIObservability not found')
    c = s[start:end]
    c = rep(c, '  function ObservabilityPage(){', "  function ObservabilityPage({nested}){\n    const Root=nested?'div':'main';",
            'page props')
    c = rep(c, "i.jsxs('main',{className:'container mx-auto flex flex-col gap-6 py-6',children:[",
            "i.jsxs(Root,{className:'container mx-auto flex flex-col gap-6 py-6',children:[", 'page root', count=2)
    s = s[:start] + c + s[end:]
    return rep(s,
               '{path:"/manager/observability",element:i.jsx(tn,{children:i.jsx(B5,{children:'
               'i.jsx(WhatsAIObservability.Page,{})',
               '{path:"/manager/observability",element:i.jsx(tn,{children:i.jsx(B5,{children:'
               'i.jsx(WhatsAIObservability.Page,{nested:!0})',
               'route inside B5 (already has <main>)')




GROUPS = [('alerts', patch_alerts), ('main', patch_main)]


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
    html = open(INDEX, encoding='utf-8').read()
    missing = [name for name, _ in GROUPS if marker(name) not in s]

    if check:
        ok = not missing and bump_index(html) == html
        print('ok: all groups applied' if ok else f'missing: {missing or ["index.html cache version"]}')
        return 0 if ok else 1

    if missing and any(required not in s for required in REQUIRED):
        raise PatchError('run manager/patches/observability-ui.py first')

    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')

    new_html = bump_index(html)
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    print('\n'.join(report))
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        print(f'index.html: bundle ?v={CACHE_VERSION}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
