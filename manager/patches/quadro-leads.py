#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Leads em quadro por status e visões fixadas" (proposta C).

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/quadro-leads.css (a plain file, edited by hand, only var(--m-*) tokens of
minimal.css/theme.css), linked after ficha-lead.css by this script.

What it does (Leads page only; no API route or server change):
  helpers - module-level Board/Card and the pinned-view storage helpers. A card shows name (link to the lead
            record), area/city, priority, waiting, next step, first missing item and the last message; the status
            menu of acabamento-listas.py is repeated in the card footer, so touch screens change the status without
            dragging.
  state   - Page gets the list/board mode (localStorage, "lista" by default), the pinned views (localStorage,
            at most 8) and their counters. The counter queries reuse GET /leads/:instance with pageSize=1 for each
            pinned view; no timer, only when the pins change or after a status change.
  view    - in board mode the list query takes pageSize=100 and drops the status filter, so the same search, area,
            priority and period filters feed every column; the status view bar (wa-tw-segs) stays hidden because the
            columns are the statuses.
  actions - "Fixar visão" stores the current filters (name generated from them) and the sidebar lists them with a
            counter; clicking applies the filters, "x" removes. On drop, the card calls changeStatus, the same
            function used by the status menu (PATCH /leads/:instance/:id with {status}); no new endpoint.
  toolbar - "Lista / Quadro" toggle and "Fixar visão" button before Filtro/Ordenar.
  board   - body override: five columns (STATUS of leads.py) with the API counts, draggable cards, drop highlight,
            empty column hint and "Ver todos (n)" that opens the list filtered by that status.
  html    - links quadro-leads.css?v=1 after ficha-lead.css and raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything. Re-running is safe:
groups whose marker is present are skipped. Order: run after leads.py, acabamento-listas.py, leads-xlsx.py and
ficha-lead.py (the anchors and the lead record route come from them).

Usage (from the repository root):
  python3 -I manager/patches/quadro-leads.py           # apply
  python3 -I manager/patches/quadro-leads.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'quadro-leads.css')
CACHE_VERSION = '66'
CSS_VERSION = '1'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
FICHA_LINK = '    <link rel="stylesheet" href="/assets/ficha-lead.css?v=1" />'
CSS_LINK = '    <link rel="stylesheet" href="/assets/quadro-leads.css?v=' + CSS_VERSION + '" />'
REQUIRED = ('/*whatsai-patch:leads:component*/', '/*whatsai-patch:acabamento-listas:status*/',
            '/*whatsai-patch:acabamento-listas:notif*/', '/*whatsai-patch:leads-xlsx:export*/',
            '/*whatsai-patch:ficha-lead:page*/', '/*whatsai-patch:ficha-lead:route*/')


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:quadro-leads:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:quadro-leads:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# Minified names (bundle index-b29a5d7a.js): i = jsx runtime, y = React, Ee = axios instance of the API, me = toast,
# Fu = react-router Link, nf = Intl.NumberFormat, WaLeads = the leads module of leads.py, svg/title/ago/lbl/STATUS/
# Prio/Wait/StatusMenu are its helpers (StatusMenu comes from acabamento-listas.py).

HELPERS = r'''  /* ---------------------------------------------------------------- board + pinned views */
  const PIN_KEY='wa-leads-pins',MAX_PINS=8;
  function readPins(){try{const a=JSON.parse(ls_(PIN_KEY)||'[]');return Array.isArray(a)?a.filter(p=>p&&typeof p.id==='string'&&p.filters&&typeof p.filters==='object').slice(0,MAX_PINS):[]}catch(e){return[]}}
  function savePins(list){ls_(PIN_KEY,JSON.stringify(list))}
  function pinName(f){const p=[];if(f.seg&&f.seg!=='todos')p.push(lbl(VIEWS,f.seg));if(f.area)p.push('Área: '+f.area);if(f.priority)p.push('Prioridade '+lbl(PRIOS,f.priority).toLowerCase());if(f.period&&f.period!=='any')p.push(lbl(PERIODS,f.period));return p.length?p.join(' · '):'Todos os leads'}
  function Card({lead,instanceId,onOpen,changeStatus,onDragStart,onDragEnd,dragging}){
    const meta=[lead.area,lead.city].filter(Boolean).join(' · ');
    return i.jsxs('article',{className:'wl-card',draggable:!0,tabIndex:0,'data-dragging':dragging?'true':void 0,'aria-label':'Lead '+title(lead)+', '+lbl(STATUS,lead.status),
      onClick:()=>onOpen(lead),onKeyDown:e=>{if(e.key==='Enter'&&e.target===e.currentTarget){e.preventDefault();onOpen(lead)}},
      onDragStart:e=>{e.dataTransfer.setData('text/plain',lead.id);e.dataTransfer.effectAllowed='move';onDragStart(lead)},
      onDragEnd:onDragEnd,children:[
      i.jsxs('div',{className:'wl-card-top',children:[
        i.jsx(Fu,{to:'/manager/instance/'+instanceId+'/leads/'+encodeURIComponent(lead.id),className:'wl-card-name',draggable:!1,onClick:e=>e.stopPropagation(),children:i.jsx('strong',{children:title(lead)})}),
        i.jsx(Prio,{lead})]}),
      meta?i.jsx('p',{className:'wl-card-meta',children:meta}):null,
      lead.nextStep?i.jsx('p',{className:'wl-card-step',children:lead.nextStep}):null,
      lead.missingInfo&&lead.missingInfo.length?i.jsx('p',{className:'wl-card-miss',children:'Falta: '+lead.missingInfo[0]}):null,
      lead.awaitingHumanSince?i.jsx('div',{className:'wl-card-chips',children:i.jsx(Wait,{at:lead.awaitingHumanSince})}):null,
      i.jsxs('div',{className:'wl-card-foot',children:[
        i.jsx('span',{className:'wl-card-when',children:lead.lastMessageAt?'Última '+ago(lead.lastMessageAt):''}),
        i.jsx('span',{className:'wl-card-status',onClick:e=>e.stopPropagation(),onKeyDown:e=>e.stopPropagation(),children:i.jsx(StatusMenu,{status:lead.status,label:title(lead),onChange:s=>changeStatus(lead,s)})})]})]});
  }
  function Board({list,counts,instanceId,onOpen,changeStatus,onSeeAll,pins,pinCounts,onApplyPin,onRemovePin,drag,over,setDrag,setOver}){
    const by={};
    for(const l of list)(by[l.status]=by[l.status]||[]).push(l);
    const total=Number(counts.todos)||0,shown=list.length;
    return i.jsxs('div',{className:'wl-board-shell',children:[
      i.jsxs('aside',{className:'wl-pins','aria-label':'Visões fixadas',children:[
        i.jsxs('div',{className:'wl-pins-head',children:[svg('flag',14),i.jsx('h2',{className:'wl-pins-title',children:'Visões fixadas'}),pins.length?i.jsx('span',{className:'wl-pins-n',children:pins.length}):null]}),
        pins.length?i.jsx('ul',{className:'wl-pins-list',children:pins.map(p=>i.jsxs('li',{className:'wl-pin',children:[
          i.jsxs('button',{type:'button',className:'wl-pin-main',title:'Aplicar os filtros desta visão',onClick:()=>onApplyPin(p),children:[
            i.jsx('span',{className:'wl-pin-name',children:p.name}),
            i.jsx('span',{className:'wl-pin-n','aria-label':(pinCounts[p.id]==null?'contando':pinCounts[p.id])+' lead(s) nesta visão',children:pinCounts[p.id]===void 0?'…':pinCounts[p.id]===null?'—':nf.format(pinCounts[p.id])})]}),
          i.jsx('button',{type:'button',className:'wl-pin-x','aria-label':'Remover visão '+p.name,onClick:()=>onRemovePin(p.id),children:svg('x',12)})]},p.id))}):i.jsx('p',{className:'wl-hint',children:'Ajuste os filtros e use "Fixar visão" para guardar a visão aqui.'}),
        i.jsx('p',{className:'wl-hint',children:'As visões ficam salvas neste navegador (até 8).'})]}),
      i.jsxs('div',{className:'wl-board-main',children:[
        i.jsx('div',{className:'wl-board',children:STATUS.map(([s,label])=>i.jsxs('section',{className:'wl-col','data-over':over===s?'true':void 0,
          onDragOver:e=>{e.preventDefault();if(over!==s)setOver(s)},onDragEnter:e=>{e.preventDefault();setOver(s)},
          onDragLeave:e=>{if(!e.currentTarget.contains(e.relatedTarget))setOver('')},
          onDrop:e=>{e.preventDefault();setOver('');const id=e.dataTransfer.getData('text/plain')||drag;setDrag('');const lead=list.find(x=>x.id===id);if(lead&&lead.status!==s)changeStatus(lead,s)},children:[
          i.jsxs('header',{className:'wl-col-head',children:[i.jsx('span',{className:'wa-fin-dot','data-status':s,'aria-hidden':'true'}),i.jsx('h3',{className:'wl-col-title',children:label}),i.jsx('span',{className:'wl-col-n',children:nf.format(counts[s]||0)})]}),
          i.jsx('div',{className:'wl-col-body',children:(by[s]||[]).length?(by[s]||[]).map(l=>i.jsx(Card,{lead:l,instanceId,onOpen,changeStatus,drag:drag===l.id,onDragStart:x=>setDrag(x.id),onDragEnd:()=>setDrag('')},l.id)):i.jsx('p',{className:'wl-col-empty',children:'Nenhum lead nesta etapa'})}),
          (counts[s]||0)>(by[s]||[]).length?i.jsx('button',{type:'button',className:'wl-col-more',onClick:()=>onSeeAll(s),children:'Ver todos ('+nf.format(counts[s])+')'}):null]},s))}),
        total>shown?i.jsx('p',{className:'wl-hint wl-board-note',children:'Mostrando os primeiros '+nf.format(shown)+' de '+nf.format(total)+' lead(s) do filtro. Use "Ver todos" na coluna ou o modo Lista para ver os demais.'}):null]})]});
  }

'''

STATE_OLD = ("const[v,setV]=y.useState(()=>{const o=readView(),s=new URLSearchParams(loc.search||'').get('seg');"
             "return s&&has(VIEWS,s)?{...o,seg:s}:o}),[q,setQ]=y.useState(''),[dq,setDq]=y.useState(''),"
             "[page,setPage]=y.useState(1);")
STATE_NEW = (STATE_OLD + "\n    const[mode,setMode]=y.useState(()=>ls_('wa-leads-mode')==='quadro'?'quadro':'lista'),"
             "[pins,setPins]=y.useState(readPins),[pinCounts,setPinCounts]=y.useState({}),[pinTick,setPinTick]=y.useState(0),"
             "[drag,setDrag]=y.useState(''),[over,setOver]=y.useState('');const board=mode==='quadro';\n"
             "    y.useEffect(()=>{if(!name||!pins.length){setPinCounts({});return}let live=!0;\n"
             "      const params=f=>{const o={page:1,pageSize:1,sort:f.sort||'priority'};if(f.seg&&f.seg!=='todos')o.status=f.seg;"
             "if(f.area)o.area=f.area;if(f.priority)o.priority=f.priority;const s=since(f.period);if(s)o.since=s;return o};\n"
             "      Promise.all(pins.map(p=>Ee.get('/leads/'+encodeURIComponent(name),{params:params(p.filters)}).then("
             "r=>[p.id,(r.data&&r.data.total)||0],()=>[p.id,null]))).then(rows=>{if(!live)return;const o={};"
             "for(const[id,n]of rows)o[id]=n;setPinCounts(o)});\n"
             "      return()=>{live=!1}},[name,pins,pinTick]);")

QUERY_OLD = ("const query=y.useMemo(()=>{const o={sort:v.sort,page,pageSize:25};if(v.seg!=='todos')o.status=v.seg;"
             "if(v.area)o.area=v.area;if(v.priority)o.priority=v.priority;const s=since(v.period);if(s)o.since=s;"
             "if(dq)o.search=dq;return o},[v,page,dq]);")
QUERY_NEW = ("const query=y.useMemo(()=>{const o={sort:v.sort,page,pageSize:board?100:25};if(!board&&v.seg!=='todos')"
             "o.status=v.seg;if(v.area)o.area=v.area;if(v.priority)o.priority=v.priority;const s=since(v.period);"
             "if(s)o.since=s;if(dq)o.search=dq;return o},[v,page,dq,board]);")

STATUS_OLD = ("const changeStatus=async(l,s)=>{try{const r=await Ee.patch('/leads/'+encodeURIComponent(name)+'/'+"
              "encodeURIComponent(l.id),{status:s});me.success('Status de '+title(l)+': '+lbl(STATUS,s)+'.');"
              "patchRow(r.data&&r.data.lead)}catch(e){me.error(errText(e))}};")
STATUS_NEW = (STATUS_OLD.replace('patchRow(r.data&&r.data.lead)', 'patchRow(r.data&&r.data.lead);setPinTick(t=>t+1)') +
              "\n    const pinView=()=>{const f={seg:board?'todos':v.seg,area:v.area,priority:v.priority,period:v.period,sort:v.sort};\n"
              "      if(pins.some(p=>JSON.stringify(p.filters)===JSON.stringify(f))){me.info('Essa visão já está fixada neste navegador.');return}\n"
              "      const next=[...pins,{id:'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),name:pinName(f),filters:f}].slice(-MAX_PINS);\n"
              "      setPins(next);savePins(next);me.success('Visão fixada neste navegador.');};\n"
              "    const applyPin=p=>set(p.filters||{});\n"
              "    const removePin=id=>{const next=pins.filter(p=>p.id!==id);setPins(next);savePins(next)};\n"
              "    const switchMode=m=>{setMode(m);ls_('wa-leads-mode',m);setPage(1);if(m==='quadro')set({seg:'todos'})};\n"
              "    const seeAll=s=>{switchMode('lista');set({seg:s})};")

TOOLBAR_OLD = "i.jsxs('div',{className:'wl-bar-right',children:["
TOOLBAR_NEW = (TOOLBAR_OLD + "\n          i.jsxs('div',{className:'wl-mode',role:'group','aria-label':'Formato da lista de leads',children:[\n"
               "            i.jsx('button',{type:'button',className:'wl-mode-btn','aria-pressed':board?'false':'true',onClick:()=>switchMode('lista'),children:'Lista'}),\n"
               "            i.jsx('button',{type:'button',className:'wl-mode-btn','aria-pressed':board?'true':'false',onClick:()=>switchMode('quadro'),children:'Quadro'})]}),\n"
               "          board?i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:pinView,"
               "title:'Guardar os filtros atuais como uma visão fixada',children:[svg('flag',14),'Fixar visão']}):null,\n"
               "          ")

SEGS_OLD = "i.jsx('div',{className:'wa-tw-segs',role:'group','aria-label':'Visão dos leads',"
SEGS_NEW = "board?null:" + SEGS_OLD

BODY_ANCHOR = "    return i.jsxs('main',{className:'wl-page',children:["
BODY_NEW = ("    if(board&&d&&(list.length||counts.todos||dq||nFilters))body=i.jsx(Board,{list,counts,instanceId:g.id,"
            "onOpen:setOpen,changeStatus,pins,pinCounts,onApplyPin:applyPin,onRemovePin:removePin,onSeeAll:seeAll,"
            "drag,over,setDrag,setOver});\n" + BODY_ANCHOR)


def patch_helpers(s):
    return rep(s, '  /* ---------------------------------------------------------------- page */',
               marker('helpers') + HELPERS + '  /* ---------------------------------------------------------------- page */',
               'WaLeads page comment')


def patch_state(s):
    return rep(s, STATE_OLD, marker('state') + STATE_NEW, 'Leads Page state')


def patch_query(s):
    return rep(s, QUERY_OLD, marker('query') + QUERY_NEW, 'Leads list query')


def patch_actions(s):
    return rep(s, STATUS_OLD, marker('actions') + STATUS_NEW, 'Leads changeStatus + pinned view actions')


def patch_toolbar(s):
    return rep(s, TOOLBAR_OLD, marker('toolbar') + TOOLBAR_NEW, 'Leads toolbar')


def patch_segs(s):
    return rep(s, SEGS_OLD, marker('segs') + SEGS_NEW, 'Leads status view bar')


def patch_board(s):
    return rep(s, BODY_ANCHOR, marker('board') + BODY_NEW, 'Leads page return')


GROUPS = [('helpers', patch_helpers), ('state', patch_state), ('query', patch_query),
          ('actions', patch_actions), ('toolbar', patch_toolbar), ('segs', patch_segs),
          ('board', patch_board)]


def patch_html(html):
    if html_marker('html') in html:
        return html
    if html.count(FICHA_LINK) != 1:
        raise PatchError('index.html: ficha-lead.css link not found exactly once (run ficha-lead.py first)')
    return html.replace(FICHA_LINK, FICHA_LINK + '\n    ' + html_marker('html') + '\n' + CSS_LINK, 1)


def bump_index(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag not found exactly once')
    end = pos + len(SCRIPT_TAG)
    while end < len(html) and html[end].isdigit():
        end += 1
    current = html[pos + len(SCRIPT_TAG):end]
    if not current.isdigit():
        raise PatchError(f'index.html: unexpected bundle version ?v={current}')
    if int(current) >= int(CACHE_VERSION):
        return html
    return html[:pos + len(SCRIPT_TAG)] + CACHE_VERSION + html[end:]


def check_missing(s, html):
    missing = [name for name, _ in GROUPS if marker(name) not in s]
    if html_marker('html') not in html:
        missing.append('html')
    if not os.path.isfile(CSS):
        missing.append('quadro-leads.css')
    if CSS_LINK not in html:
        missing.append('quadro-leads.css link')
    if bump_index(html) != html:
        missing.append('index.html bundle version')
    return missing


def main():
    check = '--check' in sys.argv[1:]
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()

    if check:
        missing = check_missing(s, html)
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/quadro-leads.css is missing')
    for required in REQUIRED:
        if required not in s:
            raise PatchError(f'run the patch that adds {required} first')

    report = []
    for name, fn in GROUPS:
        if marker(name) in s:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = bump_index(patch_html(html))

    missing = check_missing(s, new_html)
    if missing:
        raise PatchError(f'still missing after apply: {missing}')

    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        report.append(f'index.html written (quadro-leads.css ?v={CSS_VERSION}, bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
