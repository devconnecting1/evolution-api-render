#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: new look for the entry screens (login, "/" and instance list).

Same method as openai-fields.py, responsive.py, openai-media.py and observability-ui.py: manager/dist is the
upstream evolution-manager-v2 2.3.5 build plus manual customizations, so changes are exact string replacements
on the minified bundle instead of a rebuild. The look follows the visual language of a modern infrastructure
landing page (large tight headline with one accent, lots of white space, thin grid lines, cards with a subtle
border, near-black buttons, short section titles); brand, texts and images stay WhatsAI. Light theme only.

The styles live in manager/dist/assets/home.css (a plain file, edited by hand, scoped to [data-wa-home] so
the other screens are untouched); the compiled Tailwind CSS is purged, so new layout classes are wa-* classes
defined there. The components are the ones already in the bundle (Card, Button, Input, Badge, Form).

Bundle groups (each one is applied once and leaves a marker comment at the top of the bundle):
  login     - /manager/login (Dse): top bar, hero (eyebrow, PT-BR headline with an accent, subtitle), the same
              form (server URL + global API key, same fields, validation and submit) in a clean card beside it
              on a fine grid, and a strip of four highlights (OpenAI, automatic human pause, audio/image/PDF,
              observability). The page gets its <main>.
  landing   - "/" (Fse): same top bar and hero, with "Acessar o painel" and "Ler o manual" buttons; the
              existing resource cards below are kept (restyled by home.css).
  instances - /manager/ (CZ): big page title with a count of instances and connected ones, consistent action
              buttons (the refresh button had its click only on the icon and no label), instance cards with a
              subtle border and a status colour, and the card grid is a <div> instead of a second <main>
              (the layout B5 already has one; the min-width rule of responsive.css is repeated in home.css).
              The "Nova instância" dialog gets aria-describedby undefined (Radix warned on every open).
index.html group (marker: an HTML comment in <head>):
  html      - home.css link, after responsive.css.
Applying also bumps the bundle ?v= in index.html to CACHE_VERSION (only raised, never lowered).

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.
Order: run after responsive.py (index.html anchor) and the other bundle patches.

Usage (from the repository root):
  python3 -I manager/patches/home-redesign.py           # apply
  python3 -I manager/patches/home-redesign.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'home.css')
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CACHE_VERSION = '12'
CSS_VERSION = '1'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:home-redesign:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:home-redesign:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


def js(value):
    return json.dumps(value, ensure_ascii=False)


# ------------------------------------------------------------------------------------------- shared
# Minified names (bundle index-b29a5d7a.js): Dse = login page, Fse = "/" page, CZ = instance list, So / Co /
# gi / Kp / Eo / Vh = Card / Header / Title / Description / Content / Footer, se = Button, ne = Input,
# le = FormField, Fo = Form, vu = Badge, Vb = footer, Ip = RefreshCw icon, Th = arrow icon, i = jsx runtime.
LOGO = '/assets/images/whatsai-logo-dark.svg'
HEADLINE = 'Atendimento com IA no WhatsApp, '
ACCENT = 'sem perder o toque humano'
SUBTITLE = ('Conecte seus números, deixe a IA responder a qualquer hora e assuma a conversa quando quiser. '
            'Tudo num só painel.')
FEATURES = [
    ('01', 'IA OpenAI', 'Respostas com GPT, memória da conversa e regras por instância.'),
    ('02', 'Pausa humana automática', 'Quando alguém da equipe responde, a IA pausa sozinha naquela conversa.'),
    ('03', 'Áudio, imagem e PDF', 'Transcreve áudios e lê imagens e documentos enviados pelo cliente.'),
    ('04', 'Observabilidade', 'Banco, servidor, deploys e WhatsApp num só lugar, com alerta de limite.'),
]

SHARED = (
    'const waHomeFeatures=' + js([{'k': k, 't': t, 'd': d} for k, t, d in FEATURES]) + ';'
    'function WaHomeTop({children:e}){return i.jsxs("header",{className:"wa-home-top",children:['
    'i.jsx("a",{href:"/",className:"wa-home-brand","aria-label":"WhatsAI, página inicial",children:'
    'i.jsx("img",{className:"wa-home-logo",src:' + js(LOGO) + ',alt:"WhatsAI"})}),'
    'i.jsx("div",{className:"wa-home-top-end",children:e})]})}'
    'function WaHomeCopy({id:e,children:t}){return i.jsxs("div",{className:"wa-hero-copy",children:['
    'i.jsx("p",{className:"wa-eyebrow",children:"WhatsAI · atendimento com IA"}),'
    'i.jsxs("h1",{id:e,className:"wa-hero-title",children:[' + js(HEADLINE) + ','
    'i.jsx("span",{className:"wa-accent",children:' + js(ACCENT) + '})]}),'
    'i.jsx("p",{className:"wa-hero-sub",children:' + js(SUBTITLE) + '}),t]})}'
    'function WaHomeFeatures(){return i.jsxs("section",{className:"wa-features","aria-labelledby":"wa-features-title",'
    'children:[i.jsx("h2",{id:"wa-features-title",className:"wa-section-title",children:"Feito para atender melhor"}),'
    'i.jsx("ul",{className:"wa-feature-grid",children:waHomeFeatures.map(f=>i.jsxs("li",{className:"wa-feature",children:['
    'i.jsx("span",{className:"wa-feature-label","aria-hidden":"true",children:f.k}),'
    'i.jsx("h3",{className:"wa-feature-title",children:f.t}),'
    'i.jsx("p",{className:"wa-feature-text",children:f.d})]},f.k))})]})}'
)


# -------------------------------------------------------------------------------------------- login
LOGIN_HEAD_OLD = (
    'return i.jsxs("div",{className:"flex min-h-screen flex-col",children:[i.jsx("div",{className:"flex items-center '
    'justify-center pt-2",children:i.jsx("img",{className:"h-10",src:n==="dark"?"/assets/images/whatsai-logo-white.svg"'
    ':"/assets/images/whatsai-logo-dark.svg",alt:"logo"})}),i.jsx("div",{className:"flex flex-1 items-center '
    'justify-center p-8",children:i.jsxs(So,{className:"b-none w-[350px] shadow-none",children:[i.jsxs(Co,{children:['
    'i.jsx(gi,{className:"text-center",children:e("login.title")}),i.jsx(Kp,{className:"text-center",children:'
    'e("login.description")})]}),'
)
LOGIN_HEAD_NEW = (
    'return i.jsxs("div",{className:"wa-home flex min-h-screen flex-col","data-wa-home":"login",children:['
    'i.jsx(WaHomeTop,{children:i.jsx("span",{className:"wa-home-tag",children:"Painel de controle"})}),'
    'i.jsxs("main",{className:"wa-home-main",children:[i.jsxs("section",{className:"wa-hero",'
    '"aria-labelledby":"wa-hero-title",children:[i.jsx(WaHomeCopy,{id:"wa-hero-title",children:'
    'i.jsx("p",{className:"wa-hero-note",children:"Use a URL do seu servidor e a chave de API global para entrar."})}),'
    'i.jsx("div",{className:"wa-hero-panel",children:i.jsxs(So,{className:"wa-login-card",children:['
    'i.jsxs(Co,{className:"wa-login-head",children:[i.jsx(gi,{className:"wa-login-title",children:"Entrar no painel"}),'
    'i.jsx(Kp,{children:e("login.description")})]}),'
)
LOGIN_TAIL_OLD = (
    'i.jsx(Vh,{className:"flex justify-center",children:i.jsx(se,{className:"w-full",type:"submit",children:'
    'e("login.button.login")})})]})})]})}),i.jsx(Vb,{})]})}function Fse(){'
)
LOGIN_TAIL_NEW = (
    'i.jsx(Vh,{className:"flex justify-center",children:i.jsx(se,{className:"wa-btn-ink w-full",type:"submit",children:'
    'e("login.button.login")})})]})})]})})]}),i.jsx(WaHomeFeatures,{})]}),i.jsx(Vb,{})]})}function Fse(){'
)


def patch_login(s):
    s = rep(s, 'function Dse(){', SHARED + 'function Dse(){', 'shared home components')
    s = rep(s, LOGIN_HEAD_OLD, LOGIN_HEAD_NEW, 'login page top')
    return rep(s, LOGIN_TAIL_OLD, LOGIN_TAIL_NEW, 'login page end')


# ------------------------------------------------------------------------------------------ landing
LANDING_TOP_OLD = (
    'return i.jsxs("div",{className:"min-h-screen bg-background",children:[i.jsxs("header",{className:"flex items-center '
    'justify-between px-4 py-2",children:[i.jsx("div",{className:"flex items-center",children:i.jsx("img",{src:t==="dark"'
    '?"/assets/images/whatsai-logo-white.svg":"/assets/images/whatsai-logo-dark.svg",alt:"WhatsAI",className:"h-8"})}),'
    'i.jsxs("div",{className:"flex items-center gap-4",children:[i.jsx(iM,{})]})]}),'
    'i.jsx("div",{className:"container mx-auto px-4 py-16",children:i.jsxs("div",{className:"max-w-4xl mx-auto",children:['
    'i.jsxs("div",{className:"text-center mb-12",children:[i.jsx("div",{className:"flex items-center justify-center mb-6",'
    'children:i.jsx("img",{src:t==="dark"?"/assets/images/whatsai-logo-white.svg":"/assets/images/whatsai-logo-dark.svg",'
    'alt:"WhatsAI",className:"h-10"})}),i.jsx("h1",{className:"text-4xl font-bold text-foreground mb-4",children:"WhatsAI"}),'
    'i.jsx("p",{className:"text-xl text-muted-foreground mb-6",children:"Interface moderna para gerenciar seu WhatsApp com '
    'o WhatsAI"}),i.jsx(vu,{variant:"secondary",className:"text-sm px-3 py-1",children:"Versão 2.0.0"})]}),'
)
LANDING_TOP_NEW = (
    'return i.jsxs("div",{className:"wa-home min-h-screen bg-background","data-wa-home":"landing",children:['
    'i.jsx(WaHomeTop,{children:i.jsx(iM,{})}),'
    'i.jsxs("main",{className:"wa-home-main",children:[i.jsx("section",{className:"wa-hero wa-hero-solo",'
    '"aria-labelledby":"wa-landing-title",children:i.jsx(WaHomeCopy,{id:"wa-landing-title",children:'
    'i.jsxs("div",{className:"wa-hero-actions",children:[i.jsxs(se,{onClick:n,size:"lg",className:"wa-btn-ink",'
    'children:["Acessar o painel",i.jsx(Th,{className:"ml-2 h-4 w-4","aria-hidden":"true"})]}),'
    'i.jsx(se,{variant:"outline",size:"lg",asChild:!0,className:"wa-btn-line",children:'
    'i.jsx("a",{href:"/readme",children:"Ler o manual"})})]})})}),'
    'i.jsx(WaHomeFeatures,{}),'
    'i.jsx("div",{className:"wa-landing-more container mx-auto px-4 py-16",children:i.jsxs("div",{className:"max-w-4xl mx-auto",children:['
)
LANDING_END_OLD = (
    'Licenciado sob Apache 2.0, com condições adicionais."})})]})})]})}const WhatsAIObservability=(()=>{'
)
LANDING_END_NEW = (
    'Licenciado sob Apache 2.0, com condições adicionais."})})]})})]})]})}const WhatsAIObservability=(()=>{'
)


def patch_landing(s):
    s = rep(s, LANDING_TOP_OLD, LANDING_TOP_NEW, 'landing page top')
    return rep(s, LANDING_END_OLD, LANDING_END_NEW, 'landing page end')


# ---------------------------------------------------------------------------------------- instances
LIST_SUB = (
    'o?`${o.length} ${o.length===1?"instância":"instâncias"} · ${o.filter(k=>k.connectionStatus==="open").length} '
    '${o.filter(k=>k.connectionStatus==="open").length===1?"conectada":"conectadas"}`:"Carregando instâncias..."'
)


def patch_instances(s):
    s = rep(s,
            'return i.jsxs("div",{className:"my-4 px-4",children:[i.jsxs("div",{className:"flex w-full items-center '
            'justify-between",children:[i.jsx("h2",{className:"text-lg",children:e("dashboard.title")}),i.jsxs("div",'
            '{className:"flex gap-2",children:[i.jsx(se,{variant:"outline",size:"icon",children:i.jsx(Ip,{onClick:x,'
            'size:"20"})}),',
            'return i.jsxs("div",{className:"wa-home my-4 px-4","data-wa-home":"instances",children:[i.jsxs("div",'
            '{className:"wa-list-head flex w-full items-center justify-between",children:[i.jsxs("div",{className:'
            '"wa-list-heading",children:[i.jsx("p",{className:"wa-eyebrow",children:"Painel WhatsAI"}),i.jsx("h1",'
            '{className:"wa-list-title",children:e("dashboard.title")}),i.jsx("p",{className:"wa-list-sub",'
            '"aria-live":"polite",children:' + LIST_SUB + '})]}),i.jsxs("div",{className:"wa-list-actions flex gap-2",'
            'children:[i.jsx(se,{variant:"outline",size:"icon",onClick:x,"aria-label":"Atualizar lista",'
            'title:"Atualizar lista",children:i.jsx(Ip,{size:"20","aria-hidden":"true"})}),',
            'instance list header')
    s = rep(s,
            'i.jsxs("div",{className:"my-4 flex items-center justify-between gap-3 px-4",children:[i.jsx("div",'
            '{className:"flex-1",children:i.jsx(ne,{placeholder:e("dashboard.search"),value:m,',
            'i.jsxs("div",{className:"wa-list-tools my-4 flex items-center justify-between gap-3 px-4",children:['
            'i.jsx("div",{className:"flex-1",children:i.jsx(ne,{placeholder:e("dashboard.search"),'
            '"aria-label":e("dashboard.search"),value:m,',
            'instance list search')
    s = rep(s,
            'i.jsx("main",{className:"grid gap-6 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",'
            'children:w.length>0&&Array.isArray(w)?w.map(k=>i.jsxs(So,{children:[',
            'i.jsx("div",{className:"wa-instance-grid grid gap-6 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 '
            'xl:grid-cols-4","data-wa-instances":"",children:w.length>0&&Array.isArray(w)?w.map(k=>i.jsxs(So,'
            '{className:"wa-instance-card","data-status":k.connectionStatus||"unknown",children:[',
            'instance grid and cards')
    s = rep(s,
            'i.jsxs(Vh,{className:"justify-between",children:[i.jsx(l_,{status:k.connectionStatus}),',
            'i.jsxs(Vh,{className:"wa-card-foot justify-between",children:[i.jsx(l_,{status:k.connectionStatus}),',
            'instance card footer')
    # "Nova instância" dialog (dQ): no description, so Radix warned on every open; aria-describedby
    # undefined is the documented way to say there is none
    s = rep(s,
            'i.jsxs(Nt,{className:"sm:max-w-[650px]",onCloseAutoFocus:f,children:[i.jsx(Mt,{children:i.jsx(zt,'
            '{children:t("instance.modal.title")',
            'i.jsxs(Nt,{className:"sm:max-w-[650px]",onCloseAutoFocus:f,"aria-describedby":void 0,children:['
            'i.jsx(Mt,{children:i.jsx(zt,{children:t("instance.modal.title")',
            'create instance dialog description')
    return rep(s, 'i.jsx("p",{children:e("dashboard.instancesNotFound")})',
               'i.jsx("p",{className:"wa-empty",children:e("dashboard.instancesNotFound")})', 'instance list empty')


GROUPS = [('login', patch_login), ('landing', patch_landing), ('instances', patch_instances)]


# -------------------------------------------------------------------------------------------- html
def patch_html(html):
    return rep(html, '    <link rel="stylesheet" href="/assets/responsive.css?v=1" />\n',
               '    <link rel="stylesheet" href="/assets/responsive.css?v=1" />\n'
               '    ' + html_marker('html') + '\n'
               '    <link rel="stylesheet" href="/assets/home.css?v=' + CSS_VERSION + '" />\n',
               'index.html home.css (run responsive.py first)')


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
    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/home.css is missing')

    if check:
        if bump_index(html) != html:
            missing.append('bundle ?v=')
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
    if 'html' in missing:
        new_html = patch_html(new_html)
        report.append('html: applied')
    else:
        report.append('html: already applied')
    new_html = bump_index(new_html)

    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        report.append(f'index.html written (bundle ?v={CACHE_VERSION}, home.css ?v={CSS_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
