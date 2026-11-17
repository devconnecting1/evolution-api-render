#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Exportar conversas para revisão" in Plano e limites > Exportar dados.

API (same release): GET /export/review/:instanceName?from=AAAA-MM-DD&to=AAAA-MM-DD&format=md|jsonl returns a ZIP with
one Markdown file per conversation and one JSONL (numbers masked to the last 4 digits, e-mails/CPF/long numbers
redacted), at most 31 days. Admin only: the server refuses client access codes and team keys that are not "dono".

Groups:
  1. card - a second card in the "Exportar dados" tab: two dates (last 7 days by default), the format and a download
            button. Hidden for client access codes (the tab already is) and for the "equipe"/"leitura" team roles.
  2. html - links exportar-revisao.css and raises the bundle ?v= one above the current value (at least 84).

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: the markers in the bundle and in index.html make it a no-op. Order: after cobranca-exportacao.py
and origem-mensagens.py.

Usage (from the repository root):
  python3 -I manager/patches/exportar-revisao.py           # apply
  python3 -I manager/patches/exportar-revisao.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
ASSETS = os.path.join(ROOT, 'manager', 'dist', 'assets')
CSS_VERSION = '1'
# 83 is the bundle version left by origem-mensagens.py; this patch always goes one above the current value.
MIN_CACHE_VERSION = 83
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
MODULE_ANCHOR = '    <script type="module" crossorigin src="/assets/index-b29a5d7a.js'
HTML_MARKER = '<!-- whatsai-patch:exportar-revisao:html -->'
CSS_TAG = '<link rel="stylesheet" href="/assets/exportar-revisao.css?v=' + CSS_VERSION + '" />'

FN_ANCHOR = '  function ExportData({instance}){\n'
FN_NEW = r"""  function WcReviewExport({instance}){
    const day=d=>{const z=new Date(d.getTime()-d.getTimezoneOffset()*6e4);return z.toISOString().slice(0,10)};
    const[from,setFrom]=y.useState(()=>day(new Date(Date.now()-6*864e5))),[to,setTo]=y.useState(()=>day(new Date()));
    const[fmt,setFmt]=y.useState('md'),[busy,setBusy]=y.useState(!1),[error,setError]=y.useState(''),[done,setDone]=y.useState('');
    const role=typeof document!=='undefined'?document.documentElement.getAttribute('data-wa-team-role'):null;
    if((window.WaPortal&&window.WaPortal.client)||role==='equipe'||role==='leitura')return null;
    const days=from&&to?Math.round((Date.parse(to)-Date.parse(from))/864e5)+1:0;
    const invalid=!from||!to?'Escolha as duas datas.':days<1?'A data inicial precisa ser igual ou anterior à final.':days>31?'O período vai até 31 dias. Exporte em partes.':'';
    const download=async()=>{
      if(invalid||busy)return;
      setBusy(!0);setError('');setDone('');
      try{
        const r=await Ee.get('/export/review/'+encodeURIComponent(instance?.name),{params:{from,to,format:fmt},responseType:'blob'});
        const found=/filename="([^"]+)"/.exec(String(r.headers?.['content-disposition']||''));
        const file=found?found[1]:'revisao-'+instance?.name+'-'+from+'_a_'+to+'.zip';
        const url=URL.createObjectURL(r.data);
        const link=document.createElement('a');
        link.href=url;link.download=file;document.body.appendChild(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),30000);
        setDone('Download iniciado: '+file+'.');
      }catch(e){
        let err=e;const b=e?.response?.data;
        if(b&&typeof b.text==='function'){try{err={response:{status:e.response.status,data:JSON.parse(await b.text())}}}catch(x){}}
        setError(errText(err));
      }finally{setBusy(!1)}
    };
    return i.jsxs('section',{className:'wu-card wc-review','aria-labelledby':'wc-review-title',children:[
      i.jsx('h2',{id:'wc-review-title',className:'wu-card-title',children:'Exportar conversas para revisão'}),
      i.jsx('p',{className:'wu-muted',children:'Baixe as conversas de um período, uma por arquivo, mostrando quem escreveu cada mensagem: cliente, IA ou equipe. Serve para revisar as respostas da IA ou para mandar ao Claude analisar.'}),
      i.jsxs('div',{className:'wc-review-fields',children:[
        i.jsxs('label',{className:'wc-review-field',children:[i.jsx('span',{children:'De'}),i.jsx('input',{type:'date',className:'wu-input',value:from,max:to||void 0,onChange:e=>setFrom(e.target.value)})]}),
        i.jsxs('label',{className:'wc-review-field',children:[i.jsx('span',{children:'Até'}),i.jsx('input',{type:'date',className:'wu-input',value:to,min:from||void 0,onChange:e=>setTo(e.target.value)})]}),
        i.jsxs('label',{className:'wc-review-field',children:[i.jsx('span',{children:'Formato'}),i.jsxs('select',{className:'wu-input',value:fmt,onChange:e=>setFmt(e.target.value),children:[
          i.jsx('option',{value:'md',children:'Texto (Markdown) e JSONL'}),
          i.jsx('option',{value:'jsonl',children:'Só JSONL'})]})]})]}),
      invalid?i.jsx('p',{className:'wu-hint',role:'alert',children:invalid}):i.jsx('p',{className:'wu-hint',children:days===1?'1 dia selecionado. Até 31 dias por arquivo.':days+' dias selecionados. Até 31 dias por arquivo.'}),
      i.jsx('div',{className:'wu-actions',children:i.jsx('button',{type:'button',className:'wu-btn wu-btn-primary',disabled:!!invalid||busy,onClick:download,'aria-busy':busy?'true':void 0,children:busy?'Gerando o arquivo…':'Baixar ZIP'})}),
      done?i.jsx('p',{className:'wc-done',role:'status',children:done}):null,
      error?i.jsxs('div',{className:'wu-callout','data-tone':'bad',role:'alert',children:[i.jsx('p',{children:error}),i.jsx('button',{type:'button',className:'wu-btn',onClick:download,children:'Tentar de novo'})]}):null,
      i.jsxs('div',{className:'wc-note',children:[
        i.jsx('strong',{children:'Dados protegidos'}),
        i.jsx('p',{children:'Os números aparecem só com os 4 últimos dígitos e os nomes não são exportados. E-mails, CPF e sequências longas de números são ocultados. Ainda assim o arquivo tem conversas de clientes: guarde com cuidado e apague quando terminar a revisão.'})]})]});
  }

"""

CARD_OLD = "a exportação atende ao direito de portabilidade da LGPD.'})]})]})]});"
CARD_NEW = "a exportação atende ao direito de portabilidade da LGPD.'})]})]}),i.jsx(WcReviewExport,{instance})]});"


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:exportar-revisao:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


def g_card(s):
    s = rep(s, FN_ANCHOR, FN_NEW + FN_ANCHOR, 'component')
    return rep(s, CARD_OLD, CARD_NEW, 'card')


GROUPS = [('card', g_card)]


def current_bundle_version(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag expected once')
    start = pos + len(SCRIPT_TAG)
    end = start
    while end < len(html) and html[end].isdigit():
        end += 1
    current = html[start:end]
    if not current:
        raise PatchError('index.html: bundle ?v= not found')
    return int(current)


def patch_index(html):
    if HTML_MARKER in html:
        return html
    if '/assets/exportar-revisao.css' in html:
        raise PatchError('index.html: exportar-revisao.css present without the marker; remove it first')
    if html.count(MODULE_ANCHOR) != 1:
        raise PatchError('index.html: module script line expected once')
    version = max(current_bundle_version(html), MIN_CACHE_VERSION) + 1
    pos = html.find(SCRIPT_TAG) + len(SCRIPT_TAG)
    end = pos
    while end < len(html) and html[end].isdigit():
        end += 1
    html = html[:pos] + str(version) + html[end:]
    tags = '    ' + CSS_TAG + '\n    ' + HTML_MARKER + '\n'
    return html.replace(MODULE_ANCHOR, tags + MODULE_ANCHOR, 1)


def main():
    check = '--check' in sys.argv[1:]
    if not os.path.isfile(os.path.join(ASSETS, 'exportar-revisao.css')):
        raise PatchError('assets/exportar-revisao.css is missing')
    bundle = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    missing = [name for name, _ in GROUPS if marker(name) not in bundle]
    if HTML_MARKER not in html:
        missing.append('index.html')
    if check:
        print('ok: exportar-revisao applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    report = []
    new_bundle = bundle
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        new_bundle = marker(name) + fn(new_bundle)
        report.append(f'{name}: applied')
    new_html = patch_index(html)
    if new_bundle != bundle:
        open(BUNDLE, 'w', encoding='utf-8').write(new_bundle)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: bundle ?v={current_bundle_version(new_html)}, exportar-revisao.css ?v={CSS_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
