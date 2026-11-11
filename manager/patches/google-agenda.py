#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Conectar Google Agenda" on the Agenda page.

API (same release): GET /agenda/google/:instance (status, never the tokens), POST /agenda/google/:instance/connect
({url} of the Google consent screen) and DELETE /agenda/google/:instance (revokes at Google). The callback of Google
(GET /agenda/google/callback) sends the browser back to /manager/instance/<id>/agenda?google=ok|erro&msg=...
The client of the office (code wac_ with the Agenda module) may use the same three routes: the button is for them too.

1. button  - WaAgenda.Google, in the header of the Agenda page before "Configurações":
             not connected: "Conectar Google Agenda" (goes to Google in the same tab);
             connected: "Google Agenda" with a green dot (amber with an error) and a popover with the account, the
             last copy, the error when there is one ("Conectar de novo") and "Desconectar" (asks first).
             Nothing is shown while the server has no GOOGLE_CLIENT_ID (status.available = false).
2. return  - the Agenda page reads ?google=ok|erro&msg= once (toast) and removes it from the address bar.
3. hint    - "Onde a agenda fica" in the settings drawer points to the button instead of "próxima versão".
4. html    - agenda.css?v=2 (styles of the button and popover) and the bundle ?v= raised to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after agenda.py and instance-shell.py.

Usage (from the repository root):
  python3 -I manager/patches/google-agenda.py           # apply
  python3 -I manager/patches/google-agenda.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
REQUIRED = ('/*whatsai-patch:agenda:component*/',)
CACHE_VERSION = '45'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
AGENDA_CSS_VERSION = '2'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:google-agenda:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:google-agenda:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


PAGE_ANCHOR = "  function Page(){\n    const{instance:g}=ct();\n    const narrow=typeof window"

GOOGLE = r"""  function Google({instance}){
    const name=instance.name,ref=y.useRef(null);
    const[st,setSt]=y.useState(null),[open,setOpen]=y.useState(!1),[busy,setBusy]=y.useState(!1);
    const load=y.useCallback(async()=>{try{const r=await Ee.get('/agenda/google/'+enc(name));setSt(r.data||null)}catch{setSt(null)}},[name]);
    y.useEffect(()=>{load()},[load]);
    y.useEffect(()=>{if(!open)return;const k=e=>{if(e.key==='Escape')setOpen(!1)},c=e=>{ref.current&&!ref.current.contains(e.target)&&setOpen(!1)};
      window.addEventListener('keydown',k);document.addEventListener('mousedown',c);return()=>{window.removeEventListener('keydown',k);document.removeEventListener('mousedown',c)}},[open]);
    if(!st||!st.available)return null;
    const connect=async()=>{setBusy(!0);try{const r=await Ee.post('/agenda/google/'+enc(name)+'/connect');if(!r.data?.url)throw new Error('');window.location.assign(r.data.url)}catch(e){me.error(errText(e)||'Não foi possível abrir o Google agora.');setBusy(!1)}};
    const disconnect=async()=>{
      const q='Desconectar o Google Agenda?',t='Os próximos agendamentos deixam de ir para o Google e os compromissos de lá deixam de bloquear horários. O que já foi copiado continua no Google.';
      const ok=window.WaPortal&&window.WaPortal.ask?await window.WaPortal.ask({title:q,text:t,action:'Desconectar',danger:!0}):window.confirm(q+'\n\n'+t);
      if(!ok)return;setBusy(!0);try{await Ee.delete('/agenda/google/'+enc(name));me.success('Google Agenda desconectado.');setOpen(!1);await load()}catch(e){me.error(errText(e))}finally{setBusy(!1)}};
    if(!st.connected)return h('button',{type:'button',className:'wag-btn wag-btn-ghost wag-gbtn',disabled:busy,onClick:connect,title:'Os agendamentos vão para o seu Google Agenda e os compromissos de lá bloqueiam esses horários'},svg('cal',14),busy?'Abrindo o Google…':'Conectar Google Agenda');
    const bad=st.status==='error';
    return h('div',{className:'wag-gwrap',ref},
      h('button',{type:'button',className:'wag-btn wag-btn-ghost wag-gbtn','aria-expanded':open?'true':'false','aria-haspopup':'dialog',onClick:()=>setOpen(!open)},h('span',{className:'wag-gdot','data-tone':bad?'bad':'ok','aria-hidden':'true'}),'Google Agenda'),
      open?h('div',{className:'wag-gpop',role:'dialog','aria-label':'Google Agenda'},
        h('p',{className:'wag-gtitle'},bad?'Google Agenda com problema':'Google Agenda conectado'),
        h('p',{className:'wag-gmail'},st.email||'Conta Google'),
        bad&&st.lastError?h('p',{className:'wag-gerr',role:'alert'},st.lastError):h('p',{className:'wag-hint'},'Agendamentos novos, remarcados e cancelados vão para o Google. Compromissos que você marcar lá bloqueiam esses horários para a IA.'),
        st.lastSyncAt?h('p',{className:'wag-hint'},'Última cópia: '+new Date(st.lastSyncAt).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})):null,
        h('div',{className:'wag-gactions'},bad?h('button',{type:'button',className:'wag-btn wag-btn-sm',disabled:busy,onClick:connect},'Conectar de novo'):null,
          h('button',{type:'button',className:'wag-btn wag-btn-danger-ghost wag-btn-sm',disabled:busy,onClick:disconnect},'Desconectar'))):null);
  }

"""


def g_button(s):
    s = rep(s, PAGE_ANCHOR, GOOGLE + PAGE_ANCHOR, 'Google component before Page')
    old = ("h('div',{className:'wag-head-actions'},h('button',{type:'button',className:'wag-btn wag-btn-ghost',"
           "disabled:!s,onClick:()=>setDlg({kind:'settings'})}")
    new = ("h('div',{className:'wag-head-actions'},h(Google,{instance:g}),h('button',{type:'button',"
           "className:'wag-btn wag-btn-ghost',disabled:!s,onClick:()=>setDlg({kind:'settings'})}")
    return rep(s, old, new, 'header actions')


RETURN_OLD = "    y.useEffect(()=>{try{localStorage.setItem('wag-view',view)}catch{}},[view]);\n    if(!g)return null;"
RETURN_NEW = (
    "    y.useEffect(()=>{try{localStorage.setItem('wag-view',view)}catch{}},[view]);\n"
    "    y.useEffect(()=>{const q=new URLSearchParams(window.location.search),gs=q.get('google');if(!gs)return;"
    "if(gs==='ok')me.success('Google Agenda conectado. Os próximos agendamentos já estão sendo copiados.');"
    "else me.error(q.get('msg')||'Não foi possível conectar o Google Agenda.');q.delete('google');q.delete('msg');"
    "const rest=q.toString();window.history.replaceState(window.history.state,'',window.location.pathname+(rest?'?'+rest:'')+window.location.hash)},[]);\n"
    "    if(!g)return null;"
)


def g_return(s):
    return rep(s, RETURN_OLD, RETURN_NEW, 'return toast')


HINT_OLD = "hint:'Hoje só a agenda interna do WhatsAI. O Google Calendar entra como outro provedor em uma próxima versão.'"
HINT_NEW = ("hint:'A agenda do WhatsAI é a principal. Para usar o Google Agenda junto, clique em \"Conectar Google Agenda\" "
            "no topo da página: os agendamentos vão para lá e os compromissos de lá bloqueiam horários.'")


def g_hint(s):
    return rep(s, HINT_OLD, HINT_NEW, 'provider hint')


GROUPS = [('button', g_button), ('return', g_return), ('hint', g_hint)]


def bump_css(html):
    return re.sub(r'(/assets/agenda\.css\?v=)(\d+)',
                  lambda m: m.group(1) + (AGENDA_CSS_VERSION if int(m.group(2)) < int(AGENDA_CSS_VERSION) else m.group(2)),
                  html)


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
    if html_marker('html') not in html:
        missing.append('html')
    if bump_index(bump_css(html)) != html:
        missing.append('index.html versions')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    for req in REQUIRED:
        if req not in s:
            raise PatchError(f'run the patch that adds {req} first')
    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = html
    if 'html' in missing:
        new_html = rep(new_html, '</head>', '    ' + html_marker('html') + '\n  </head>', 'index.html </head>')
    new_html = bump_index(bump_css(new_html))
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: agenda.css?v={AGENDA_CSS_VERSION}, bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
