#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Prévia dos avisos" in Processos > Configurações.

Shows, without sending anything, the exact WhatsApp texts the client and the team would receive for a fictitious
process (POST /processos/{instancia}/preview, the same functions the real notices use). It follows the unsaved values
of the form (client message, quiet hours, team numbers), so the office sees the result before saving or switching
anything on. A sample client name can be typed.

Groups:
1. component - function WpNoticePreview before SettingsTab.
2. place     - the preview right after the hint of "Mensagem para o cliente".
3. tools     - the hint of "Raciocínio da IA" (openai-reasoning.py) also covers gpt-6.1-terra, gpt-5.6, gpt-5.5 and
               gpt-5.4, which only accept tools with "none" in Chat Completions (measured in the API on 18/11/2026).
4. css       - styles appended to processos.css (link raised to ?v=2).
5. html      - raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after processos.py and openai-reasoning.py.

Usage (from the repository root):
  python3 -I manager/patches/processos-previa.py           # apply
  python3 -I manager/patches/processos-previa.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'processos.css')
CACHE_VERSION = '86'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_OLD = '/assets/processos.css?v=1"'
CSS_NEW = '/assets/processos.css?v=2"'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:processos-previa:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


# ------------------------------------------------------------------------------------------------ 1. component
COMPONENT = r'''function WpNoticePreview({name,s}){
    const[who,setWho]=y.useState('Maria Silva'),[p,setP]=y.useState(null),[err,setErr]=y.useState('');
    const q=s.quietHours||{},nums=String(s.numbers||'').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);
    const key=JSON.stringify([s.clientMessageTemplate||'',q,nums,who]);
    y.useEffect(()=>{let live=!0;const t=setTimeout(()=>{Ee.post('/processos/'+enc(name)+'/preview',{clientMessageTemplate:s.clientMessageTemplate||null,quietHours:q,notifyNumbers:nums,clientName:who}).then(r=>{if(live){setP(r.data.preview);setErr('')}}).catch(x=>{if(live)setErr(errText(x))})},400);return()=>{live=!1;clearTimeout(t)}},[name,key]);
    const bubble=(label,text)=>i.jsxs('figure',{className:'wp-pv-item',children:[i.jsx('figcaption',{className:'wp-pv-who',children:label}),i.jsx('p',{className:'wp-pv-bubble',children:text})]});
    const to=p?p.team.numbers.length?'Vai para: '+p.team.numbers.join(', ')+(p.team.numbersFrom==='leads'?' (números de Leads)':''):'Sem números da equipe: ninguém recebe este aviso.':'';
    return i.jsxs('section',{className:'wp-pv','aria-labelledby':'wp-pv-h',children:[
      i.jsx('h3',{id:'wp-pv-h',className:'wp-label',children:'Prévia dos avisos'}),
      i.jsx('p',{className:'wa-tw-hint',children:'Nada é enviado. É um processo fictício, com as configurações acima (mesmo sem salvar).'}),
      i.jsx('label',{className:'wp-label',htmlFor:'wp-pv-n',children:'Nome do cliente no exemplo'}),
      i.jsx('input',{id:'wp-pv-n',className:'wp-input',maxLength:80,value:who,onChange:e=>setWho(e.target.value)}),
      err?i.jsx('p',{className:'wp-callout','data-tone':'bad',role:'alert',children:err}):null,
      !p&&!err?i.jsx('div',{className:'wp-skeleton','aria-busy':'true'}):null,
      p?i.jsxs('div',{className:'wp-pv-grid','aria-live':'polite',children:[
        i.jsxs('div',{children:[bubble('O cliente recebe',p.client.text),i.jsx('ul',{className:'wp-pv-rules',children:p.client.rules.map((r,k)=>i.jsx('li',{children:r},k))})]}),
        i.jsxs('div',{children:[bubble('A equipe recebe (nova movimentação)',p.team.movement),bubble('A equipe recebe (intimação no DJEN)',p.team.publication),i.jsx('p',{className:'wa-tw-hint',children:to})]})]}):null,
      p?i.jsx('p',{className:'wp-callout','data-tone':p.quiet.now?'warn':'ok',children:p.quiet.label}):null]});
  }

  '''


def g_component(s):
    return rep(s, 'function SettingsTab({name}){', COMPONENT + 'function SettingsTab({name}){', 'before SettingsTab')


# ------------------------------------------------------------------------------------------------ 2. place
HINT = ("i.jsx('p',{id:'wp-s-t-hint',className:'wa-tw-hint',children:'Só aceita o campo {nome}. O cliente nunca "
        "recebe o conteúdo da movimentação, prazos ou decisões.'}),")


def g_place(s):
    return rep(s, HINT, HINT + 'i.jsx(WpNoticePreview,{name,s}),', 'after the client message hint')


# ------------------------------------------------------------------------------------------------ 3. tools
TOOLS = [
    ('else if(/^gpt-6\\.1-terra\\b/.test(id))lv=ALL;', 'else if(/^gpt-6\\.1-terra\\b/.test(id)){lv=ALL;tools=!0}'),
    ('else if(/^gpt-5\\.6-/.test(id))lv=ALL;', 'else if(/^gpt-5\\.6-/.test(id)){lv=ALL;tools=!0}'),
    ('else if(/^gpt-5\\.5\\b/.test(id))lv=["none","low","medium","high","xhigh"];',
     'else if(/^gpt-5\\.5\\b/.test(id)){lv=["none","low","medium","high","xhigh"];tools=!0}'),
    ('else if(/^gpt-5\\.4\\b/.test(id)){lv=["none","low","medium","high","xhigh"];def="none"}',
     'else if(/^gpt-5\\.4\\b/.test(id)){lv=["none","low","medium","high","xhigh"];def="none";tools=!0}'),
]


def g_tools(s):
    for old, new in TOOLS:
        s = rep(s, old, new, 'reasoning helper: ' + old[:40])
    return s


GROUPS = [('component', g_component), ('place', g_place), ('tools', g_tools)]

# ------------------------------------------------------------------------------------------------ 4. css
CSS_MARKER = '/*whatsai-patch:processos-previa:css*/'
CSS_BLOCK = CSS_MARKER + '''
.wp-pv { display: grid; gap: 8px; margin-top: 8px; padding: 12px; border: 1px solid var(--m-border); border-radius: var(--m-radius-card); background: var(--m-bg); }
.wp-pv h3 { margin: 0; }
.wp-pv-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.wp-pv-item { margin: 0 0 8px; }
.wp-pv-who { font-size: 12px; color: var(--m-tint-text); margin-bottom: 4px; }
.wp-pv-bubble { margin: 0; padding: 8px 10px; border-radius: 8px 8px 8px 2px; background: var(--m-surface); border: 1px solid var(--m-border); color: var(--m-text); font-size: 13px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.wp-pv-rules { margin: 4px 0 0; padding-left: 18px; list-style: disc; font-size: 12px; color: var(--m-tint-text); }
.wp-pv-rules li + li { margin-top: 2px; }
.wp-callout[data-tone="ok"] { border-left-color: var(--m-primary); }
'''


def main():
    check = '--check' in sys.argv[1:]
    with open(BUNDLE, encoding='utf-8') as f:
        bundle = f.read()
    with open(INDEX, encoding='utf-8') as f:
        html = f.read()
    with open(CSS, encoding='utf-8') as f:
        css = f.read()
    missing = [name for name, _ in GROUPS if marker(name) not in bundle]
    if CSS_MARKER not in css:
        missing.append('css')
    if CSS_NEW not in html:
        missing.append('css link ?v=2')
    pos = html.find(SCRIPT_TAG)
    current = ''.join(ch for ch in html[pos + len(SCRIPT_TAG):pos + len(SCRIPT_TAG) + 6] if ch.isdigit()) if pos >= 0 else ''
    if not current or int(current) < int(CACHE_VERSION):
        missing.append('index.html cache version')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    report = []
    new_bundle = bundle
    for name, fn in GROUPS:
        if marker(name) in new_bundle:
            report.append(f'{name}: already applied')
            continue
        new_bundle = marker(name) + fn(new_bundle)
        report.append(f'{name}: applied')
    new_css = css if CSS_MARKER in css else css.rstrip('\n') + '\n' + CSS_BLOCK
    new_html = html
    if CSS_NEW not in new_html:
        new_html = rep(new_html, CSS_OLD, CSS_NEW, 'processos.css link')
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag not found exactly once')
    if int(current or 0) < int(CACHE_VERSION):
        start = new_html.find(SCRIPT_TAG) + len(SCRIPT_TAG)
        end = start
        while end < len(new_html) and new_html[end].isdigit():
            end += 1
        new_html = new_html[:start] + CACHE_VERSION + new_html[end:]

    if new_bundle != bundle:
        with open(BUNDLE, 'w', encoding='utf-8') as f:
            f.write(new_bundle)
    if new_css != css:
        with open(CSS, 'w', encoding='utf-8') as f:
            f.write(new_css)
        report.append('css: applied')
    if new_html != html:
        with open(INDEX, 'w', encoding='utf-8') as f:
            f.write(new_html)
        report.append(f'index.html written (processos.css ?v=2, bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
