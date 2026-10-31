#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: /manager/login becomes a plain product sign-in screen.

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/home.css (a plain file, edited by hand, scoped to [data-wa-home]).

Bundle group (applied once, leaves a marker comment at the top of the bundle):
  login - the login page (Dse) keeps only the sign-in panel: the "WhatsAI" wordmark on top (link to "/"), one
          centered card (h1 "Entrar no painel", the same two fields, the same submit) and a discreet
          "Voltar ao site" link. Removed: the marketing hero (eyebrow, headline, subtitle, note), the strip of
          four highlights and the marketing footer. Form logic and validation are untouched (same resolver, same
          default values, same submit handler, same error messages); the inputs get autocomplete hints and the
          button says "Conectando…" and is disabled while the submit handler runs. An unreachable server now
          shows the existing "Servidor inválido" message (the request used to throw and show nothing).
index.html group (marker: an HTML comment in <head>):
  html  - home.css ?v=1 -> ?v=2 (login styles; the -26px offset of the entry-screen brand, made for the old logo
          SVG, cut the "W" of the text wordmark on phones) and render-style.css ?v=1 -> ?v=2 (the panel header
          wordmark lines up with the page content on phones and tablets).
Applying also bumps the bundle ?v= in index.html to CACHE_VERSION (only raised, never lowered).

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.
Order: run after home-redesign.py and render-style.py (it replaces the login markup they produce).

Usage (from the repository root):
  python3 -I manager/patches/login-clean.py           # apply
  python3 -I manager/patches/login-clean.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CACHE_VERSION = '15'
REQUIRED = ('/*whatsai-patch:home-redesign:login*/', '/*whatsai-patch:render-style:brand*/')


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:login-clean:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:login-clean:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# --------------------------------------------------------------------------------------------- login
# Minified names (bundle index-b29a5d7a.js): Dse = login page, e = t(), r = react-hook-form form, s = submit handler,
# So / Co / Eo / Vh = Card / Header / Content / Footer, Fo = Form, le = FormField, ne = Input, se = Button,
# WaHomeTop / WaHomeCopy / WaHomeFeatures = entry screen pieces of home-redesign.py, Vb = marketing footer.
FORM = (
    'i.jsx(Fo,{...r,children:i.jsxs("form",{onSubmit:r.handleSubmit(s),children:[i.jsx(Eo,{children:i.jsxs("div",'
    '{className:"grid w-full items-center gap-4",children:[i.jsx(le,{required:!0,name:"serverUrl",label:'
    'e("login.form.serverUrl"),children:i.jsx(ne,{})}),i.jsx(le,{required:!0,name:"apiKey",label:e("login.form.apiKey"),'
    'children:i.jsx(ne,{type:"password"})})]})}),i.jsx(Vh,{className:"flex justify-center",children:i.jsx(se,'
    '{className:"wa-btn-ink w-full",type:"submit",children:e("login.button.login")})})]})})'
)
LOGIN_OLD = (
    'return i.jsxs("div",{className:"wa-home flex min-h-screen flex-col","data-wa-home":"login",children:['
    'i.jsx(WaHomeTop,{children:i.jsx("span",{className:"wa-home-tag",children:"Painel de controle"})}),'
    'i.jsxs("main",{className:"wa-home-main",children:[i.jsxs("section",{className:"wa-hero",'
    '"aria-labelledby":"wa-hero-title",children:[i.jsx(WaHomeCopy,{id:"wa-hero-title",children:'
    'i.jsx("p",{className:"wa-hero-note",children:"Use a URL do seu servidor e a chave de API global para entrar."})}),'
    'i.jsx("div",{className:"wa-hero-panel",children:i.jsxs(So,{className:"wa-login-card",children:['
    'i.jsxs(Co,{className:"wa-login-head",children:[i.jsx(gi,{className:"wa-login-title",children:"Entrar no painel"}),'
    'i.jsx(Kp,{children:e("login.description")})]}),' + FORM + ']})})]}),i.jsx(WaHomeFeatures,{})]}),'
    'i.jsx(Vb,{})]})}function Fse(){'
)
FORM_NEW = (
    'i.jsx(Fo,{...r,children:i.jsxs("form",{onSubmit:r.handleSubmit(s),children:[i.jsx(Eo,{className:"wa-login-body",'
    'children:i.jsxs("div",{className:"wa-login-fields",children:[i.jsx(le,{required:!0,name:"serverUrl",label:'
    'e("login.form.serverUrl"),children:i.jsx(ne,{inputMode:"url",autoComplete:"url",spellCheck:!1,'
    'autoCapitalize:"off",placeholder:"https://seu-servidor.com"})}),i.jsx(le,{required:!0,name:"apiKey",label:'
    'e("login.form.apiKey"),children:i.jsx(ne,{type:"password",autoComplete:"current-password",spellCheck:!1})})]})}),'
    'i.jsx(Vh,{className:"wa-login-foot",children:i.jsx(se,{className:"wa-btn-ink wa-login-submit w-full",type:"submit",'
    'disabled:r.formState.isSubmitting,"aria-busy":r.formState.isSubmitting?"true":void 0,'
    'children:r.formState.isSubmitting?"Conectando…":e("login.button.login")})})]})})'
)
BACK_ICON = (
    'i.jsx("svg",{xmlns:"http://www.w3.org/2000/svg",width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",'
    'stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",'
    'focusable:"false",children:i.jsx("path",{d:"M19 12H5M11 18l-6-6 6-6"})})'
)
LOGIN_NEW = (
    'return i.jsxs("div",{className:"wa-home wa-login-page","data-wa-home":"login",children:['
    'i.jsx("header",{className:"wa-login-top",children:i.jsx("a",{href:"/",className:"wa-login-brand",'
    '"aria-label":"WhatsAI, voltar ao site",children:i.jsx("span",{className:"wa-wordmark",children:"WhatsAI"})})}),'
    'i.jsxs("main",{className:"wa-login-main",children:[i.jsxs(So,{className:"wa-login-card",children:['
    'i.jsx(Co,{className:"wa-login-head",children:i.jsx("h1",{className:"wa-login-title",children:"Entrar no painel"})}),'
    + FORM_NEW + ']}),i.jsx("p",{className:"wa-login-back",children:i.jsxs("a",{href:"/",children:[' + BACK_ICON +
    ',"Voltar ao site"]})})]})]})}function Fse(){'
)


def patch_login(s):
    # an unreachable server made the request throw: nothing was shown and the console got an unhandled
    # AxiosError; now it takes the existing "invalid server" branch (same message, same cleanup)
    s = rep(s, 's=async o=>{const l=await sT({url:o.serverUrl});',
            's=async o=>{const l=await sT({url:o.serverUrl}).catch(()=>null);', 'login server check')
    return rep(s, LOGIN_OLD, LOGIN_NEW, 'login page')


GROUPS = [('login', patch_login)]


# -------------------------------------------------------------------------------------------- html
def patch_html(html):
    html = rep(html, '    <link rel="stylesheet" href="/assets/home.css?v=1" />\n',
               '    ' + html_marker('html') + '\n'
               '    <link rel="stylesheet" href="/assets/home.css?v=2" />\n',
               'index.html home.css (run home-redesign.py first)')
    return rep(html, '/assets/render-style.css?v=1"', '/assets/render-style.css?v=2"',
               'index.html render-style.css (run render-style.py first)')


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
    if html_marker('html') not in html:
        missing.append('html')

    if check:
        if bump_index(html) != html:
            missing.append('bundle ?v=')
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    for required in REQUIRED:
        if required not in s:
            raise PatchError(f'run the patch that adds {required} first')

    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = html
    if 'html' in missing:
        new_html = patch_html(new_html)
        report.append('html: applied')
    else:
        report.append('html: already applied')
    new_html = bump_index(new_html)

    # everything validated: write
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        report.append(f'index.html written (bundle ?v={CACHE_VERSION}, home.css ?v=2, render-style.css ?v=2)')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
