#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: functional fixes from the audit of 12/11/2026.

Findings covered (all in manager/dist, no backend):
1. toast     - the success toast of the lead export sat on top of the page buttons and never closed while the
               pointer stayed over it. The only ToastContainer of the panel now opens at the bottom-right,
               after 4 s and without pausing on hover. The CSS makes the container click-through and only the
               toast itself interactive; error toasts keep the same component and theme.
2. chats     - POST /chat/findChats 500 kept the list on the skeleton until React Query finished the default
               retries. The chat query no longer retries; the existing "Não foi possível carregar as conversas"
               state with "Tentar de novo" appears at once and the right pane/navigation stay usable.
3. chats     - a 200 answer that is not an array (e.g. an object) crashed the whole page on u.forEach. The query
               now validates Array.isArray, treats the invalid shape as an error and the list degrades alone;
               the useMemo that merges the WebSocket contacts also guards the shape.
4. instances - GET /instance/fetchInstances 500 had the same delayed skeleton. The list query no longer retries,
               so the existing error state with "Tentar de novo" appears immediately; it also offers
               "Abrir a última instância" (localStorage instanceId) while the list is unavailable. The header
               keeps "Nova instância" enabled.
5. lead AI   - "Assumir conversa"/"Retomar IA" in the lead card fired POST /openai/changeStatus at once although
               the panel text says the action asks for confirmation. The action now asks with window.confirm
               (same approach as confirmacoes.py) before the POST; cancel changes nothing.

Every anchor must match exactly once, otherwise the script stops without writing anything. Re-running is safe:
groups whose marker is already present are skipped. Applying also raises the bundle ?v= in index.html to
CACHE_VERSION (only raised, never lowered) and links qa-funcional.css right before design-system.css.

Order: run after qa-polish.py and qa-a11y.py (the new stylesheet goes after qa-polish.css and before
design-system.css). qa-a11y.py already gives the instance buttons their aria-labels, so the two label groups here
only record their marker on the current markup.

Usage (from the repository root):
  python3 -I manager/patches/qa-funcional.py           # apply
  python3 -I manager/patches/qa-funcional.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'qa-funcional.css')
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_TAG = '<link rel="stylesheet" href="/assets/qa-funcional.css?v=1" />'
CSS_MARKER = '<!-- whatsai-patch:qa-funcional:css -->'
DESIGN_MARKER = '<!-- whatsai-patch:design-system:html -->'
CACHE_VERSION = '74'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:qa-funcional:' + name + '*/'


GROUPS = [
    (
        'toast',
        'i.jsx(CL,{theme:"colored",icon:WaUt.toastIcon,closeButton:WaUt.ToastClose})',
        'i.jsx(CL,{theme:"colored",icon:WaUt.toastIcon,closeButton:WaUt.ToastClose,'
        'position:"bottom-right",autoClose:4e3,pauseOnHover:!1})',
    ),
    (
        'chat-query',
        'rY=async({instanceName:e})=>(await Ee.post(`/chat/findChats/${e}`,{where:{}})).data,'
        'sY=e=>{const{instanceName:t,...n}=e;return mt({...n,queryKey:nY({instanceName:t}),'
        'queryFn:()=>rY({instanceName:t}),enabled:!!t})}',
        'rY=async({instanceName:e})=>{const t=(await Ee.post(`/chat/findChats/${e}`,{where:{}})).data;'
        "if(!Array.isArray(t))throw new Error('Resposta inesperada ao carregar as conversas.');return t},"
        'sY=e=>{const{instanceName:t,...n}=e;return mt({...n,queryKey:nY({instanceName:t}),'
        'queryFn:()=>rY({instanceName:t}),enabled:!!t,retry:!1})}',
    ),
    (
        'chat-memo',
        'f=qe.useMemo(()=>{if(!u)return o;const C=new Map;return u.forEach(',
        'f=qe.useMemo(()=>{if(!Array.isArray(u))return o;const C=new Map;return u.forEach(',
    ),
    (
        'instances-query',
        'q5=e=>mt({...e,queryKey:V5,queryFn:()=>H5()})',
        'q5=e=>mt({...e,queryKey:V5,queryFn:()=>H5(),retry:!1})',
    ),
    (
        'instances-create-label',
        'i.jsxs("button",{type:"button",className:"wa-ut-tbtn wa-ut-tbtn--line wa-ut-new",'
        '"aria-label":"Nova instância",'
        'children:[i.jsx(cs,{size:"14","aria-hidden":"true"}),i.jsx("span",{children:"Nova instância"})]})',
        'i.jsxs("button",{type:"button",className:"wa-ut-tbtn wa-ut-tbtn--line wa-ut-new",'
        '"aria-label":"Nova instância",'
        'children:[i.jsx(cs,{size:"14","aria-hidden":"true"}),i.jsx("span",{children:"Nova instância"})]})',
    ),
    (
        'instances-more-label',
        "i.jsxs('button',{type:'button',className:'wa-ut-tbtn wa-ut-tbtn--line','aria-label':'Mais',"
        "children:[svg('more',14),i.jsx('span',{children:'Mais'})]})",
        "i.jsxs('button',{type:'button',className:'wa-ut-tbtn wa-ut-tbtn--line','aria-label':'Mais',"
        "children:[svg('more',14),i.jsx('span',{children:'Mais'})]})",
    ),
    (
        'instances-error-actions',
        "!all.length&&!list?i.jsx('button',{type:'button',className:'wa-ut-tbtn wa-ut-tbtn--line',"
        "onClick:()=>refresh(),children:i.jsx('span',{children:'Tentar de novo'})}):null]",
        "!all.length&&!list?i.jsxs(i.Fragment,{children:["
        "i.jsx('button',{type:'button',className:'wa-ut-tbtn wa-ut-tbtn--line',onClick:()=>refresh(),"
        "children:i.jsx('span',{children:'Tentar de novo'})}),"
        "(()=>{let w=null;try{w=localStorage.getItem('instanceId')}catch(e){}"
        "return w?i.jsx('button',{type:'button',className:'wa-ut-tbtn',"
        "onClick:()=>nav('/manager/instance/'+w+'/dashboard'),children:'Abrir a última instância'}):null})()"
        "]}):null]",
    ),
    (
        'lead-ai-confirm',
        'const act=async next=>{const s=aiState&&aiState.s;if(!s||busy)return;setBusy(!0);',
        r'''const act=async next=>{const s=aiState&&aiState.s;if(!s||busy)return;if(!window.confirm(next==='paused'?'Pausar a IA para este contato?\n\nA IA para de responder até alguém retomar. A equipe continua atendendo pelo WhatsApp normalmente.':'Retomar a IA para este contato?\n\nA IA volta a responder as próximas mensagens deste contato.'))return;setBusy(!0);''',
    ),
]


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


def patch_index(html):
    has_tag = CSS_TAG in html
    has_marker = CSS_MARKER in html
    if has_tag != has_marker:
        raise PatchError('index.html: qa-funcional.css linked without its marker')
    if has_tag:
        return html
    if html.count('    ' + DESIGN_MARKER) != 1:
        raise PatchError('index.html: design-system marker expected once (run design-system.py first)')
    block = '    ' + CSS_MARKER + '\n    ' + CSS_TAG + '\n'
    return html.replace('    ' + DESIGN_MARKER, block + '    ' + DESIGN_MARKER, 1)


def main():
    check = '--check' in sys.argv[1:]
    with open(BUNDLE, encoding='utf-8') as f:
        bundle = f.read()
    with open(INDEX, encoding='utf-8') as f:
        html = f.read()

    missing_groups = [name for name, _, _ in GROUPS if marker(name) not in bundle]
    missing = list(missing_groups)
    if patch_index(html) != html:
        missing.append('index.html css')
    if bump_index(html) != html:
        missing.append('index.html cache version')
    if not os.path.exists(CSS):
        missing.append('qa-funcional.css')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if missing_groups:
        for name, old, new in GROUPS:
            if marker(name) not in bundle:
                found = bundle.count(old)
                if found != 1:
                    raise PatchError(f'{name}: anchor expected once, got {found}')
        report = []
        for name, old, new in GROUPS:
            if marker(name) in bundle:
                report.append(f'{name}: already applied')
                continue
            bundle = bundle.replace(old, marker(name) + new, 1)
            report.append(f'{name}: applied')
    else:
        report = ['bundle: already applied']

    new_html = bump_index(patch_index(html))
    with open(BUNDLE, 'w', encoding='utf-8') as f:
        f.write(bundle)
    if new_html != html:
        with open(INDEX, 'w', encoding='utf-8') as f:
            f.write(new_html)
    pos = new_html.find(SCRIPT_TAG) + len(SCRIPT_TAG)
    end = pos
    while end < len(new_html) and new_html[end].isdigit():
        end += 1
    report.append(f'index.html: qa-funcional.css, bundle ?v={new_html[pos:end]}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
