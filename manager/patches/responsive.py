#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager for phones and tablets.

Same method as openai-fields.py: manager/dist is the upstream evolution-manager-v2 2.3.5 build plus manual
customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The look and behaviour at >= 1024px stay the same: every new element is hidden there by responsive.css.

Groups (each one is applied once and leaves a marker comment at the top of the bundle):
  drawer - instance layout: the sidebar becomes an off-canvas drawer below 1024px (state in the layout,
           closes on navigation, on a link click, on Escape, on the overlay and when the screen grows);
           the shared header gets a menu button (only rendered when the layout passes onMenu).
index.html groups (marker: an HTML comment in <head>):
  html   - responsive.css link and viewport-fit=cover (zoom stays allowed).
Applying also bumps the bundle ?v= in index.html so browsers fetch the patched bundle.

The styles live in manager/dist/assets/responsive.css (a plain file, edited by hand).

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.
Order: run after openai-fields.py (it does not touch the same code, but both bump the bundle ?v=).

Usage (from the repository root):
  python3 -I manager/patches/responsive.py           # apply
  python3 -I manager/patches/responsive.py --check   # exit 1 unless every group is applied
Validate afterwards: cp manager/dist/assets/index-b29a5d7a.js /tmp/x.mjs && node --check /tmp/x.mjs
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CACHE_VERSION = '9'
CSS_VERSION = '1'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:responsive:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:responsive:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# ----------------------------------------------------------------------------------------------- drawer
# Minified names used (bundle index-b29a5d7a.js): un = InstanceLayout, zM = Header, Wy = ScrollArea,
# j5 = Sidebar, Pi = useLocation, Fu = Link, y = React, i = jsx runtime.
SVG = ('i.jsx("svg",{xmlns:"http://www.w3.org/2000/svg",width:"22",height:"22",viewBox:"0 0 24 24",fill:"none",'
       'stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",'
       'children:i.jsx("path",{d:%s})})')

LAYOUT_STATE = (
    'const{instanceId:t}=ls(),{pathname:waPath}=Pi(),[waOpen,waSetOpen]=y.useState(!1);'
    'y.useEffect(()=>{waSetOpen(!1)},[waPath]);'
    'y.useEffect(()=>{if(!waOpen)return;'
    'const k=v=>{v.key==="Escape"&&waSetOpen(!1)},'
    'c=v=>{const a=v.target&&v.target.closest?v.target.closest("[data-wa-sidebar] a[href]"):null;a&&waSetOpen(!1)},'
    'q=window.matchMedia("(min-width: 1024px)"),m=()=>{q.matches&&waSetOpen(!1)};'
    'window.addEventListener("keydown",k),window.addEventListener("click",c,!0),q.addEventListener("change",m);'
    'return()=>{window.removeEventListener("keydown",k),window.removeEventListener("click",c,!0),'
    'q.removeEventListener("change",m)}},[waOpen]);'
)

MENU_BUTTON = (
    'waMenu&&i.jsx("button",{type:"button",className:"wa-menu-toggle","data-wa-menu-toggle":"",'
    '"aria-label":waOpen?"Fechar menu":"Abrir menu","aria-expanded":waOpen?"true":"false",'
    '"aria-controls":"wa-sidebar",onClick:waMenu,'
    'children:' + SVG % 'waOpen?"M18 6 6 18M6 6l12 12":"M4 6h16M4 12h16M4 18h16"' + '}),'
)


def patch_drawer(s):
    s = rep(s,
            'function un({children:e}){const{instanceId:t}=ls();return i.jsx(VM,{children:i.jsxs("div",'
            '{className:"flex h-screen flex-col",children:[i.jsx(zM,{instanceId:t}),i.jsxs("div",'
            '{className:"flex min-h-[calc(100vh_-_56px)] flex-1 flex-col md:flex-row",children:['
            'i.jsx(Wy,{className:"mr-2 py-6 md:w-64",children:',
            'function un({children:e}){' + LAYOUT_STATE + 'return i.jsx(VM,{children:i.jsxs("div",'
            '{className:"flex h-screen flex-col","data-wa-layout":"",children:['
            'i.jsx(zM,{instanceId:t,onMenu:()=>waSetOpen(v=>!v),menuOpen:waOpen}),i.jsxs("div",'
            '{className:"flex min-h-[calc(100vh_-_56px)] flex-1 flex-col md:flex-row",children:['
            'waOpen&&i.jsx("div",{className:"wa-overlay","data-wa-overlay":"","aria-hidden":"true",'
            'onClick:()=>waSetOpen(!1)}),'
            'i.jsx(Wy,{className:"mr-2 py-6 md:w-64",id:"wa-sidebar","data-wa-sidebar":"",'
            '"data-wa-open":waOpen?"true":"false",children:',
            'instance layout')
    s = rep(s, 'function zM({instanceId:e}){', 'function zM({instanceId:e,onMenu:waMenu,menuOpen:waOpen}){',
            'header props')
    s = rep(s,
            'i.jsxs("header",{className:"flex items-center justify-between px-4 py-2",children:['
            'i.jsx(Fu,{to:"/manager",onClick:l,',
            'i.jsxs("header",{className:"flex items-center justify-between px-4 py-2","data-wa-header":"",children:['
            + MENU_BUTTON + 'i.jsx(Fu,{to:"/manager",onClick:l,',
            'header menu button')
    return s


GROUPS = [('drawer', patch_drawer)]


# ------------------------------------------------------------------------------------------------- html
def patch_html_css(html):
    html = rep(html, '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
               '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
               'index.html viewport')
    return rep(html, '    <link rel="stylesheet" href="/assets/readme-tab.css?v=7" />\n',
               '    <link rel="stylesheet" href="/assets/readme-tab.css?v=7" />\n'
               '    ' + html_marker('html') + '\n'
               '    <link rel="stylesheet" href="/assets/responsive.css?v=' + CSS_VERSION + '" />\n',
               'index.html responsive.css')


HTML_GROUPS = [('html', patch_html_css)]


def bump_index(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag not found exactly once')
    end = html.index('"', pos)
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
    missing_html = [name for name, _ in HTML_GROUPS if html_marker(name) not in html]

    if check:
        if bump_index(html) != html:
            missing_html.append('bundle ?v=')
        missing += missing_html
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = html
    for name, fn in HTML_GROUPS:
        if name not in missing_html:
            report.append(f'{name}: already applied')
            continue
        new_html = fn(new_html)
        report.append(f'{name}: applied')
    new_html = bump_index(new_html)

    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        report.append(f'index.html written (bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
