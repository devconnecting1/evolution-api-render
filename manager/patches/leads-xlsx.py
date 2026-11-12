#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Leads" exports a formatted Excel workbook instead of a bare CSV.

1. export - the "Exportar CSV" button of the Leads page becomes "Exportar planilha" and downloads
   GET /leads/:instance/export.xlsx (same filters and order as the screen): sheet "Leads" with coloured priority
   and waiting time, wrapped texts, real dates, filters, frozen header and name, phone that opens WhatsApp, and
   sheet "Resumo" (what needs attention, counts, similar cases, data quality). The CSV route stays in the API.
2. viewer - "Ver planilha" opens the same workbook inside the panel (GET /leads/:instance/export.json): a grid with
   column letters and row numbers, the colours, merged cells and links of the file, the tabs Resumo and Leads at the
   bottom, first 300 rows of each, and "Baixar .xlsx". Styles in assets/leads.css (viewer block).
3. html   - raises the bundle ?v= to CACHE_VERSION and leads.css to CSS_VERSION (only up).

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after leads.py and panel-polish.py.

Usage (from the repository root):
  python3 -I manager/patches/leads-xlsx.py           # apply
  python3 -I manager/patches/leads-xlsx.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '34'
CSS_VERSION = '3'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_TAG = '/assets/leads.css?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:leads-xlsx:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


def patch_export(s):
    s = rep(s,
            "async function download(name,query){const r=await Ee.get('/leads/'+encodeURIComponent(name)+'/export.csv',"
            "{params:query,responseType:'blob'});",
            "async function download(name,query){const r=await Ee.get('/leads/'+encodeURIComponent(name)+'/export.xlsx',"
            "{params:query,responseType:'blob'});",
            'download url')
    s = rep(s,
            "new Blob([r.data],{type:'text/csv;charset=utf-8'})",
            "new Blob([r.data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})",
            'download blob type')
    s = rep(s,
            "+'-'+new Date().toISOString().slice(0,10)+'.csv';document.body.appendChild(a)",
            "+'-'+new Date().toISOString().slice(0,10)+'.xlsx';document.body.appendChild(a)",
            'download file name')
    s = rep(s,
            "me.success('CSV exportado (abre no Excel).')",
            "me.success('Planilha exportada: abas Resumo e Leads.')",
            'success toast')
    s = rep(s,
            "onClick:exportCsv,disabled:!counts.todos,children:[svg('down',14),'Exportar CSV']})",
            "onClick:exportCsv,disabled:!counts.todos,title:'Planilha do Excel com as mesmas visões e filtros da tela',"
            "children:[svg('down',14),'Exportar planilha']})",
            'button label')
    return s


VIEWER = r'''
  /* ---------------------------------------------------------------- planilha: visualizador (leads-xlsx.py) */
  function SheetViewer({name,query,onClose}){
    const[d,setD]=y.useState({sheets:null,error:''}),[tab,setTab]=y.useState(0),[dl,setDl]=y.useState(!1);
    y.useEffect(()=>{let off=!1;Ee.get('/leads/'+encodeURIComponent(name)+'/export.json',{params:query}).then(r=>{if(!off)setD({sheets:(r.data&&r.data.sheets)||[],error:''})}).catch(e=>{if(!off)setD({sheets:null,error:errText(e)})});return()=>{off=!0}},[name]);
    y.useEffect(()=>{const k=e=>{if(e.key==='Escape')onClose()};document.addEventListener('keydown',k);const o=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.removeEventListener('keydown',k);document.body.style.overflow=o}},[]);
    const sheets=d.sheets||[],sh=sheets[tab],shown=sh?(sh.header?sh.rows.length-1:sh.rows.length):0;
    const get=async()=>{setDl(!0);try{await download(name,query);me.success('Planilha baixada.')}catch(e){me.error(errText(e))}finally{setDl(!1)}};
    return i.jsx('div',{className:'wl-sv-veil',onMouseDown:e=>{if(e.target===e.currentTarget)onClose()},children:i.jsxs('div',{className:'wl-sv',role:'dialog','aria-modal':'true','aria-label':'Planilha de leads',children:[
      i.jsxs('div',{className:'wl-sv-head',children:[
        i.jsxs('div',{className:'wl-sv-titles',children:[i.jsx('strong',{children:'Planilha de leads'}),i.jsx('span',{className:'wl-muted',children:'Prévia do arquivo do Excel com as visões e filtros da tela. É o mesmo arquivo do botão Baixar.'})]}),
        i.jsxs('div',{className:'wl-sv-actions',children:[
          i.jsxs('button',{type:'button',className:'wa-tw-sbtn',onClick:get,disabled:dl||!sheets.length,children:[svg('down',14),dl?'Baixando…':'Baixar .xlsx']}),
          i.jsx('button',{type:'button',className:'wa-tw-ibtn','aria-label':'Fechar',title:'Fechar (Esc)',onClick:onClose,children:svg('x',16)})]})]}),
      d.error?i.jsx('p',{className:'wl-sv-msg',role:'alert',children:d.error}):!d.sheets?i.jsx('p',{className:'wl-sv-msg',role:'status',children:'Montando a planilha…'}):!sh?i.jsx('p',{className:'wl-sv-msg',children:'Nada para mostrar.'}):
      i.jsx('div',{className:'wl-sv-scroll',tabIndex:0,children:i.jsxs('table',{className:'wl-sv-grid'+(sh.header?' has-head':''),style:{width:(44+sh.columns.reduce((t,c)=>t+Math.round(c.width*7.2+8),0))+'px'},children:[
        i.jsx('colgroup',{children:[i.jsx('col',{style:{width:'44px'}},'rn'),...sh.columns.map((c,j)=>i.jsx('col',{style:{width:Math.round(c.width*7.2+8)+'px'}},j))]}),
        i.jsxs('tbody',{children:[
          i.jsxs('tr',{className:'wl-sv-letters',children:[i.jsx('th',{className:'wl-sv-corner','aria-hidden':'true'}),...sh.columns.map((c,j)=>i.jsx('th',{scope:'col',children:c.letter},j))]}),
          ...sh.rows.map((row,r)=>i.jsxs('tr',{className:sh.header&&r===0?'wl-sv-hrow':void 0,children:[i.jsx('th',{scope:'row',className:'wl-sv-rn',children:r+1}),
            ...row.map((c,j)=>c.skip?null:i.jsx('td',{colSpan:c.span||void 0,className:'wl-sv-c'+(c.cls?' '+c.cls.split(' ').map(x=>'x-'+x).join(' '):''),children:c.link?i.jsx('a',{href:c.link,target:'_blank',rel:'noopener noreferrer',children:c.text}):c.text},j))]},r))]})]})}),
      i.jsxs('div',{className:'wl-sv-foot',children:[
        i.jsx('div',{className:'wl-sv-tabs',role:'tablist','aria-label':'Abas da planilha',children:sheets.map((x,k)=>i.jsx('button',{type:'button',role:'tab','aria-selected':tab===k?'true':'false',className:'wl-sv-tab',onClick:()=>setTab(k),children:x.name},k))}),
        sh&&sh.totalRows>shown?i.jsx('span',{className:'wl-muted',children:'Mostrando '+nf.format(shown)+' de '+nf.format(sh.totalRows)+' linhas. Baixe o arquivo para ver todas.'}):sh?i.jsx('span',{className:'wl-muted',children:nf.format(sh.totalRows)+' linha(s)'}):null]})]})});
  }
'''


def patch_viewer(s):
    s = rep(s,
            "\n  /* ---------------------------------------------------------------- page */\n  function Page(){",
            VIEWER + "\n  /* ---------------------------------------------------------------- page */\n  function Page(){",
            'viewer component')
    s = rep(s,
            "down:['M12 3v12','m7 10 5 5 5-5','M5 21h14'],spark:['M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2Z'],",
            "down:['M12 3v12','m7 10 5 5 5-5','M5 21h14'],spark:['M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2Z'],"
            "grid:['M3 3h18v18H3Z','M3 9h18','M3 15h18','M9 3v18'],",
            'grid icon')
    s = rep(s,
            "[days,setDays]=y.useState(30),[busy,setBusy]=y.useState(!1);",
            "[days,setDays]=y.useState(30),[busy,setBusy]=y.useState(!1),[sheet,setSheet]=y.useState(!1);",
            'viewer state')
    s = rep(s,
            "i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:exportCsv,disabled:!counts.todos,"
            "title:'Planilha do Excel com as mesmas visões e filtros da tela',children:[svg('down',14),'Exportar planilha']}),",
            "i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:()=>setSheet(!0),disabled:!counts.todos,"
            "title:'Ver a planilha aqui, antes de baixar',children:[svg('grid',14),'Ver planilha']}),"
            "i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',onClick:exportCsv,disabled:!counts.todos,"
            "title:'Planilha do Excel com as mesmas visões e filtros da tela',children:[svg('down',14),'Exportar planilha']}),"
            "sheet?i.jsx(SheetViewer,{name,query:(()=>{const o={...query};delete o.page;delete o.pageSize;return o})(),onClose:()=>setSheet(!1)}):null,",
            'viewer button')
    return s


GROUPS = [('export', patch_export), ('viewer', patch_viewer)]


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


def bump_css(html):
    pos = html.find(CSS_TAG)
    if pos < 0 or html.count(CSS_TAG) != 1:
        raise PatchError('index.html: leads.css link expected once')
    start = pos + len(CSS_TAG)
    end = start
    while end < len(html) and html[end].isdigit():
        end += 1
    current = html[start:end]
    if current and int(current) >= int(CSS_VERSION):
        return html
    return html[:start] + CSS_VERSION + html[end:]


def main():
    check = '--check' in sys.argv[1:]
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    missing = [name for name, _ in GROUPS if marker(name) not in s]
    if bump_index(html) != html:
        missing.append('index.html cache version')
    if bump_css(html) != html:
        missing.append('leads.css version')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    report = []
    for name, fn in GROUPS:
        if marker(name) in s:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    new_html = bump_css(bump_index(html))
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        report.append(f'index.html: bundle ?v={CACHE_VERSION}, leads.css ?v={CSS_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'error: {error}', file=sys.stderr)
        sys.exit(1)
