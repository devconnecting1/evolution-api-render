#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: phones, lists as stacked rows (proposal K).

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/celular-listas.css (a plain file, edited by hand, only var(--m-*) tokens
of minimal.css, linked last).

What it does:
  leads - the three secondary buttons of the Leads header stay in .wl-head-btns on the desktop; below 640 px the
          group hides and a "..." popover (Mais ações) offers the same actions. The "more" icon is added to the
          WaLeads icon map.
  proc  - the CSV button of Processos stays labeled on the desktop; below 640 px it moves to a "..." menu
          (MoreActions, in the view bar).
  html  - links celular-listas.css?v=1 after the last stylesheet and raises the bundle ?v= to CACHE_VERSION.
The stacked rows themselves are pure CSS: Leads, Processos, Instâncias, the instance panel tabs and a generic
fallback for the upstream integration lists. The tabs scroll sideways.

Every anchor must match exactly once, otherwise the script stops without writing anything. Re-running is safe:
groups whose marker is present are skipped. Order: run after every other script (it needs leads.py, leads-xlsx.py,
acabamento-listas.py and processos.py applied).

Usage (from the repository root):
  python3 -I manager/patches/celular-listas.py           # apply
  python3 -I manager/patches/celular-listas.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'celular-listas.css')
REQUIRED = ('/*whatsai-patch:leads-xlsx:export*/', '/*whatsai-patch:acabamento-listas:icons*/',
            '/*whatsai-patch:processos:component*/')
CACHE_VERSION = '65'
CSS_VERSION = '1'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_ANCHOR = '    <link rel="stylesheet" href="/assets/page-frame.css?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:celular-listas:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:celular-listas:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# Minified names (bundle index-b29a5d7a.js): i = jsx runtime, y = React, svg = local icon helper of WaLeads/WaProc,
# Pop = the filter/sort popover of WaLeads, IC = icon map of WaProc.

# -------------------------------------------------------------------------------------------------- Leads header
LEADS_IC_OLD = ("dot:['M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z']};\n  function svg(name,size){")
LEADS_IC_NEW = ("dot:['M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z'],more:['M5 12h.01','M12 12h.01','M19 12h.01']};\n"
                "  function svg(name,size){")

LEADS_HEAD_OLD = r"""i.jsxs('div',{className:'wl-head-actions',children:[bf&&bf.running?i.jsx('span',{className:'wl-progress',role:'status',children:'Analisando '+nf.format(bf.done)+' de '+nf.format(bf.total)+'…'}):null,
          i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:estimate,disabled:busy||!!(bf&&bf.running),children:[svg('spark',14),'Analisar conversas anteriores']}),
          i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:()=>setSheet(!0),disabled:!counts.todos,title:'Ver a planilha aqui, antes de baixar',children:[svg('grid',14),'Ver planilha']}),i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:exportCsv,disabled:!counts.todos,title:'Planilha do Excel com as mesmas visões e filtros da tela',children:[svg('down',14),'Exportar planilha']}),sheet?i.jsx(SheetViewer,{name,query:(()=>{const o={...query};delete o.page;delete o.pageSize;return o})(),onClose:()=>setSheet(!1)}):null,
          i.jsx('button',{type:'button',className:'wa-tw-ibtn','aria-label':'Configurações de leads',title:'Configurações de leads',onClick:()=>setShowSet(!0),children:svg('cog',16)})]})]})"""

LEADS_HEAD_NEW = r"""i.jsxs('div',{className:'wl-head-actions',children:[bf&&bf.running?i.jsx('span',{className:'wl-progress',role:'status',children:'Analisando '+nf.format(bf.done)+' de '+nf.format(bf.total)+'…'}):null,
          i.jsxs('div',{className:'wl-head-btns',children:[
          i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:estimate,disabled:busy||!!(bf&&bf.running),children:[svg('spark',14),'Analisar conversas anteriores']}),
          i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:()=>setSheet(!0),disabled:!counts.todos,title:'Ver a planilha aqui, antes de baixar',children:[svg('grid',14),'Ver planilha']}),i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:exportCsv,disabled:!counts.todos,title:'Planilha do Excel com as mesmas visões e filtros da tela',children:[svg('down',14),'Exportar planilha']}),
          i.jsx('button',{type:'button',className:'wa-tw-ibtn','aria-label':'Configurações de leads',title:'Configurações de leads',onClick:()=>setShowSet(!0),children:svg('cog',16)})]}),sheet?i.jsx(SheetViewer,{name,query:(()=>{const o={...query};delete o.page;delete o.pageSize;return o})(),onClose:()=>setSheet(!1)}):null,
          i.jsx(Pop,{id:'wl-more',label:'Mais ações',icon:'more',align:'end',children:close=>i.jsxs('div',{className:'wa-tw-pop-body',children:[
            i.jsx('button',{type:'button',className:'wl-more-item',disabled:busy||!!(bf&&bf.running),onClick:()=>{close();estimate()},children:'Analisar conversas anteriores'}),
            i.jsx('button',{type:'button',className:'wl-more-item',disabled:!counts.todos,onClick:()=>{close();setSheet(!0)},children:'Ver planilha'}),
            i.jsx('button',{type:'button',className:'wl-more-item',disabled:!counts.todos,onClick:()=>{close();exportCsv()},children:'Exportar planilha'}),
            i.jsx('button',{type:'button',className:'wl-more-item',onClick:()=>{close();setShowSet(!0)},children:'Configurações de leads'})]})})]})]})"""


def patch_leads(s):
    s = rep(s, LEADS_IC_OLD, LEADS_IC_NEW, 'WaLeads icon map (more)')
    return rep(s, LEADS_HEAD_OLD, LEADS_HEAD_NEW, 'WaLeads header actions')


# ----------------------------------------------------------------------------------------------- Processos CSV
PROC_CSV_OLD = ("i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:exportCsv,"
                "children:[svg(IC.dl,14),'CSV']}),")
PROC_CSV_NEW = ("i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost wp-csv-btn',"
                "onClick:exportCsv,children:[svg(IC.dl,14),'CSV']}),i.jsx(MoreActions,{onCsv:exportCsv}),")

PROC_PAGE_OLD = "  function Page(){\n    const{instance:g}=ct(),name=g?.name;const[tab,setTab]=y.useState('proc');"
PROC_PAGE_NEW = r"""  function MoreActions({onCsv}){
    const[open,setOpen]=y.useState(!1),ref=y.useRef(null),btn=y.useRef(null);
    y.useEffect(()=>{if(!open)return;
      const down=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(!1)};
      const key=e=>{if(e.key==='Escape'){e.preventDefault();setOpen(!1);btn.current&&btn.current.focus()}};
      document.addEventListener('mousedown',down);document.addEventListener('keydown',key,!0);
      return()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key,!0)}},[open]);
    return i.jsxs('div',{className:'cell-more',ref,children:[
      i.jsx('button',{ref:btn,type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost cell-more-btn','aria-label':'Mais ações',
        'aria-haspopup':'menu','aria-expanded':open?'true':'false',onClick:()=>setOpen(o=>!o),
        children:svg(['M5 12h.01','M12 12h.01','M19 12h.01'],16)}),
      open?i.jsx('div',{className:'cell-more-menu',role:'menu',children:
        i.jsx('button',{type:'button',role:'menuitem',className:'cell-more-item',onClick:()=>{setOpen(!1);onCsv()},children:'Exportar CSV'})}):null]});
  }

""" + PROC_PAGE_OLD


def patch_proc(s):
    s = rep(s, PROC_PAGE_OLD, PROC_PAGE_NEW, 'WaProc MoreActions component')
    return rep(s, PROC_CSV_OLD, PROC_CSV_NEW, 'WaProc CSV button')


GROUPS = [('leads', patch_leads), ('proc', patch_proc)]


def patch_html(html):
    if html_marker('html') in html:
        return html
    pos = html.find(CSS_ANCHOR)
    if pos < 0 or html.count(CSS_ANCHOR) != 1:
        raise PatchError('index.html: page-frame.css link not found exactly once')
    end = html.index('\n', pos) + 1
    link = f'    <link rel="stylesheet" href="/assets/celular-listas.css?v={CSS_VERSION}" />\n'
    return html[:end] + '    ' + html_marker('html') + '\n' + link + html[end:]


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


def main():
    check = '--check' in sys.argv[1:]
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()

    missing = [name for name, _ in GROUPS if marker(name) not in s]
    if html_marker('html') not in html:
        missing.append('html')
    if bump_index(html) != html:
        missing.append('index.html version')
    if not os.path.isfile(CSS):
        missing.append('celular-listas.css')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/celular-listas.css is missing')
    for required in REQUIRED:
        if required not in s:
            raise PatchError(f'run the patch that adds {required} first: missing {required}')

    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = bump_index(patch_html(html))

    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        report.append(f'index.html written (celular-listas.css ?v={CSS_VERSION}, bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
