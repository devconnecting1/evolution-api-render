#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: accessibility fixes from the review of the Artefato (12/11/2026),
proposal Q. Seven small, local changes; no behavior changes beyond the keyboard access to the weekly agenda slots.

1. instances - the "+" button (.wa-ut-new) that opens "Nova instância" gets "aria-label": on phones its text is
                hidden, so it had no name for screen readers (critical). The "Mais" toolbar menu gets the same
                treatment (its label is also hidden on phones).
2. help menu - inside #wa-help-menu (role=menu) the news list used ul/li, and role=menu/group may only own
                menuitems: the ul and the li become role="none" and the "Novidades" label becomes presentational,
                so the three links are direct owned menuitems of the group. Mouse and keyboard behavior unchanged.
3. search    - the "Buscar Ctrl K" button (wa-tw-cmdbtn) had an aria-label that did not contain the visible
                "Ctrl K"; the label now reads "Buscar, Ctrl K" (⌘ on Mac), matching the visible text. panel-a11y.js
                still hides the shortcut in the rendered page, so the final name stays short either way.
4. headings  - the open conversation title (chat-ui.py) becomes the page h1 on phones (the list h1 is hidden
                there, leaving the page without an h1); the bot list of Atendente IA changes h4 to h2 (it jumped
                from h1 to h4).
5. agenda    - the appointment name read aloud is built with separators (time, contact, type, status) and the
                markup puts real spaces between the visible pieces, so the label contains the visible text in
                order; each week column also becomes keyboard reachable (Tab, Enter/Space opens a new appointment
                at 09:00, clamped to the working hours), instead of being click-only.

The contrast of "Desconectar" in Conexão (wa-portal-btn-danger, light theme) and of the appointment type on
"realizado"/"faltou" cards moves to manager/dist/assets/qa-a11y.css, whose link is inserted right before the
design-system.css marker (after qa-polish.css) and whose stylesheet is committed with the patch.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after qa-polish.py, help-menu.py, chat-ui.py,
twenty-layout.py, agenda.py and a11y-404.py (their markers are required).

Usage (from the repository root):
  python3 -I manager/patches/qa-a11y.py           # apply
  python3 -I manager/patches/qa-a11y.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'qa-a11y.css')
CACHE_VERSION = '73'
SCRIPT_TAG = '<script type="module" crossorigin src="/assets/index-b29a5d7a.js?v='
CSS_TAG = '<link rel="stylesheet" href="/assets/qa-a11y.css?v=1" />'
CSS_MARKER = '<!-- whatsai-patch:qa-a11y:css -->'
DESIGN_MARKER = '<!-- whatsai-patch:design-system:html -->'
REQUIRED = ('/*whatsai-patch:help-menu:component*/',
            '/*whatsai-patch:chat-ui:',
            '/*whatsai-patch:twenty-layout:component*/',
            '/*whatsai-patch:agenda:component*/')


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:qa-a11y:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


def g_instances(s):
    s = rep(s,
            'className:"wa-ut-tbtn wa-ut-tbtn--line wa-ut-new",children:[',
            'className:"wa-ut-tbtn wa-ut-tbtn--line wa-ut-new","aria-label":"Nova instância",children:[',
            'instances "+" button')
    return rep(s,
               "i.jsxs('button',{type:'button',className:'wa-ut-tbtn wa-ut-tbtn--line',children:[svg('more',14),i.jsx('span',{children:'Mais'})]})",
               "i.jsxs('button',{type:'button',className:'wa-ut-tbtn wa-ut-tbtn--line','aria-label':'Mais',children:[svg('more',14),i.jsx('span',{children:'Mais'})]})",
               'instances "Mais" menu')


def g_help(s):
    s = rep(s,
            "i.jsx('p',{id:'wa-help-news-label',className:'wa-help-label',children:'Novidades'})",
            "i.jsx('p',{id:'wa-help-news-label',role:'presentation',className:'wa-help-label',children:'Novidades'})",
            'help menu news label')
    return rep(s,
               "i.jsx('ul',{children:NEWS.map(n=>i.jsx('li',{children:i.jsxs('a',{role:'menuitem'",
               "i.jsx('ul',{role:'none',children:NEWS.map(n=>i.jsx('li',{role:'none',children:i.jsxs('a',{role:'menuitem'",
               'help menu news list')


def g_search(s):
    return rep(s,
               "'aria-label':'Buscar conversas, ações e páginas','aria-keyshortcuts'",
               "'aria-label':'Buscar, '+(MAC?'⌘':'Ctrl')+' K','aria-keyshortcuts'",
               'search button label')


def g_headings(s):
    s = rep(s,
            'i.jsx("h2",{className:"wa-conv-title",children:waCTitle(waConv)})',
            'i.jsx("h1",{className:"wa-conv-title",children:waCTitle(waConv)})',
            'conversation title h1')
    return rep(s,
               'i.jsx("h4",{className:"text-base",children:h.description||h.id}),i.jsx("p",{className:"text-sm font-normal text-muted-foreground",children:h.botType==="assistant"',
               'i.jsx("h2",{className:"text-base",children:h.description||h.id}),i.jsx("p",{className:"text-sm font-normal text-muted-foreground",children:h.botType==="assistant"',
               'Atendente IA bot heading h2')


def g_agenda(s):
    s = rep(s,
            "'aria-label':a.label+', '+(a.contactName||digits(a.remoteJid))+', '+SL[a.status]",
            "'aria-label':[hm(p.min),a.contactName||('+'+digits(a.remoteJid)),a.typeName,SL[a.status]].filter(Boolean).join(', ')",
            'weekly appointment label')
    s = rep(s,
            "h('span',{className:'wag-appt-line'},h('span',{className:'wag-appt-time'},hm(p.min)),h('span',{className:'wag-appt-name'},a.contactName||'+'+digits(a.remoteJid))),hgt>44?h('span',{className:'wag-appt-type'},a.typeName):null",
            "h('span',{className:'wag-appt-line'},h('span',{className:'wag-appt-time'},hm(p.min)),' ',h('span',{className:'wag-appt-name'},a.contactName||'+'+digits(a.remoteJid))),hgt>44?h('span',{className:'wag-appt-type'},' ',a.typeName):null",
            'weekly appointment visible spaces')
    return rep(s,
               "return h('div',{key:d,className:'wag-col',role:'group','data-today':d===today?'true':void 0,onClick:click,'aria-label':dayLabel(d)},",
               "return h('div',{key:d,className:'wag-col',role:'group','data-today':d===today?'true':void 0,tabIndex:0,onKeyDown:e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSlot(d,Math.max(lo,Math.min(hi-step,9*60)))}},onClick:click,'aria-label':dayLabel(d)},",
               'weekly column keyboard')


GROUPS = [('instances', g_instances), ('help', g_help), ('search', g_search),
          ('headings', g_headings), ('agenda', g_agenda)]


def patch_index(html):
    if CSS_TAG in html and CSS_MARKER in html:
        return html
    if (CSS_TAG in html) != (CSS_MARKER in html):
        raise PatchError('index.html: qa-a11y.css linked without its marker')
    if html.count('    ' + DESIGN_MARKER) != 1:
        raise PatchError('index.html: design-system marker expected once (run design-system.py first)')
    block = '    ' + CSS_MARKER + '\n    ' + CSS_TAG + '\n'
    return html.replace('    ' + DESIGN_MARKER, block + '    ' + DESIGN_MARKER, 1)


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
    if patch_index(html) != html:
        missing.append('index.html')
    if bump_index(html) != html:
        missing.append('index.html cache version')
    if not os.path.exists(CSS):
        missing.append('qa-a11y.css')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    for required in REQUIRED:
        if required not in s:
            raise PatchError(f'run the patch that adds {required} first: missing {required}')
    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/qa-a11y.css is missing')
    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = bump_index(patch_index(html))
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    pos = new_html.find(SCRIPT_TAG) + len(SCRIPT_TAG)
    end = pos
    while end < len(new_html) and new_html[end].isdigit():
        end += 1
    report.append(f'index.html: qa-a11y.css ?v=1, bundle ?v={new_html[pos:end]}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
