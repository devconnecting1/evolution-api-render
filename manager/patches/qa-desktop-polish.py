#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: desktop polish from the visual/functional audit of 12/11/2026.

Same method as the other scripts in manager/patches: manager/dist is the compiled bundle, so changes are exact
string replacements in index.html plus plain CSS/JS files edited by hand.

The styles live in manager/dist/assets/qa-desktop-polish.css and the DOM/API behaviors in qa-desktop-polish.js:

  css - Leads > Quadro with the five status columns visible on desktop (and visible scroll + edge fade while it
        still scrolls); empty-conversation icon drawn with mask (light and dark); one page frame (lists 1040 px,
        forms 760 px) for Contatos da IA, Acesso do cliente and Conexao; same vertical rhythm and no duplicated
        title on the global pages; checkbox/radio/switch with token borders in both themes; semantic dot on
        Integracoes; status chip on the Atendente IA cards; fixed header/footer and scrolling body in "Novo
        atendente"; no vertical dividers on Chaves; Processos table fitting the 1040 px card; Instancias on the
        same 1040 px column; wider label column in the contact panel; chevron on the notifications actions.
  js  - breadcrumb above the H1 of Chaves and Retencao; "chatBot" translated and Ligado/Desligado chip fed by
        GET /openai/find; English 503/network errors in Portuguese; duplicated billing empty message removed;
        X on the credential/confirmation dialogs; Marcar/Desmarcar Todos grouped; "Sair" in the client sidebar;
        role=switch on the single Acesso do cliente toggle.
  html - links qa-desktop-polish.css right before design-system.css (which stays the last stylesheet), inserts
         qa-desktop-polish.js right before the bundle script, and raises the bundle ?v= to CACHE_VERSION when lower.

Every anchor must match exactly once, otherwise the script stops without writing anything. Re-running is safe:
when the markers, stylesheet and script are already in index.html, only the cache version may still be raised.
Order: after qa-polish.py (uses its marker as the CSS anchor) and after every other patch that links a stylesheet.

Usage (from the repository root):
  python3 -I manager/patches/qa-desktop-polish.py           # apply
  python3 -I manager/patches/qa-desktop-polish.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'qa-desktop-polish.css')
JS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'qa-desktop-polish.js')
CACHE_VERSION = '77'
CSS_VERSION = '1'
JS_VERSION = '1'
SCRIPT_TAG = '<script type="module" crossorigin src="/assets/index-b29a5d7a.js?v='
CSS_TAG = '<link rel="stylesheet" href="/assets/qa-desktop-polish.css?v=' + CSS_VERSION + '" />'
JS_TAG = '<script src="/assets/qa-desktop-polish.js?v=' + JS_VERSION + '"></script>'
CSS_MARKER = '<!-- whatsai-patch:qa-desktop-polish:css -->'
JS_MARKER = '<!-- whatsai-patch:qa-desktop-polish:js -->'
DESIGN_MARKER = '<!-- whatsai-patch:design-system:html -->'


class PatchError(Exception):
    pass


def patch_index(html):
    css_done = CSS_TAG in html and CSS_MARKER in html
    js_done = JS_TAG in html and JS_MARKER in html
    if css_done and js_done:
        return html
    if (CSS_TAG in html) != (CSS_MARKER in html):
        raise PatchError('index.html: qa-desktop-polish.css linked without its marker')
    if (JS_TAG in html) != (JS_MARKER in html):
        raise PatchError('index.html: qa-desktop-polish.js linked without its marker')
    if not css_done:
        if html.count('    ' + DESIGN_MARKER) != 1:
            raise PatchError('index.html: design-system marker expected once (run design-system.py first)')
        block = '    ' + CSS_MARKER + '\n    ' + CSS_TAG + '\n'
        html = html.replace('    ' + DESIGN_MARKER, block + '    ' + DESIGN_MARKER, 1)
    if not js_done:
        anchor = '    ' + SCRIPT_TAG
        if html.count(anchor) != 1:
            raise PatchError('index.html: bundle script tag expected once')
        block = '    ' + JS_MARKER + '\n    ' + JS_TAG + '\n'
        html = html.replace(anchor, block + anchor, 1)
    return html


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
    html = open(INDEX, encoding='utf-8').read()
    missing = []
    if html.count('    ' + DESIGN_MARKER) != 1:
        missing.append('design-system marker (run design-system.py first)')
    if CSS_MARKER not in html or CSS_TAG not in html:
        missing.append('qa-desktop-polish.css link')
    if JS_MARKER not in html or JS_TAG not in html:
        missing.append('qa-desktop-polish.js script')
    if patch_index(html) != html:
        missing.append('index.html')
    if bump_index(html) != html:
        missing.append('index.html cache version')
    if not os.path.exists(CSS):
        missing.append('qa-desktop-polish.css')
    if not os.path.exists(JS):
        missing.append('qa-desktop-polish.js')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    new_html = bump_index(patch_index(html))
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    pos = new_html.find(SCRIPT_TAG) + len(SCRIPT_TAG)
    end = pos
    while end < len(new_html) and new_html[end].isdigit():
        end += 1
    print(f'index.html: qa-desktop-polish.css and qa-desktop-polish.js ?v={CSS_VERSION}, bundle ?v={new_html[pos:end]}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'error: {error}', file=sys.stderr)
        sys.exit(1)
