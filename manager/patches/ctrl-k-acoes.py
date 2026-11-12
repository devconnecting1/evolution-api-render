#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: actions in the Ctrl K command menu (proposal E, "Ctrl K com ações").

Before: Ctrl K searched conversations and opened pages only. Now the menu also runs the actions that already exist as
buttons, grouped by the screen that is open:

  Nesta conversa (only with a conversation open, never a group)
    - Pausar/Retomar a IA neste contato (only when the contact already has an AI session, which is when the contact
      panel offers the button; without a session or with the sessions request failed the item is hidden): opens the
      same contact panel and presses the real "Pausar IA" / "Retomar IA" button, so the confirmation dialog of
      twenty-layout.py stays with the person (same action as the P shortcut of help-menu.py; no second key handler is
      added here). The label follows the panel: "Pausar" when the session is active, "Retomar" when it is paused or
      closed.
    - Marcar agendamento: goes to Agenda and presses the existing "Novo agendamento" button (the Create drawer).
    - Mudar status do lead: reads the lead of the contact with the same query of the "Lead" row (ContactField of
      leads.py) and opens the existing lead panel (/leads?lead=), where the status selector already lives.
  Criar
    - Novo agendamento: same Agenda button as above.
    - Adicionar processo pelo número CNJ: goes to Processos and presses the existing "Adicionar processo" button
      (the AddDialog with the check-digit validation).
  Ir para
    - Leads aguardando equipe: goes to Leads and presses the existing "Aguardando equipe" segment (the view is kept
      in wa-leads-view like a manual click).
    - Exportar planilha de leads: goes to Leads and presses the existing "Exportar planilha" button (leads-xlsx.py).

No new API route, no write: the only request is the same GET /leads/:instance?remoteJid=...&pageSize=1 that the
contact panel already makes to show the lead. The page buttons are pressed only after they appear (MutationObserver,
8 s), so the action never invents a request of its own.

The search keeps working as before. With a query, matching actions come first ("Ações"), then conversations and
pages; without a query the groups are "Nesta conversa", "Criar", "Ir para" and "Conversas recentes". The P shortcut
shown on the pause/resume item is the one help-menu.py already documents; no shortcut is registered twice.

Bundle groups (marker at the top of the bundle): icons (scale/down), actions (items), items, run, opt, blocks and
search (placeholder and labels). index.html gets ctrl-k-acoes.css and the bundle ?v= bump.
Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.
Order: after help-menu.py (it owns the header and help-shortcuts.js) and after leads-xlsx.py, agenda.py and
processos.py (their buttons and labels are the anchors).

Usage (from the repository root):
  python3 -I manager/patches/ctrl-k-acoes.py           # apply
  python3 -I manager/patches/ctrl-k-acoes.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'ctrl-k-acoes.css')
CACHE_VERSION = '63'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_TAG = '    <link rel="stylesheet" href="/assets/ctrl-k-acoes.css?v=1" />\n'
CSS_ANCHOR = '    <link rel="stylesheet" href="/assets/help-menu.css?v=1" />\n'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:ctrl-k-acoes:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:ctrl-k-acoes:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


# ---------------------------------------------------------------------------------------------------------------- icons
IC_OLD = "play:['m10 8 6 4-6 4V8Z','M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z']};"
IC_NEW = ("play:['m10 8 6 4-6 4V8Z','M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],"
          "scale:['M12 3v18','M7 21h10','M5 7h14','M5 7l-3 7a3.5 3.5 0 0 0 6 0Z','M19 7l-3 7a3.5 3.5 0 0 0 6 0Z'],"
          "down:['M12 3v12','m7 10 5 5 5-5','M5 21h14']};")


def g_icons(s):
    return rep(s, IC_OLD, IC_NEW, 'WaTw icons')


# --------------------------------------------------------------------------------------------------------------- actions
CONVS_OLD = "    const convs=found.map(c=>({kind:'chat',id:'c-'+c.remoteJid.replace(/[^\\w]/g,'_'),c}));\n"
CONVS_NEW = CONVS_OLD + r'''    const seg=String(location.pathname||'').match(/^\/manager\/instance\/[^/]+\/chat\/([^/?#]+)/),jid=seg?decodeURIComponent(seg[1]):'',inChat=!!jid&&!/@g\.us$/.test(jid);
    const chatNow=inChat?all.find(c=>c&&c.remoteJid===jid)||null:null,chatTitle=chatNow?waCTitle(chatNow):'';
    const sesNow=S.get(g&&g.name),sesChat=sesNow&&sesNow.status==='ok'?sessionFor(index(sesNow.list),{remoteJid:jid}):null,iaK=sesChat?aiState(g&&g.name,sesChat).k:'none',aiOk=!!sesChat&&iaK!=='none';
    const actsChat=inChat?[
      ...(aiOk?[{kind:'act',id:'a-ia',act:'pausar-ia',ic:'pause',label:iaK==='active'?'Pausar a IA neste contato':'Retomar a IA neste contato',meta:'',kbd:'P'}]:[]),
      {kind:'act',id:'a-marcar',act:'marcar-agendamento',ic:'cal',label:'Marcar agendamento',meta:'Agenda'},
      {kind:'act',id:'a-status',act:'mudar-status',ic:'users',label:'Mudar status do lead',meta:'Leads'}]:[];
    const actsCriar=[
      {kind:'act',id:'a-novo-ag',act:'novo-agendamento',ic:'cal',label:'Novo agendamento',meta:'Agenda'},
      {kind:'act',id:'a-novo-proc',act:'novo-processo',ic:'scale',label:'Adicionar processo pelo número CNJ',meta:'Processos'}];
    const actsIr=[
      {kind:'act',id:'a-aguardando',act:'leads-aguardando',ic:'users',label:'Leads aguardando equipe',meta:'Leads'},
      {kind:'act',id:'a-exportar',act:'exportar-leads',ic:'down',label:'Exportar planilha de leads',meta:'Excel'}];
    const filtA=arr=>arr.filter(it=>!nq||waCNorm(it.label+' '+(it.meta||'')).includes(nq));
    const fChat=filtA(actsChat),fCriar=filtA(actsCriar),fIr=filtA(actsIr),fActs=fChat.concat(fCriar).concat(fIr);
'''


def g_actions(s):
    return rep(s, CONVS_OLD, CONVS_NEW, 'action list (after conversation results)')


# ----------------------------------------------------------------------------------------------------------------- items
ITEMS_OLD = "    const items=nq?convs.concat(pages):pages.concat(convs),cur=Math.min(ix,Math.max(0,items.length-1));\n"
ITEMS_NEW = ("    const items=nq?fActs.concat(convs).concat(pages):fChat.concat(fCriar).concat(fIr).concat(pages).concat(convs),"
             "cur=Math.min(ix,Math.max(0,items.length-1));\n")


def g_items(s):
    return rep(s, ITEMS_OLD, ITEMS_NEW, 'items order')


# ------------------------------------------------------------------------------------------------------------------- run
RUN_OLD = ("    const run=it=>{if(!it)return;close();if(it.kind==='chat')nav('/manager/instance/'+g.id+'/chat/'+it.c.remoteJid);"
           "else nav('/manager/instance/'+g.id+'/'+it.k)};\n")
RUN_NEW = r'''    const act=id=>{
      const base='/manager/instance/'+g.id;
      const go=p=>{if(String(location.pathname||'')!==base+p)nav(base+p)};
      const btn=(label,on)=>{const bs=document.querySelectorAll('button');for(let i=0;i<bs.length;i++){const b=bs[i];if(on&&b.disabled)continue;const t=(b.textContent||'').replace(/\s+/g,' ').trim();if(t===label||t.indexOf(label)===0)return b}return null};
      const when=(find,fn,fail)=>{const now=find();if(now){fn(now);return}
        const obs=new MutationObserver(()=>{const el=find();if(el){obs.disconnect();clearTimeout(timer);fn(el)}});
        const timer=setTimeout(()=>{obs.disconnect();fail&&fail()},8e3);
        obs.observe(document.body,{childList:!0,subtree:!0,attributes:!0,attributeFilter:['disabled','aria-disabled']})};
      if(id==='pausar-ia'){const info=document.getElementById('wa-tw-info');if(!info){me.error('Abra uma conversa para pausar a IA.');return}
        if(!document.getElementById('wa-tw-panel'))info.click();
        when(()=>{const p=document.getElementById('wa-tw-panel');if(!p)return null;const bs=p.querySelectorAll('button');for(let i=0;i<bs.length;i++){const t=(bs[i].textContent||'').replace(/\s+/g,' ').trim();if(t==='Pausar IA'||t==='Retomar IA')return bs[i]}return null},b=>b.click(),()=>me.error('Não foi possível pausar ou retomar a IA por aqui. Abra os detalhes do contato.'));return}
      if(id==='mudar-status'){if(!g.name){nav(base+'/leads');return}
        Ee.get('/leads/'+encodeURIComponent(g.name),{params:{remoteJid:jid,pageSize:1}}).then(r=>{const l=r.data&&Array.isArray(r.data.leads)?r.data.leads[0]:null;nav(base+'/leads'+(l?'?lead='+encodeURIComponent(l.id):''))},()=>nav(base+'/leads'));return}
      if(id==='marcar-agendamento'||id==='novo-agendamento'){go('/agenda');when(()=>btn('Novo agendamento',!0),b=>b.click(),()=>me.error('A Agenda não abriu o novo agendamento. Tente de novo.'));return}
      if(id==='novo-processo'){go('/processos');when(()=>btn('Adicionar processo',!0),b=>b.click(),()=>me.error('A página de Processos não abriu o formulário. Tente de novo.'));return}
      if(id==='leads-aguardando'){go('/leads');when(()=>{const bs=document.querySelectorAll('.wa-tw-segs button');for(let i=0;i<bs.length;i++){const t=(bs[i].textContent||'').replace(/\s+/g,' ').trim();if(t.indexOf('Aguardando equipe')===0)return bs[i]}return null},b=>b.click(),()=>me.error('A página de Leads não abriu o filtro. Tente de novo.'));return}
      if(id==='exportar-leads'){go('/leads');when(()=>btn('Exportar planilha',!0),b=>b.click(),()=>me.error('Não há leads para exportar agora.'));return}
    };
    const run=it=>{if(!it)return;close();if(it.kind==='act')return act(it.act);if(it.kind==='chat')nav('/manager/instance/'+g.id+'/chat/'+it.c.remoteJid);else nav('/manager/instance/'+g.id+'/'+it.k)};
'''


def g_run(s):
    return rep(s, RUN_OLD, RUN_NEW, 'run (actions and pages)')


# ------------------------------------------------------------------------------------------------------------------- opt
OPT_OLD = "children:it.kind==='page'?["
OPT_NEW = ("children:it.kind==='act'?[i.jsx('span',{className:'wa-tw-cmd-ic',children:svg(it.ic,16)},'i'),"
           "i.jsx('span',{className:'wa-tw-cmd-lb',children:it.label},'l'),"
           "i.jsx('span',{className:'wa-tw-cmd-meta',children:[it.meta?i.jsx('span',{children:it.meta},'t'):null,"
           "it.kbd?i.jsx('kbd',{className:'wa-tw-kbd wa-tw-cmd-kbd',children:it.kbd},'k'):null]},'m')]:"
           "it.kind==='page'?[")


def g_opt(s):
    return rep(s, OPT_OLD, OPT_NEW, 'option rendering (actions)')


# ---------------------------------------------------------------------------------------------------------------- blocks
BLOCKS_OLD = ("    const blocks=nq?[group(convTitle,convs,0,'wa-tw-cmd-gc'),group('Ir para',pages,convs.length,'wa-tw-cmd-gp')]:"
              "[group('Ir para',pages,0,'wa-tw-cmd-gp'),group(convTitle,convs,pages.length,'wa-tw-cmd-gc')];\n")
BLOCKS_NEW = r'''    const blocks=nq?[group('Ações',fActs,0,'wa-tw-cmd-ga'),group(convTitle,convs,fActs.length,'wa-tw-cmd-gc'),group('Ir para',pages,fActs.length+convs.length,'wa-tw-cmd-gp')]:[
      group('Nesta conversa'+(chatTitle?' ('+chatTitle+')':''),fChat,0,'wa-tw-cmd-gv'),
      group('Criar',fCriar,fChat.length,'wa-tw-cmd-gn'),
      group('Ir para',fIr.concat(pages),fChat.length+fCriar.length,'wa-tw-cmd-gp'),
      group(convTitle,convs,fChat.length+fCriar.length+fIr.length+pages.length,'wa-tw-cmd-gc')];
'''


def g_blocks(s):
    return rep(s, BLOCKS_OLD, BLOCKS_NEW, 'groups and offsets')


# ---------------------------------------------------------------------------------------------------------------- search
SEARCH_OLD = "placeholder:'Buscar conversa por nome ou número, ou ir para uma página…',"
SEARCH_NEW = "placeholder:'Buscar conversa, ação ou página…',"
ARIA_OLD = "role:'combobox','aria-expanded':'true','aria-controls':'wa-tw-cmd-list','aria-autocomplete':'list','aria-activedescendant':items[cur]?'wa-tw-cmd-'+items[cur].id:void 0,'aria-label':'Buscar',"
ARIA_NEW = "role:'combobox','aria-expanded':'true','aria-controls':'wa-tw-cmd-list','aria-autocomplete':'list','aria-activedescendant':items[cur]?'wa-tw-cmd-'+items[cur].id:void 0,'aria-label':'Buscar ou executar uma ação',"
BTN_OLD = "'aria-label':'Buscar conversas e páginas','aria-keyshortcuts':"
BTN_NEW = "'aria-label':'Buscar conversas, ações e páginas','aria-keyshortcuts':"


def g_search(s):
    s = rep(s, SEARCH_OLD, SEARCH_NEW, 'search placeholder')
    s = rep(s, ARIA_OLD, ARIA_NEW, 'search aria-label')
    return rep(s, BTN_OLD, BTN_NEW, '"Buscar" button label')


FOOT_OLD = "i.jsx('span',{children:'Enter abrir'})"
FOOT_NEW = "i.jsx('span',{children:'Enter abrir ou executar'})"


def g_foot(s):
    return rep(s, FOOT_OLD, FOOT_NEW, 'footer hint')


GROUPS = [('icons', g_icons), ('actions', g_actions), ('items', g_items), ('run', g_run), ('opt', g_opt),
          ('blocks', g_blocks), ('search', g_search), ('foot', g_foot)]

CSS_TEXT = '''/*
 * WhatsAI Manager: ações no menu Ctrl K (manager/patches/ctrl-k-acoes.py, proposta E).
 * O menu continua sendo o .wa-tw-cmd do twenty-layout.css; aqui só o alinhamento do atalho e do texto de apoio.
 * Só tokens var(--m-*).
 */
/*whatsai-patch:ctrl-k-acoes:css*/
.wa-tw-cmd-meta.wa-tw-cmd-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.wa-tw-cmd-meta .wa-tw-kbd {
  margin: 0;
}
'''


def patch_html(html):
    if CSS_TAG not in html:
        if html.count(CSS_ANCHOR) != 1:
            raise PatchError('index.html: help-menu.css link expected once')
        html = html.replace(CSS_ANCHOR, CSS_ANCHOR + CSS_TAG, 1)
    if html_marker('html') not in html:
        if html.count('</head>') != 1:
            raise PatchError('index.html: </head> expected once')
        html = html.replace('</head>', '    ' + html_marker('html') + '\n  </head>', 1)
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
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    missing = [name for name, _ in GROUPS if marker(name) not in s]
    if html_marker('html') not in html or CSS_TAG not in html:
        missing.append('html')
    if bump_index(html) != html:
        missing.append('index.html cache version')
    if not os.path.isfile(CSS):
        missing.append('ctrl-k-acoes.css')
    if os.path.isfile(CSS) and open(CSS, encoding='utf-8').read() != CSS_TEXT:
        missing.append('ctrl-k-acoes.css content')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = patch_html(html)
    new_html = bump_index(new_html)
    open(CSS, 'w', encoding='utf-8').write(CSS_TEXT)
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: ctrl-k-acoes.css, bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
