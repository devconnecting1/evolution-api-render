#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: Agenda polished with the scheduling model of Cal.diy / Cal.com.

API (same release): each appointment type has `active` (paused types are not offered or booked by the AI; the
team still books them), `maxPerDay` (at most N appointments of the type per day, like Cal.com "Limit booking
frequency") and `minNoticeHours` (its own minimum notice). DELETE /agenda/:instance/:id accepts `reason`
(internal, appended to the notes). No migration: the types are JSON.

1. types  - in "Tipos de atendimento" each type gets "Ativo (a IA oferece)", "Limite por dia" and "Antecedência (h)".
2. list   - the Lista view has the tabs Próximos · Pendentes · Passados · Cancelados with counts (Cal.com Bookings:
            Upcoming / Unconfirmed / Past / Canceled), on the loaded period; an empty tab says so.
3. cancel - the cancel confirmation asks an optional reason (only the team sees it).
4. html   - agenda.css?v=3 and the bundle ?v= raised to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after agenda.py and google-agenda.py.

Usage (from the repository root):
  python3 -I manager/patches/agenda-polish.py           # apply
  python3 -I manager/patches/agenda-polish.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
REQUIRED = ('/*whatsai-patch:agenda:component*/',)
CACHE_VERSION = '47'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
AGENDA_CSS_VERSION = '3'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:agenda-polish:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:agenda-polish:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


# ---------------------------------------------------------------------------------------------- 1. types
TYPES = [
    ('toForm types',
     "types:(s.appointmentTypes||[]).map(t=>({...t,minutes:String(t.minutes),location:t.location||'',instructions:t.instructions||''}))",
     "types:(s.appointmentTypes||[]).map(t=>({...t,minutes:String(t.minutes),location:t.location||'',instructions:t.instructions||'',"
     "active:t.active!==!1,maxPerDay:t.maxPerDay==null?'':String(t.maxPerDay),minNoticeHours:t.minNoticeHours==null?'':String(t.minNoticeHours)}))"),
    ('toBody types',
     "appointmentTypes:f.types.map(t=>({name:t.name.trim(),minutes:Number(t.minutes),mode:t.mode||'presencial',location:t.location.trim()||null,instructions:t.instructions.trim()||null}))",
     "appointmentTypes:f.types.map(t=>({name:t.name.trim(),minutes:Number(t.minutes),mode:t.mode||'presencial',location:t.location.trim()||null,instructions:t.instructions.trim()||null,"
     "active:t.active!==!1,maxPerDay:String(t.maxPerDay||'').trim()===''?null:Number(t.maxPerDay),minNoticeHours:String(t.minNoticeHours||'').trim()===''?null:Number(t.minNoticeHours)}))"),
    ('type row fields',
     "h('input',{className:'wag-input','aria-label':'O que levar',placeholder:'O que levar (opcional), ex.: documento com foto',maxLength:500,value:t.instructions,onChange:e=>setList('types',n,{instructions:e.target.value})}),",
     "h('input',{className:'wag-input','aria-label':'O que levar',placeholder:'O que levar (opcional), ex.: documento com foto',maxLength:500,value:t.instructions,onChange:e=>setList('types',n,{instructions:e.target.value})}),"
     "h('div',{className:'wag-typerules'},"
     "h('label',{className:'wag-check'},h('input',{type:'checkbox',checked:t.active!==!1,onChange:e=>setList('types',n,{active:e.target.checked})}),h('span',null,t.active!==!1?'Ativo: a IA oferece este tipo':'Pausado: só a equipe agenda')),"
     "h('label',{className:'wag-mini'},h('span',{className:'wag-hint'},'Limite por dia'),h('input',{className:'wag-input',type:'number',min:1,max:100,step:1,placeholder:'Sem limite','aria-label':'Limite de agendamentos deste tipo por dia',value:t.maxPerDay??'',onChange:e=>setList('types',n,{maxPerDay:e.target.value})})),"
     "h('label',{className:'wag-mini'},h('span',{className:'wag-hint'},'Antecedência (h)'),h('input',{className:'wag-input',type:'number',min:0,max:720,step:1,placeholder:'Padrão','aria-label':'Antecedência mínima deste tipo, em horas',value:t.minNoticeHours??'',onChange:e=>setList('types',n,{minNoticeHours:e.target.value})}))),"),
    ('new type default',
     "{name:'',minutes:String(f.slotMinutes||30),mode:'presencial',location:'',instructions:''}",
     "{name:'',minutes:String(f.slotMinutes||30),mode:'presencial',location:'',instructions:'',active:!0,maxPerDay:'',minNoticeHours:''}"),
]
PROBLEMS_OLD = "    for(const t of f.types){if(!t.name.trim())e.push('Cada tipo precisa de um nome.');"
PROBLEMS_NEW = (
    "    for(const t of f.types){const lim=String(t.maxPerDay??'').trim(),nt=String(t.minNoticeHours??'').trim();"
    "if(lim&&!(Number.isInteger(Number(lim))&&Number(lim)>=1&&Number(lim)<=100))e.push((t.name||'Tipo')+': limite por dia de 1 a 100, ou vazio.');"
    "if(nt&&!(Number.isInteger(Number(nt))&&Number(nt)>=0&&Number(nt)<=720))e.push((t.name||'Tipo')+': antecedência de 0 a 720 horas, ou vazio.')}\n"
    "    if(!f.types.some(t=>t.active!==!1))e.push('Deixe pelo menos um tipo ativo, ou a IA não consegue agendar.');\n"
    "    for(const t of f.types){if(!t.name.trim())e.push('Cada tipo precisa de um nome.');"
)


def g_types(s):
    for label, old, new in TYPES:
        s = rep(s, old, new, label)
    return rep(s, PROBLEMS_OLD, PROBLEMS_NEW, 'type problems')


# ----------------------------------------------------------------------------------------------- 2. list
LIST_OLD = (
    "  function List({list,settings,onOpen}){\n"
    "    const tz=settings.timezone;\n"
    "    if(!list.length)return h('div',{className:'wag-empty'},h('span',{className:'wag-empty-ico'},svg('cal',20)),h('p',{className:'wag-empty-title'},'Nenhum agendamento neste período'),"
)
LIST_NEW = (
    "  const TABS=[['next','Próximos','Nenhum agendamento próximo neste período'],['pending','Pendentes','Nenhum pedido aguardando aprovação'],['past','Passados','Nenhum agendamento passado neste período'],['cancelled','Cancelados','Nenhum cancelamento neste período']];\n"
    "  function inTab(a,tab,now){const end=Date.parse(a.endsAt);if(tab==='cancelled')return a.status==='cancelado';if(a.status==='cancelado')return!1;if(tab==='pending')return a.status==='pendente';if(tab==='past')return end<now;return end>=now}\n"
    "  function List({list:all,settings,onOpen}){\n"
    "    const tz=settings.timezone,now=Date.now();\n"
    "    const[tab,setTab]=y.useState(()=>{try{return sessionStorage.getItem('wag-tab')||'next'}catch{return'next'}});\n"
    "    y.useEffect(()=>{try{sessionStorage.setItem('wag-tab',tab)}catch{}},[tab]);\n"
    "    const counts=Object.fromEntries(TABS.map(([k])=>[k,all.filter(a=>inTab(a,k,now)).length]));\n"
    "    const cur=TABS.find(x=>x[0]===tab)||TABS[0],list=all.filter(a=>inTab(a,cur[0],now));\n"
    "    if(cur[0]==='past')list.reverse();\n"
    "    const bar=h('div',{className:'wag-tabs',role:'tablist','aria-label':'Agendamentos'},TABS.map(([k,l])=>h('button',{key:k,type:'button',role:'tab','aria-selected':cur[0]===k?'true':'false',className:'wag-tab','data-tab':k,onClick:()=>setTab(k)},l,h('span',{className:'wag-tab-n'},String(counts[k])))));\n"
    "    if(!list.length)return h('div',{className:'wag-listwrap'},bar,all.length?h('div',{className:'wag-empty'},h('span',{className:'wag-empty-ico'},svg('cal',20)),h('p',{className:'wag-empty-title'},cur[2]),h('p',{className:'wag-hint'},'Use as setas para ver outro período.')):"
    "h('div',{className:'wag-empty'},h('span',{className:'wag-empty-ico'},svg('cal',20)),h('p',{className:'wag-empty-title'},'Nenhum agendamento neste período'),"
)
LIST_RET_OLD = "    return h('div',{className:'wag-list'},groups.map(g=>h('section',{key:g.d,className:'wag-list-day'}"
LIST_RET_NEW = "    return h('div',{className:'wag-listwrap'},bar,h('div',{className:'wag-list'},groups.map(g=>h('section',{key:g.d,className:'wag-list-day'}"
LIST_END_OLD = "        h('span',{className:'wag-chip','data-status':a.status},SL[a.status]||a.status))))))));\n  }"
LIST_END_NEW = "        h('span',{className:'wag-chip','data-status':a.status},SL[a.status]||a.status)))))))));\n  }"
EMPTY_TAIL_OLD = "h('p',{className:'wag-hint'},'Clique em um horário livre na semana para criar, ou deixe a IA agendar pelo WhatsApp.'));"
EMPTY_TAIL_NEW = "h('p',{className:'wag-hint'},'Clique em um horário livre na semana para criar, ou deixe a IA agendar pelo WhatsApp.')));"


def g_list(s):
    s = rep(s, LIST_OLD, LIST_NEW, 'List start')
    s = rep(s, EMPTY_TAIL_OLD, EMPTY_TAIL_NEW, 'List empty tail')
    s = rep(s, LIST_RET_OLD, LIST_RET_NEW, 'List return')
    return rep(s, LIST_END_OLD, LIST_END_NEW, 'List end')


# --------------------------------------------------------------------------------------------- 3. cancel
CANCEL = [
    ('cancel state',
     "const[status,setStatus]=y.useState(appt.status),",
     "const[reason,setReason]=y.useState(''),[status,setStatus]=y.useState(appt.status),"),
    ('cancel request',
     "const cancel=async()=>{setBusy('cancel');setErr('');try{await Ee.delete('/agenda/'+enc(name)+'/'+enc(appt.id),{params:{notifyClient:notify?'true':'false'}});",
     "const cancel=async()=>{setBusy('cancel');setErr('');try{await Ee.delete('/agenda/'+enc(name)+'/'+enc(appt.id),{params:{notifyClient:notify?'true':'false',reason:reason.trim()||void 0}});"),
    ('cancel reason field',
     "h('p',null,'Cancelar este agendamento?'+(notify?' O cliente recebe o aviso pelo WhatsApp.':'')),",
     "h('p',null,'Cancelar este agendamento?'+(notify?' O cliente recebe o aviso pelo WhatsApp.':'')),"
     "h('input',{className:'wag-input','aria-label':'Motivo do cancelamento (opcional)',placeholder:'Motivo (opcional, só a equipe vê)',maxLength:300,value:reason,onChange:e=>setReason(e.target.value)}),"),
]


def g_cancel(s):
    for label, old, new in CANCEL:
        s = rep(s, old, new, label)
    return s


GROUPS = [('types', g_types), ('list', g_list), ('cancel', g_cancel)]


def bump_css(html):
    return re.sub(r'(/assets/agenda\.css\?v=)(\d+)',
                  lambda m: m.group(1) + (AGENDA_CSS_VERSION if int(m.group(2)) < int(AGENDA_CSS_VERSION) else m.group(2)),
                  html)


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
    if bump_index(bump_css(html)) != html:
        missing.append('index.html versions')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    for req in REQUIRED:
        if req not in s:
            raise PatchError(f'run the patch that adds {req} first')
    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = html
    if 'html' in missing:
        new_html = rep(new_html, '</head>', '    ' + html_marker('html') + '\n  </head>', 'index.html </head>')
    new_html = bump_index(bump_css(new_html))
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: agenda.css?v={AGENDA_CSS_VERSION}, bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
