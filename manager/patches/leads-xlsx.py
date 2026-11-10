#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Leads" exports a formatted Excel workbook instead of a bare CSV.

1. export - the "Exportar CSV" button of the Leads page becomes "Exportar planilha" and downloads
   GET /leads/:instance/export.xlsx (same filters and order as the screen): sheet "Leads" with coloured priority
   and waiting time, wrapped texts, real dates, filters, frozen header and name, phone that opens WhatsApp, and
   sheet "Resumo" (what needs attention, counts, similar cases, data quality). The CSV route stays in the API.
2. html   - raises the bundle ?v= to CACHE_VERSION.

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
CACHE_VERSION = '33'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='


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


GROUPS = [('export', patch_export)]


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
    if bump_index(html) != html:
        missing.append('index.html cache version')
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
    new_html = bump_index(html)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        report.append(f'index.html: bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'error: {error}', file=sys.stderr)
        sys.exit(1)
