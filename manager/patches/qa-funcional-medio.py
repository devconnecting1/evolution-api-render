#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: medium/low findings of the functional audit (12/11/2026).

These are the findings that do not belong to the toast/error-state PR. Each one is a small, local fix; nothing
changes the product structure or the backend:

1. login        - keeps production as the default server, but reads localStorage.apiUrl (the address the panel
                  already stores after a login) and offers an optional "Avançado: URL do servidor" field. Empty
                  means the WhatsAI production server; a custom URL is used and saved by the existing login flow.
2. usage        - the selected plan card shows the limit returned by /usage/limits instead of the fixed commercial
                  number; the other cards say "mês · referência" and a hint says which number is the current one.
3. billing      - a payment method that arrives as an object is formatted (brand, last digits, expiry) instead of
                  "[object Object]"; any other object falls back to its primitive values and never to the string.
4. agenda       - optional fields (minutes, source, typeName, label) get fallbacks instead of "undefined"; the week
                  appointment aria-label joins the fields with commas (panel-a11y.js also learns the separators);
                  empty week slots are focusable and Enter/Space creates an appointment at the first hour of the
                  visible range. The realizado/faltou type also gets the full text colour (contrast 4.5:1).
5. lead page    - appointment times use the label the API already formats in the agenda/instance time zone (the same
                  one the Agenda shows), falling back to the local formatter only when the label is absent.
6. instances    - the actions menu column gets width/padding and a visible "Ações" header, so the three-dot button is
                  not clipped; the name column releases the few pixels so 1440 still has no horizontal scroll.
7. observability- removes the 60 s setInterval that called GET /observability; the page still loads on open, when
                  the tab becomes visible again after 60 s and on the Atualizar button. The overview endpoint reads
                  the control database (own databases and instance usage), so the polling could wake Neon every
                  minute. The page texts that promised the automatic cycle are updated.

The CSS lives in manager/dist/assets/qa-funcional-medio.css (Processos table overflow, instances actions column,
Agenda focus ring/contrast and the login advanced block). panel-a11y.js is patched in place (?v=2) and the
observability page has its own JS/HTML files (the live page is the SPA component; the standalone files are kept
consistent).

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped, the CSS is only written when its content changes.
Order: after qa-polish.py (uses its index.html marker as the anchor) and design-system.py (design-system.css stays
the last stylesheet).

Usage (from the repository root):
  python3 -I manager/patches/qa-funcional-medio.py           # apply
  python3 -I manager/patches/qa-funcional-medio.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'qa-funcional-medio.css')
OBS_INDEX = os.path.join(ROOT, 'manager', 'dist', 'observability', 'index.html')
OBS_JS = os.path.join(ROOT, 'manager', 'dist', 'observability', 'observability.js')
CACHE_VERSION = '76'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_TAG = '<link rel="stylesheet" href="/assets/qa-funcional-medio.css?v=1" />'
HTML_MARKER = '<!-- whatsai-patch:qa-funcional-medio:css -->'
DESIGN_MARKER = '<!-- whatsai-patch:design-system:html -->'
QA_POLISH_MARKER = '<!-- whatsai-patch:qa-polish:css -->'

PROD_URL = 'https://evolution-api-x93o.onrender.com'

CSS_CONTENT = '''/* WhatsAI panel: medium/low findings of the functional audit (manager/patches/qa-funcional-medio.py).
   Only local corrections; no product structure changes. */

/* ---------------------------------------------------------------- login: advanced server URL */
[data-wa-home="login"] .wa-login-adv {
  padding: 10px 12px;
  border: 1px solid var(--wa-line);
  border-radius: var(--wa-radius);
  background: var(--wa-paper);
}
[data-wa-home="login"] .wa-login-adv summary {
  cursor: pointer;
  color: var(--wa-ink-soft);
  font-size: 0.8125rem;
  font-weight: 500;
}
[data-wa-home="login"] .wa-login-adv[open] summary {
  margin-bottom: 10px;
}
[data-wa-home="login"] .wa-login-adv-hint {
  margin: 6px 0 0;
  color: var(--wa-ink-soft);
  font-size: 0.75rem;
}
[data-wa-home="login"] .wa-login-adv input {
  width: 100%;
}

/* ------------------------------------------- processos: the Situação column was cut at 1440 */
.wp-table th,
.wp-table td {
  padding-left: 8px;
  padding-right: 8px;
}
.wp-table th:last-child,
.wp-table td:last-child {
  padding-right: 14px;
}
.wp-table .wp-status {
  white-space: normal;
}

/* ------------------------------------ instâncias: room for the actions menu and its header */
#root .wa-ut-table th,
#root .wa-ut-table td {
  padding-left: 8px;
  padding-right: 8px;
}
#root .wa-ut-table .wa-ut-c-menu {
  width: 54px;
  min-width: 54px;
  padding: 0 10px 0 6px;
}
#root .wa-ut-table .wa-ut-c-name {
  min-width: 176px;
}

/* ---------------------- agenda: empty week slots receive keyboard focus (Enter/Space opens) */
.wag-col:focus-visible {
  outline: 2px solid var(--m-primary);
  outline-offset: -2px;
}

/* Agenda: the 0.8 opacity of the appointment type dropped "realizado" below 4.5:1 (axe) */
.wag-appt[data-status="realizado"] .wag-appt-type,
.wag-appt[data-status="faltou"] .wag-appt-type {
  opacity: 1;
  color: var(--m-text);
}
'''

OBS_JS_OLD = """setInterval(() => {
  if (autoRefresh && !document.hidden) load(false);
}, REFRESH_MS);

"""
OBS_JS_NEW = """/*whatsai-patch:qa-funcional-medio:no-poll*/
// No background polling. The overview reads the control database (own databases and instance usage), so it
// only loads when the page opens, when the tab becomes visible again after 60 s and on the Atualizar button.
"""
OBS_JS_MARKER = '/*whatsai-patch:qa-funcional-medio:no-poll*/'
OBS_HTML_MARKER = '<!-- whatsai-patch:qa-funcional-medio:obs -->'
OBS_HELP_OLD = (
    '<p>Depois de salvar as variáveis no Render, use <strong>Atualizar</strong> ou aguarde o próximo ciclo de '
    '60 segundos.</p>'
)
OBS_HELP_NEW = '<p>Depois de salvar as variáveis no Render, use <strong>Atualizar</strong>.</p>'
OBS_FOOT_OLD = '<span>Atualização automática a cada 60s.</span>'
OBS_FOOT_NEW = '<span>Atualiza ao abrir a página, ao voltar para ela e no botão Atualizar.</span>'
OBS_SCRIPT_OLD = 'src="/observability/observability.js?v=1"'
OBS_SCRIPT_NEW = 'src="/observability/observability.js?v=2"'
A11Y = os.path.join(ROOT, 'manager', 'dist', 'assets', 'panel-a11y.js')
A11Y_MARKER = '/*whatsai-patch:qa-funcional-medio:agenda-labels*/'
A11Y_SCRIPT_OLD = '<script src="/assets/panel-a11y.js?v=1" defer></script>'
A11Y_SCRIPT_NEW = '<script src="/assets/panel-a11y.js?v=2" defer></script>'
A11Y_OLD = """    var appts = document.querySelectorAll('.wag-appt[aria-label]');
    for (var a = 0; a < appts.length; a++) {
      var seen = text(appts[a]);
      var label = appts[a].getAttribute('aria-label') || '';
      if (seen && label.indexOf(seen) !== 0) {
        var status = label.split(', ').pop();
        appts[a].setAttribute('aria-label', seen + (status ? ', ' + status : ''));
      }
    }
"""
A11Y_NEW = """    var appts = document.querySelectorAll('.wag-appt[aria-label]');
    for (var a = 0; a < appts.length; a++) {
      /*whatsai-patch:qa-funcional-medio:agenda-labels*/
      // textContent joins the spans without spaces ("14:00Maria SouzaReunião inicial"): add the separators.
      var bits = [];
      var timeEl = appts[a].querySelector('.wag-appt-time');
      var nameEl = appts[a].querySelector('.wag-appt-name');
      var typeEl = appts[a].querySelector('.wag-appt-type');
      if (timeEl) bits.push(text(timeEl));
      if (nameEl) bits.push(text(nameEl));
      if (typeEl) bits.push(text(typeEl));
      var seen = bits.length ? bits.join(', ') : text(appts[a]);
      var label = appts[a].getAttribute('aria-label') || '';
      if (seen && label.indexOf(seen) !== 0) {
        var status = label.split(', ').pop();
        appts[a].setAttribute('aria-label', seen + (status ? ', ' + status : ''));
      }
    }
"""


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:qa-funcional-medio:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


# ------------------------------------------------------------------------------------------------ login
def patch_login(s):
    s = rep(
        s,
        'defaultValues:{serverUrl:"' + PROD_URL + '",apiKey:""}',
        'defaultValues:{serverUrl:(()=>{try{const u=(localStorage.getItem("apiUrl")||"").trim();'
        'return /^https?:\\/\\/[^\\s]+$/.test(u)?u:"' + PROD_URL + '"}catch(e){return "' + PROD_URL + '"}})(),'
        'apiKey:""}',
        'login default server',
    )
    s = rep(
        s,
        'const l=await sT({url:o.serverUrl}).catch(()=>null);',
        'const u=(o.serverUrl||"").trim()||"' + PROD_URL + '",'
        'l=await sT({url:u}).catch(()=>null);',
        'login submit server',
    )
    s = rep(
        s,
        'Ise({token:o.apiKey,url:o.serverUrl})',
        'Ise({token:o.apiKey,url:u})',
        'login verify server',
    )
    s = rep(
        s,
        'Rj({version:l.version,clientName:l.clientName,url:o.serverUrl,token:o.apiKey})',
        'Rj({version:l.version,clientName:l.clientName,url:u,token:o.apiKey})',
        'login save server',
    )
    s = rep(
        s,
        'serverUrl:P.string({required_error:"Informe a URL do servidor"}).url("URL inválida")',
        'serverUrl:P.string().url("URL inválida").or(P.literal("")).optional()',
        'login schema',
    )
    s = rep(
        s,
        'i.jsx(Eo,{className:"wa-login-body",children:i.jsxs("div",{className:"wa-login-fields",children:['
        'i.jsx(le,{required:!0,name:"apiKey",label:"Chave de acesso",children:i.jsx(ne,{type:"password",'
        'autoComplete:"current-password",spellCheck:!1,autoFocus:!0})})]})})',
        'i.jsx(Eo,{className:"wa-login-body",children:i.jsxs("div",{className:"wa-login-fields",children:['
        'i.jsx(le,{required:!0,name:"apiKey",label:"Chave de acesso",children:i.jsx(ne,{type:"password",'
        'autoComplete:"current-password",spellCheck:!1,autoFocus:!0})}),'
        'i.jsxs("details",{className:"wa-login-adv",children:['
        'i.jsx("summary",{children:"Avançado: URL do servidor"}),'
        'i.jsx(le,{name:"serverUrl",label:"URL do servidor (opcional)",children:i.jsx(ne,{inputMode:"url",'
        'autoComplete:"url",spellCheck:!1,autoCapitalize:"off",placeholder:"' + PROD_URL + '"})}),'
        'i.jsx("p",{className:"wa-login-adv-hint",children:"Em branco, usa o servidor do WhatsAI."})]})]})})',
        'login advanced field',
    )
    return s


# ------------------------------------------------------------------------------------------------ usage
def patch_usage(s):
    old = (
        "i.jsx('span',{className:'wu-plan-name',children:lb}),i.jsx('span',{className:'wu-plan-n',"
        "children:n?fmt(n)+' respostas/mês':id==='none'?'IA sem franquia':'você define'})]},id))})]}),"
    )
    new = (
        "i.jsx('span',{className:'wu-plan-name',children:lb}),i.jsx('span',{className:'wu-plan-n',"
        "children:id===form.plan&&id!=='none'&&id!=='Personalizado'&&form.monthly?fmt(form.monthly)+' respostas/mês':"
        "n?fmt(n)+'/mês · referência':id==='none'?'IA sem franquia':'você define'})]},id))}),"
        "i.jsx('p',{className:'wu-hint',children:'Os números dos cards são referência comercial. "
        "A franquia vigente é a de Respostas por mês.'})]}),"
    )
    return rep(s, old, new, 'usage plan cards')


# ---------------------------------------------------------------------------------------------- billing
def patch_billing(s):
    s = rep(
        s,
        "wctext=v=>v==null||v===''?'':String(v);",
        "wctext=v=>v==null||v===''?'':typeof v==='object'?'':String(v);"
        "const wcpay=v=>{if(v==null||v==='')return '';if(typeof v==='string'||typeof v==='number')return String(v);"
        "if(typeof v!=='object')return '';const get=(...ks)=>{for(const k of ks){const x=v[k];"
        "if(x!=null&&x!==''&&typeof x!=='object')return String(x)}return ''};"
        "const brand=get('brand','bandeira','scheme'),last=get('last4','lastFour','final','endingIn'),"
        "exp=get('expiry','expires','expiration','validade');"
        "const parts=[brand,last?'final '+last:'',exp].filter(Boolean);"
        "return parts.length?parts.join(' · '):Object.values(v).filter(x=>typeof x==='string'||typeof x==='number')"
        ".map(String).join(' · ')};",
        'billing payment helper',
    )
    return rep(
        s,
        "data.paymentMethod?i.jsx('p',{className:'wu-hint',children:'Forma de pagamento: '+wctext(data.paymentMethod)}):null",
        "data.paymentMethod?i.jsx('p',{className:'wu-hint',children:'Forma de pagamento: '+(wcpay(data.paymentMethod)||'—')}):null",
        'billing payment method',
    )


# ----------------------------------------------------------------------------------------------- agenda
def patch_agenda_create(s):
    return rep(
        s,
        "types.map(t=>h('option',{key:t.name,value:t.name},t.name+' ('+t.minutes+' min)'))",
        "types.map(t=>h('option',{key:t.name,value:t.name},t.minutes?t.name+' ('+t.minutes+' min)':t.name))",
        'agenda type minutes',
    )


def patch_agenda_list(s):
    return rep(
        s,
        "h('span',{className:'wag-hint'},a.typeName+' · '+(SOURCES[a.source]||a.source))",
        "h('span',{className:'wag-hint'},[a.typeName||'Consulta',a.source?(SOURCES[a.source]||a.source):'']"
        ".filter(Boolean).join(' · '))",
        'agenda list source',
    )


def patch_agenda_week(s):
    label = ("'aria-label':[hm(p.min),a.contactName||('+'+digits(a.remoteJid)),a.typeName,SL[a.status]]"
             ".filter(Boolean).join(', ')")
    s = rep(s, label, label, 'agenda week appointment label')
    col = ("const click=e=>{if(e.target.closest('.wag-appt'))return;"
           "const r=e.currentTarget.getBoundingClientRect();"
           "const m=lo+Math.floor((e.clientY-r.top)/PPM/step)*step;"
           "onSlot(d,Math.max(lo,Math.min(hi-step,m)))};\n"
           "          return h('div',{key:d,className:'wag-col',role:'group','data-today':d===today?'true':void 0,"
           "tabIndex:0,onKeyDown:e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();"
           "onSlot(d,Math.max(lo,Math.min(hi-step,9*60)))}},onClick:click,'aria-label':dayLabel(d)},")
    s = rep(s, col, col, 'agenda week keyboard slot')
    return s


def patch_lead_timezone(s):
    s = rep(
        s,
        "text:(a.typeName||'Consulta')+' · '+when(a.startsAt)",
        "text:(a.typeName||'Consulta')+' · '+(a.label||when(a.startsAt))",
        'lead timeline appointment time',
    )
    s = rep(
        s,
        "i.jsxs('p',{className:'wa-fl-row-text',children:[when(a.startsAt),a.notes?' — '+a.notes:'']})",
        "i.jsxs('p',{className:'wa-fl-row-text',children:[a.label||when(a.startsAt),a.notes?' — '+a.notes:'']})",
        'lead agenda list time',
    )
    return s


def patch_next_appointment(s):
    return rep(
        s,
        "children:st.a.label+' · '+st.a.typeName",
        "children:[st.a.label,st.a.typeName].filter(Boolean).join(' · ')||'Agendamento'",
        'next appointment label',
    )


def patch_instances_actions(s):
    return rep(
        s,
        "i.jsx('th',{scope:'col',className:'wa-ut-c-menu',children:i.jsx('span',{className:'sr-only',"
        "children:'Ações'})})",
        "i.jsx('th',{scope:'col',className:'wa-ut-c-menu',children:i.jsx('span',{className:'wa-ut-th',"
        "children:'Ações'})})",
        'instances actions header',
    )


def patch_observability(s):
    old = (
        "      const timer=setInterval(()=>{if(!document.hidden)load(false);},60000);\n"
        "      const tick=setInterval(()=>setNow(Date.now()),15000);\n"
        "      const visibility=()=>{if(!document.hidden&&updatedRef.current&&"
        "Date.now()-updatedRef.current>60000)load(false);};\n"
        "      document.addEventListener('visibilitychange',visibility);\n"
        "      return ()=>{alive.current=false;clearInterval(timer);clearInterval(tick);"
        "document.removeEventListener('visibilitychange',visibility);};"
    )
    new = (
        "      // No background polling: the overview reads the control database, so it only loads on open,\n"
        "      // on return to the tab after 60 s and on the Atualizar button.\n"
        "      const tick=setInterval(()=>setNow(Date.now()),15000);\n"
        "      const visibility=()=>{if(!document.hidden&&updatedRef.current&&"
        "Date.now()-updatedRef.current>60000)load(false);};\n"
        "      document.addEventListener('visibilitychange',visibility);\n"
        "      return ()=>{alive.current=false;clearInterval(tick);"
        "document.removeEventListener('visibilitychange',visibility);};"
    )
    s = rep(s, old, new, 'observability polling')
    s = rep(
        s,
        "i.jsx('p',{children:'Depois de salvar as variáveis no Render, use Atualizar ou aguarde o próximo "
        "ciclo de 60 segundos.'})",
        "i.jsx('p',{children:'Depois de salvar as variáveis no Render, use Atualizar.'})",
        'observability help text',
    )
    return rep(
        s,
        "i.jsx('span',{children:'Atualização automática a cada 60s.'})",
        "i.jsx('span',{children:'Atualiza ao abrir a página, ao voltar para ela e no botão Atualizar.'})",
        'observability footer text',
    )


GROUPS = [
    ('login', patch_login),
    ('usage', patch_usage),
    ('billing', patch_billing),
    ('agenda-create', patch_agenda_create),
    ('agenda-list', patch_agenda_list),
    ('agenda-week', patch_agenda_week),
    ('lead-timezone', patch_lead_timezone),
    ('next-appointment', patch_next_appointment),
    ('instances-actions', patch_instances_actions),
    ('observability', patch_observability),
]


# ------------------------------------------------------------------------------------ observability
def patch_obs_js(js):
    if OBS_JS_MARKER in js:
        return js
    return rep(js, OBS_JS_OLD, OBS_JS_NEW, 'observability polling')


def patch_obs_html(html):
    if OBS_HTML_MARKER in html:
        if OBS_SCRIPT_NEW not in html:
            raise PatchError('observability/index.html: marker present but script version is not 2')
        return html
    html = rep(html, OBS_FOOT_OLD, OBS_FOOT_NEW, 'observability footer text')
    html = rep(html, OBS_HELP_OLD, OBS_HELP_NEW, 'observability help text')
    html = rep(html, OBS_SCRIPT_OLD, OBS_SCRIPT_NEW, 'observability script version')
    anchor = '<footer class="obs-footer">'
    if html.count(anchor) != 1:
        raise PatchError('observability/index.html: footer expected once')
    return html.replace(anchor, OBS_HTML_MARKER + '\n      ' + anchor, 1)


def patch_a11y(js):
    if A11Y_MARKER in js:
        return js
    return rep(js, A11Y_OLD, A11Y_NEW, 'agenda appointment aria labels')


# ---------------------------------------------------------------------------------------------- index
def patch_index(html):
    if HTML_MARKER in html and CSS_TAG in html:
        pass
    elif (HTML_MARKER in html) != (CSS_TAG in html):
        raise PatchError('index.html: qa-funcional-medio.css linked without its marker')
    else:
        marker = '    ' + DESIGN_MARKER
        if html.count(marker) != 1:
            raise PatchError('index.html: design-system marker expected once (run design-system.py first)')
        block = '    ' + HTML_MARKER + '\n    ' + CSS_TAG + '\n'
        html = html.replace(marker, block + marker, 1)
    if A11Y_SCRIPT_OLD in html:
        html = rep(html, A11Y_SCRIPT_OLD, A11Y_SCRIPT_NEW, 'index.html panel-a11y.js version')
    elif A11Y_SCRIPT_NEW not in html:
        raise PatchError('index.html: panel-a11y.js script expected once')
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
    bundle = open(BUNDLE, encoding='utf-8').read()
    index = open(INDEX, encoding='utf-8').read()
    obs_js = open(OBS_JS, encoding='utf-8').read()
    obs_html = open(OBS_INDEX, encoding='utf-8').read()
    a11y = open(A11Y, encoding='utf-8').read()
    css = open(CSS, encoding='utf-8').read() if os.path.exists(CSS) else ''

    missing = [name for name, _ in GROUPS if marker(name) not in bundle]
    if QA_POLISH_MARKER not in index:
        missing.append('qa-polish.css marker (run qa-polish.py first)')
    if OBS_JS_MARKER not in obs_js:
        missing.append('observability polling removed')
    if OBS_HTML_MARKER not in obs_html or OBS_SCRIPT_NEW not in obs_html:
        missing.append('observability html')
    if A11Y_MARKER not in a11y:
        missing.append('panel-a11y agenda labels')
    if HTML_MARKER not in index or CSS_TAG not in index:
        missing.append('qa-funcional-medio.css link')
    if A11Y_SCRIPT_NEW not in index:
        missing.append('panel-a11y.js?v=2')
    if css != CSS_CONTENT:
        missing.append('qa-funcional-medio.css')
    if bump_index(index) != index:
        missing.append('index.html cache version')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    # Validate and build everything in memory; write only when every anchor matched.
    new_bundle = bundle
    for name, fn in GROUPS:
        if name in missing:
            new_bundle = marker(name) + fn(new_bundle)
    new_obs_js = patch_obs_js(obs_js) if 'observability polling removed' in missing else obs_js
    new_obs_html = patch_obs_html(obs_html) if 'observability html' in missing else obs_html
    new_a11y = patch_a11y(a11y) if 'panel-a11y agenda labels' in missing else a11y
    new_index = bump_index(patch_index(index))

    if css != CSS_CONTENT:
        open(CSS, 'w', encoding='utf-8').write(CSS_CONTENT)
    if new_bundle != bundle:
        open(BUNDLE, 'w', encoding='utf-8').write(new_bundle)
    if new_obs_js != obs_js:
        open(OBS_JS, 'w', encoding='utf-8').write(new_obs_js)
    if new_obs_html != obs_html:
        open(OBS_INDEX, 'w', encoding='utf-8').write(new_obs_html)
    if new_a11y != a11y:
        open(A11Y, 'w', encoding='utf-8').write(new_a11y)
    if new_index != index:
        open(INDEX, 'w', encoding='utf-8').write(new_index)

    applied = [name for name, _ in GROUPS if name in missing]
    print('bundle groups applied: ' + (', '.join(applied) or 'none'))
    print('observability: polling removed, texts updated, observability.js?v=2')
    print('panel-a11y.js: agenda labels with separators, ?v=2')
    print('index.html: qa-funcional-medio.css ?v=1, bundle ?v=' + CACHE_VERSION)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
