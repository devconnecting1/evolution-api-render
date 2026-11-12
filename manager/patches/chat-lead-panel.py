#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Ficha do lead" inside the right side panel of Conversas (proposal B
of the design artifact: the conversation with the lead record beside it, like Frappe).

Same method as the other scripts in manager/patches: manager/dist is the upstream evolution-manager-v2 build plus
manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.
The styles live in manager/dist/assets/chat-lead-panel.css (a plain file, edited by hand, only var(--m-*) tokens,
linked after the other patch stylesheets).

What the card shows (read-only except the two existing actions):
  - status, priority (with the reason on hover) and area of the lead, from GET /leads/:instance?remoteJid=<jid>
    (the same request the Leads page and the old contact-panel row already make);
  - "aguardando a equipe desde ..." and the team's next step, when the lead has them;
  - linked court cases, from GET /processos/:instance (the Processos page listing), matched by the contact JID or
    its phone digits; an in-memory 60 s cache avoids one request per conversation and the panel only mounts while
    it is open, so there is no timer and the Neon database stays asleep;
  - "Abrir ficha completa": link to the existing lead record drawer (/manager/instance/<id>/leads?lead=<id>),
    independent of proposal A;
  - "Assumir conversa": one click, POST /openai/changeStatus/:instance {remoteJid, status: "paused"} — the same
    action of the "Pausar IA" button. When the session is paused the card offers "Retomar IA" (status "opened").
    The optimistic mark reuses the session cache of twenty-layout.py, so the "IA neste contato" row above updates
    at once and offers the same action; the header badge reads "IA ativa"/"IA pausada".
The old "Lead" row (WaLeads.ContactField) is replaced by this card; the drawer and the Leads page stay unchanged.
Next appointment keeps being rendered by the "Próximo agendamento" row that agenda.py adds to the same panel.

Bundle groups (each one is applied once and leaves a marker comment at the top of the bundle):
  component - WaLeadFx, an isolated component module (IIFE) placed right before the route table: Card (the lead
              summary described above) and its helpers.
  tw-export - WaTw.markAi(instanceName, remoteJid, status): writes the session override of the existing panel and
              notifies its subscribers (the same optimistic update of the Pausar/Retomar dialog).
  panel     - the card at the top of the contact side panel, before the fields; the old "Lead" row of the panel
              is removed (the card carries status, priority and the link to the full record). Groups keep no card.
  head      - the side panel opens by default on screens >= 1024px (an explicit close is still remembered in
              localStorage under wa-tw-panel) and its toggle reads "Ver/Fechar ficha do lead".
index.html group (marker: an HTML comment in <head>):
  html      - links chat-lead-panel.css?v=1 after the last patch stylesheet and bumps the bundle ?v= to
              CACHE_VERSION (59).

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.
Order: run after every other script (it needs twenty-layout.py, leads.py and agenda.py applied).

Usage (from the repository root):
  python3 -I manager/patches/chat-lead-panel.py           # apply
  python3 -I manager/patches/chat-lead-panel.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'chat-lead-panel.css')
REQUIRED = ('/*whatsai-patch:twenty-layout:component*/', '/*whatsai-patch:leads:contact*/',
            '/*whatsai-patch:agenda:panel*/')
CACHE_VERSION = '59'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_LINK = '    <link rel="stylesheet" href="/assets/chat-lead-panel.css?v=1" />\n'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:chat-lead-panel:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:chat-lead-panel:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


# Minified names (bundle index-b29a5d7a.js): i = jsx runtime, y = React, Ee = axios instance of the API (base URL +
# apikey), me = toast, Fu = react-router Link, enc = encodeURIComponent, WaTw = twenty-layout.py module (sessions
# cache and markAi), WaLeads.ContactField = the old "Lead" row of the contact panel (leads.py).
COMPONENT = r'''const WaLeadFx=(()=>{
  const enc=encodeURIComponent;
  const STATUS=[['novo','Novo'],['qualificado','Qualificado'],['em_atendimento','Em atendimento'],['cliente','Cliente'],['descartado','Descartado']];
  const PRIO=[['alta','Alta'],['normal','Normal'],['baixa','Baixa']];
  const lbl=(l,v)=>(l.find(x=>x[0]===v)||['',v||''])[1];
  const IC={
    users:['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z','M22 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75'],
    scale:['M12 3v18','M7 21h10','M5 7h14','M5 7l-3 7a3.5 3.5 0 0 0 6 0Z','M19 7l-3 7a3.5 3.5 0 0 0 6 0Z'],
    ext:['M15 3h6v6','M10 14 21 3','M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
    hand:['M18 11V6a2 2 0 0 0-4 0v5','M14 10V4a2 2 0 0 0-4 0v6','M10 10.5V6a2 2 0 0 0-4 0v8','M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15']
  };
  function svg(name,size){const d=IC[name]||[];return i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:size||16,height:size||16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'1.6',strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',children:d.map((p,k)=>i.jsx('path',{d:p},k))});}
  const LEAD=new Map(),PROCS=new Map();
  function cache(map,key){const c=map.get(key);return c&&Date.now()-c.at<6e4?c:null}
  function when(t){if(!t)return String(t||"");const d=new Date(t);if(isNaN(d.getTime()))return String(t);const n=new Date(),o=new Date(n);o.setDate(n.getDate()-1);const hm=d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});return d.toDateString()===n.toDateString()?'hoje às '+hm:d.toDateString()===o.toDateString()?'ontem às '+hm:d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})+' às '+hm}
  function phoneDigits(v){return String(v||"").split('@')[0].replace(/\D/g,'')}
  function errText(e){const m=e&&e.response&&e.response.data&&e.response.data.response&&e.response.data.response.message;return [].concat(m||[]).filter(x=>typeof x==='string').join(' ')}
  function Chip({tone,title,children}){return i.jsx('span',{className:'wl-chip','data-tone':tone,title:title||void 0,children})}

  function Card({instance,jid,aiState,sessionStatus}){
    const name=instance&&instance.name,key=name+'|'+jid;
    const leadCached=cache(LEAD,key),procCached=cache(PROCS,name);
    const[lead,setLead]=y.useState(()=>leadCached?leadCached.lead:void 0);
    const[procs,setProcs]=y.useState(()=>procCached?procCached.list:void 0);
    const[leadErr,setLeadErr]=y.useState(!1);
    const[busy,setBusy]=y.useState(!1);
    const[nonce,setNonce]=y.useState(0);
    y.useEffect(()=>{if(!name||!jid)return;const c=cache(LEAD,key);if(c){setLead(c.lead);setLeadErr(!1);return}let live=!0;
      Ee.get('/leads/'+enc(name),{params:{remoteJid:jid,pageSize:1}}).then(r=>{
        const l=r.data&&r.data.leads&&r.data.leads[0]||null;LEAD.set(key,{at:Date.now(),lead:l});live&&(setLead(l),setLeadErr(!1))},
        ()=>{live&&(setLead(null),setLeadErr(!0))});
      return()=>{live=!1}},[key,nonce]);
    y.useEffect(()=>{if(!name)return;const c=cache(PROCS,name);if(c){setProcs(c.list);return}let live=!0;
      Ee.get('/processos/'+enc(name)).then(r=>{const list=Array.isArray(r.data&&r.data.items)?r.data.items:[];PROCS.set(name,{at:Date.now(),list});live&&setProcs(list)},
        ()=>live&&setProcs([]));
      return()=>{live=!1}},[name]);
    const linked=y.useMemo(()=>{const b=String(jid||""),d=phoneDigits(b);return(procs||[]).filter(p=>{if(!p)return!1;const a=String(p.remoteJid||"");return!!a&&(a===b||(!!d&&phoneDigits(a)===d))})},[procs,jid]);
    const retry=()=>{LEAD.delete(key);setLead(void 0);setLeadErr(!1);setNonce(n=>n+1)};
    const sesOk=sessionStatus==='ok';
    const canAssume=!!(sesOk&&aiState&&aiState.k==='active'&&aiState.s);
    const canResume=!!(sesOk&&aiState&&aiState.k==='paused'&&aiState.s);
    const aiK=aiState&&aiState.k;
    const aiTone=sessionStatus==='error'?'bad':!sesOk?void 0:aiK==='paused'?'warn':aiK==='active'||aiK==='none'?'ok':void 0;
    const aiText=sessionStatus==='error'?'IA indisponível':!sesOk?'Carregando IA…':aiK==='paused'?'IA pausada':aiK==='closed'?'Sessão encerrada':aiK==='active'||aiK==='none'?'IA ativa':'IA';
    const act=async next=>{const s=aiState&&aiState.s;if(!s||busy)return;setBusy(!0);
      try{await Ee.post('/openai/changeStatus/'+enc(name),{remoteJid:s.remoteJid,status:next},{headers:{apikey:instance.token}});
        if(WaTw&&typeof WaTw.markAi==='function')WaTw.markAi(name,s.remoteJid,next);
        me.success(next==='paused'?'Conversa assumida: a IA fica pausada até você retomar.':'IA retomada para este contato.')}
      catch(e){const m=errText(e);me.error('Não foi possível mudar o estado da IA.'+(m?' '+m:''))}
      finally{setBusy(!1)}};
    const st=lead&&lead.status,pr=(lead&&lead.priority)||'normal';
    const stTone=st==='cliente'?'ok':st==='qualificado'?'tint':st==='descartado'?void 0:st==='em_atendimento'?'ok':'neutral';
    const prTone=pr==='alta'?'bad':pr==='normal'?'neutral':void 0;
    let body;
    if(leadErr)body=i.jsxs('div',{className:'wa-lp-empty',children:[
      i.jsx('p',{className:'wa-lp-muted',children:'Não foi possível ler a ficha do lead agora.'}),
      i.jsx('button',{type:'button',className:'wa-lp-link',onClick:retry,children:'Tentar de novo'})]});
    else if(lead===void 0)body=i.jsx('p',{className:'wa-lp-muted',children:'Carregando ficha…'});
    else if(!lead)body=i.jsxs('div',{className:'wa-lp-empty',children:[
      i.jsx('p',{className:'wa-lp-muted',children:'Sem lead ainda. A IA cria a ficha a partir da 3ª mensagem do cliente.'}),
      i.jsx(Fu,{to:'/manager/instance/'+instance.id+'/leads',className:'wa-lp-link',children:'Ver Leads'})]});
    else body=i.jsxs(i.Fragment,{children:[
      i.jsxs('div',{className:'wa-lp-chips',children:[
        i.jsx(Chip,{tone:stTone,children:lbl(STATUS,st)}),
        i.jsx(Chip,{tone:prTone,title:lead.priorityReason||void 0,children:'Prioridade '+lbl(PRIO,pr).toLowerCase()}),
        lead.area?i.jsx('span',{className:'wl-chip wl-chip--plain',children:lead.area}):null]}),
      lead.awaitingHumanSince?i.jsx('p',{className:'wa-lp-note',children:'Aguardando a equipe desde '+when(lead.awaitingHumanSince)+'.'}):null,
      lead.nextStep?i.jsxs('p',{className:'wa-lp-next',children:[i.jsx('span',{children:'Próximo passo'}),i.jsx('strong',{children:lead.nextStep})]}):null,
      i.jsxs('div',{className:'wa-lp-sec',children:[
        i.jsxs('p',{className:'wa-lp-label',children:[i.jsx('span',{children:'Processos vinculados'}),linked.length?i.jsx('span',{className:'wa-lp-count',children:linked.length}):null]}),
        linked.length?i.jsxs(i.Fragment,{children:[
          i.jsx('ul',{className:'wa-lp-procs',children:linked.slice(0,3).map(p=>i.jsxs('li',{children:[
            i.jsx('strong',{title:p.apelido||p.clientName||p.numeroCnj,children:p.apelido||p.clientName||p.numeroCnj}),
            i.jsx('span',{className:'wa-lp-mono',children:p.numeroCnj})]},p.id))}),
          linked.length>3?i.jsx(Fu,{to:'/manager/instance/'+instance.id+'/processos',className:'wa-lp-link',children:'Ver os '+linked.length+' processos'}):null]}):
        i.jsx('p',{className:'wa-lp-muted',children:procs===void 0?'Carregando processos…':'Nenhum vinculado'})]})]});
    return i.jsxs('section',{className:'wa-lp','aria-label':'Ficha do lead',children:[
      i.jsxs('header',{className:'wa-lp-head',children:[i.jsxs('h3',{className:'wa-lp-title',children:[svg('users',14),'Ficha do lead']}),
        i.jsxs('span',{className:'wa-lp-ai','data-tone':aiTone,title:aiText,children:[i.jsx('span',{className:'wa-lp-dot','aria-hidden':'true'}),aiText]})]}),
      body,
      lead||canAssume||canResume?i.jsxs('div',{className:'wa-lp-actions',children:[
        lead?i.jsxs(Fu,{to:'/manager/instance/'+instance.id+'/leads?lead='+enc(lead.id),className:'wa-tw-sbtn wa-tw-sbtn--ghost',children:[svg('ext',14),'Abrir ficha completa']}):null,
        canAssume?i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-lp-assume',disabled:busy,'aria-busy':busy?'true':void 0,onClick:()=>act('paused'),children:[svg('hand',14),busy?'Assumindo…':'Assumir conversa']}):null,
        canResume?i.jsxs('button',{type:'button',className:'wa-tw-sbtn wa-tw-sbtn--ghost',disabled:busy,'aria-busy':busy?'true':void 0,onClick:()=>act('opened'),children:[svg('hand',14),busy?'Retomando…':'Retomar IA']}):null]}):null,
      canAssume?i.jsx('p',{className:'wa-lp-hint',children:'Assumir pausa a IA e deixa a conversa com a equipe.'}):
        canResume?i.jsx('p',{className:'wa-lp-hint',children:'A IA está pausada; retome quando a equipe terminar o atendimento.'}):null]});
  }
  return{Card};
})();
'''

COMPONENT_ANCHOR = '\nconst Lse=Z2(['
TW_EXPORT_OLD = 'return{View,Shell,HeadExtra,Crumbs,Cmd,CmdButton};'
TW_EXPORT_NEW = ('return{View,Shell,HeadExtra,Crumbs,Cmd,CmdButton,markAi:(n,j,s)=>{OV.set(n+"|"+j,{status:s,at:Date.now()});'
                 'emit();}};')
PANEL_BODY_OLD = "i.jsxs('div',{className:'wa-tw-panel-body',children:["
PANEL_BODY_NEW = ("i.jsxs('div',{className:'wa-tw-panel-body',children:["
                  "group?null:i.jsx(WaLeadFx.Card,{instance,jid,aiState:a,sessionStatus:ses.status}),")
LEAD_ROW_OLD = 'group?null:i.jsx(WaLeads.ContactField,{instance,jid}),'
HEAD_OLD = "useState(()=>wide()&&ls_('wa-tw-panel')==='1')"
HEAD_NEW = "useState(()=>wide()&&ls_('wa-tw-panel')!=='0')"
LABELS_OLD = "c.open?'Fechar detalhes do contato':'Ver detalhes do contato'"
LABELS_NEW = "c.open?'Fechar ficha do lead':'Ver ficha do lead'"


def patch_component(s):
    return rep(s, COMPONENT_ANCHOR, '\n' + COMPONENT + 'const Lse=Z2([', 'route table (const Lse=Z2([)')


def patch_tw_export(s):
    return rep(s, TW_EXPORT_OLD, TW_EXPORT_NEW, 'WaTw exports (markAi)')


def patch_panel(s):
    s = rep(s, PANEL_BODY_OLD, PANEL_BODY_NEW, 'contact panel body (run twenty-layout.py first)')
    return rep(s, LEAD_ROW_OLD, '', 'contact panel "Lead" row (run leads.py first)')


def patch_head(s):
    s = rep(s, HEAD_OLD, HEAD_NEW, 'side panel default (open on desktop)')
    return rep(s, LABELS_OLD, LABELS_NEW, 'side panel toggle labels')


GROUPS = [('component', patch_component), ('tw-export', patch_tw_export), ('panel', patch_panel),
          ('head', patch_head)]


def patch_html(html):
    """chat-lead-panel.css after the last patch stylesheet (whatever patch added it)."""
    links = [m for m in re.finditer(r'^    <link rel="stylesheet"[^\n]*\n', html, re.M)]
    if not links:
        raise PatchError('index.html: no stylesheet link found')
    end = links[-1].end()
    return html[:end] + '    ' + html_marker('html') + '\n' + CSS_LINK + html[end:]


def bump_index(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag not found exactly once')
    end = pos + len(SCRIPT_TAG)
    while end < len(html) and html[end].isdigit():
        end += 1
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
    if bump_index(html) != html:
        missing.append('index.html cache version')
    if not os.path.isfile(CSS):
        missing.append('chat-lead-panel.css')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/chat-lead-panel.css is missing')
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
        report.append(f'index.html written (chat-lead-panel.css ?v=1, bundle ?v={CACHE_VERSION})')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
