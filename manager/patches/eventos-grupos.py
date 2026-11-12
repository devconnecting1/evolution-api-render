#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: event toggles in four Portuguese groups, with "Enviar teste"
(proposal I, "Eventos em grupos, com teste de envio").

Before: Webhook, WebSocket, RabbitMQ and SQS each rendered the same flat list of 26 event codes in CAPS, sorted
alphabetically and repeated on the four screens, with no way to check whether the server accepted the settings.

Now:
1. component - inserts WaEventos, a shared React component (one implementation for the four screens), right before
               the WebSocket screen. It renders the same events in four groups with a Portuguese name and the
               technical code small underneath, so whoever integrates still sees the exact code:
                 Mensagens (5), Conexão do WhatsApp (5), Conversas e contatos (10), Grupos e automações (6).
               Any event the API returns that is not in the four groups appears in an extra "Outros" group, so a
               new event is never hidden. Each group is collapsible and shows "selecionados de total"; groups with
               a selected event start open. The event state is the same form field as before (react-hook-form
               "events"), so marking, unmarking, "Marcar todos" and "Desmarcar todos" keep working and saving is
               untouched.
               "Enviar teste" posts the current form values to the same endpoint the screen's Save button already
               uses (POST /webhook|websocket|rabbitmq|sqs/set/<instance>) and shows the server response, e.g.
               "Último teste: 201 Created" or "Último teste: erro 400 — ...". It never touches the WhatsApp
               connection: only the integration settings are written. There is no test-delivery endpoint in the
               API, so the button verifies the configuration against the server instead of inventing an API.
2. screens   - the four identical event-list blocks (Webhook, WebSocket, RabbitMQ, SQS) call WaEventos with the
               integration name, the form and the instance. Titles, enabled switches, URL and the other fields stay
               exactly as they were.
3. html      - links eventos-grupos.css?v=1 after page-frame.css and raises the bundle ?v= to CACHE_VERSION (64).

The styles live in manager/dist/assets/eventos-grupos.css (plain file, only var(--m-*) tokens, light and dark).

Every anchor must match exactly once, otherwise the script stops without writing anything. Re-running is safe:
groups whose marker and code are present are skipped. Order: after every other bundle patch (it only touches the
four event screens).

Usage (from the repository root):
  python3 -I manager/patches/eventos-grupos.py           # apply
  python3 -I manager/patches/eventos-grupos.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'eventos-grupos.css')
CACHE_VERSION = '64'
CSS_VERSION = '1'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
PAGE_FRAME_LINK = '    <link rel="stylesheet" href="/assets/page-frame.css?v=1" />'
CSS_LINK = '    <link rel="stylesheet" href="/assets/eventos-grupos.css?v=' + CSS_VERSION + '" />'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:eventos-grupos:' + name + '*/'


def html_marker(name):
    return '<!-- whatsai-patch:eventos-grupos:' + name + ' -->'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


# Minified names (bundle index-b29a5d7a.js): i = jsx runtime, y = React, Ee = axios instance of the API,
# gc = Switch, l = react-hook-form of the screen, t = instance, d = the event codes, m = the events form field.

COMPONENT_ANCHOR = 'const Tse=e=>["websocket","fetchWebsocket",JSON.stringify(e)]'

# The identical event list rendered by the four screens (Webhook, WebSocket, RabbitMQ, SQS).
BLOCK = ('i.jsx(_s,{children:i.jsx("div",{className:"flex flex-col gap-2 space-y-1 divide-y",children:d.sort((g,x)=>'
         'g.localeCompare(x)).map(g=>i.jsxs("div",{className:"flex items-center justify-between gap-3 pt-3",children:'
         '[i.jsx(Nr,{className:Ie("break-all",m.value.includes(g)?"text-foreground":"text-muted-foreground"),children:g}),'
         'i.jsx(gc,{checked:m.value.includes(g),onCheckedChange:x=>{x?m.onChange([...m.value,g]):'
         'm.onChange(m.value.filter(b=>b!==g))}})]},g))})})')

SCREENS = ('webhook', 'websocket', 'rabbitmq', 'sqs')

COMPONENT = r'''const WaEventosGroups=[
  {name:'Mensagens',items:[
    ['MESSAGES_SET','Conversa importada'],
    ['MESSAGES_UPSERT','Mensagem recebida ou enviada'],
    ['MESSAGES_UPDATE','Mensagem lida ou entregue'],
    ['MESSAGES_DELETE','Mensagem apagada'],
    ['SEND_MESSAGE','Mensagem enviada pelo sistema']]},
  {name:'Conexão do WhatsApp',items:[
    ['APPLICATION_STARTUP','API iniciada'],
    ['QRCODE_UPDATED','QR Code atualizado'],
    ['CONNECTION_UPDATE','Conexão aberta ou fechada'],
    ['REMOVE_INSTANCE','Instância removida'],
    ['LOGOUT_INSTANCE','Instância desconectada']]},
  {name:'Conversas e contatos',items:[
    ['CONTACTS_SET','Contatos sincronizados'],
    ['CONTACTS_UPSERT','Contato criado ou atualizado'],
    ['CONTACTS_UPDATE','Contato alterado'],
    ['PRESENCE_UPDATE','Status online ou offline'],
    ['CHATS_SET','Conversas sincronizadas'],
    ['CHATS_UPSERT','Conversa criada ou atualizada'],
    ['CHATS_UPDATE','Conversa alterada'],
    ['CHATS_DELETE','Conversa apagada'],
    ['LABELS_EDIT','Etiqueta criada ou alterada'],
    ['LABELS_ASSOCIATION','Etiqueta aplicada a uma conversa']]},
  {name:'Grupos e automações',items:[
    ['GROUPS_UPSERT','Grupo criado ou atualizado'],
    ['GROUP_UPDATE','Grupo alterado'],
    ['GROUP_PARTICIPANTS_UPDATE','Participantes do grupo alterados'],
    ['CALL','Chamada recebida'],
    ['TYPEBOT_START','Typebot iniciado'],
    ['TYPEBOT_CHANGE_STATUS','Typebot mudou de estado']]}
];
const WaEventos=(props)=>{
  const events=Array.isArray(props.events)?props.events:[];
  const value=Array.isArray(props.value)?props.value:[];
  const onChange=props.onChange,form=props.form,instance=props.instance,integration=props.integration;
  const known=WaEventosGroups.reduce((all,g)=>all.concat(g.items.map(it=>it[0])),[]);
  const extra=events.filter(code=>!known.includes(code));
  const groups=extra.length?WaEventosGroups.concat([{name:'Outros',items:extra.map(code=>[code,code])}]):WaEventosGroups;
  const[open,setOpen]=y.useState([]),[touched,setTouched]=y.useState([]);
  const[testing,setTesting]=y.useState(!1),[result,setResult]=y.useState(null);
  const groupOpen=name=>{
    if(touched.includes(name))return open.includes(name);
    const g=groups.find(x=>x.name===name);
    return !!g&&g.items.some(it=>value.includes(it[0]));
  };
  const toggleGroup=name=>{
    const next=!groupOpen(name);
    setTouched(list=>list.includes(name)?list:list.concat([name]));
    setOpen(list=>next?list.concat([name]):list.filter(x=>x!==name));
  };
  const toggle=(code,on)=>onChange(on?value.concat([code]):value.filter(c=>c!==code));
  const count=items=>items.filter(it=>value.includes(it[0])).length;
  const test=async()=>{
    if(!instance||!instance.name){setResult({ok:false,text:'Instância não encontrada.'});return}
    const values=form.getValues();
    if(integration==='webhook'&&(!values.url||!values.url.trim())){setResult({ok:false,text:'Informe o endereço (URL) antes de testar.'});return}
    const data=integration==='webhook'
      ?{enabled:values.enabled,url:values.url,events:values.events,base64:values.base64,byEvents:values.byEvents}
      :{enabled:values.enabled,events:values.events};
    const body={};body[integration]=data;
    setTesting(!0);setResult(null);
    try{
      const res=await Ee.post('/'+integration+'/set/'+instance.name,body,{headers:{apikey:instance.token}});
      setResult({ok:true,text:'Último teste: '+res.status+' '+(res.statusText||'OK')});
    }catch(err){
      const status=err&&err.response&&err.response.status;
      const msg=err&&err.response&&err.response.data&&err.response.data.response&&err.response.data.response.message||err&&err.message||'Falha na conexão';
      setResult({ok:false,text:'Último teste: erro'+(status?' '+status:'')+' — '+msg});
    }finally{setTesting(!1)}
  };
  const chevron=i.jsx('svg',{xmlns:'http://www.w3.org/2000/svg',width:14,height:14,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false',children:i.jsx('path',{d:'M9 6l6 6-6 6'})});
  return i.jsx('div',{className:'wa-eventos',children:[
    i.jsx('div',{className:'wa-eventos-toolbar',children:[
      i.jsx('button',{type:'button',className:'wa-eventos-test',onClick:test,disabled:testing,children:testing?'Enviando...':'Enviar teste'}),
      i.jsx('p',{className:'wa-eventos-hint',children:'Salva a configuração atual e mostra a resposta da API.'})]}),
    result?i.jsx('p',{className:'wa-eventos-result '+(result.ok?'is-ok':'is-bad'),role:'status','aria-live':'polite',children:result.text}):null,
    groups.map(group=>i.jsxs('div',{className:'wa-eventos-group',children:[
      i.jsxs('button',{type:'button',className:'wa-eventos-head','aria-expanded':groupOpen(group.name)?'true':'false',onClick:()=>toggleGroup(group.name),children:[
        i.jsx('span',{className:'wa-eventos-chev','aria-hidden':'true',children:chevron}),
        i.jsx('span',{className:'wa-eventos-htext',children:group.name}),
        i.jsx('span',{className:'wa-eventos-count',children:count(group.items)+' de '+group.items.length})]}),
      groupOpen(group.name)?i.jsx('div',{className:'wa-eventos-list',children:group.items.map(item=>i.jsxs('div',{className:'wa-eventos-row',children:[
        i.jsxs('div',{className:'wa-eventos-text',children:[
          i.jsx('span',{className:'wa-eventos-name',children:item[1]}),
          i.jsx('code',{className:'wa-eventos-code',children:item[0]})]}),
        i.jsx(gc,{checked:value.includes(item[0]),onCheckedChange:on=>toggle(item[0],!!on),'aria-label':item[1]+' ('+item[0]+')'})]},item[0]))}):null
    ]},group.name))
  ]});
};
'''


def patch_component(s):
    if marker('component') in s and 'const WaEventos=' in s:
        return s
    return rep(s, COMPONENT_ANCHOR, marker('component') + COMPONENT + COMPONENT_ANCHOR,
               'WaEventos before the WebSocket screen')


def screen_new(integration):
    return marker('screen') + ('i.jsx(WaEventos,{events:d,value:m.value,onChange:m.onChange,form:l,instance:t,'
                               'integration:"' + integration + '",t:e})')


def screen_old(integration):
    return 'e("' + integration + '.form.events.label")}),' + BLOCK


def patch_screens(s):
    for integration in SCREENS:
        new = screen_new(integration)
        if new in s:
            continue
        s = rep(s, screen_old(integration), 'e("' + integration + '.form.events.label")}),' + new,
                integration + ' event list')
    return s


def patch_html(html):
    if html_marker('html') not in html:
        old = PAGE_FRAME_LINK + '\n'
        new = PAGE_FRAME_LINK + '\n    ' + html_marker('html') + '\n' + CSS_LINK + '\n'
        if html.count(old) != 1:
            raise PatchError('index.html: page-frame.css link not found exactly once')
        html = html.replace(old, new, 1)
    return bump_index(html)


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


def screens_applied(s):
    return all(screen_new(i) in s for i in SCREENS)


def check_missing(s, html):
    missing = []
    if marker('component') not in s or 'const WaEventos=' not in s:
        missing.append('component')
    if not screens_applied(s):
        missing.append('screens')
    if BLOCK in s:
        missing.append('old flat event list still present')
    if html_marker('html') not in html:
        missing.append('html')
    if not os.path.isfile(CSS):
        missing.append('eventos-grupos.css')
    if CSS_LINK not in html:
        missing.append('eventos-grupos.css link')
    if bump_index(html) != html:
        missing.append('index.html bundle version')
    return missing


def main():
    check = '--check' in sys.argv[1:]
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()

    if check:
        missing = check_missing(s, html)
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/eventos-grupos.css is missing')

    report = []
    if marker('component') in s and 'const WaEventos=' in s:
        report.append('component: already applied')
    else:
        s = patch_component(s)
        report.append('component: applied')
    if screens_applied(s):
        report.append('screens: already applied')
    else:
        s = patch_screens(s)
        report.append('screens: applied')
    new_html = patch_html(html)

    missing = check_missing(s, new_html)
    if missing:
        raise PatchError(f'still missing after apply: {missing}')

    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: eventos-grupos.css ?v={CSS_VERSION}, bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
