#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: Integrações as a catalog (proposal J).

Before: the instance menu opened "Eventos" (4 subitems: webhook, WebSocket, RabbitMQ, SQS) and "Integrações"
(8 subitems: EvoAI, n8n, Bot Evolution, Chatwoot, Typebot, OpenAI, Dify, Flowise), 12 subitems with no hint of
what each one does or whether it is on. Now:

1. component - WaIntegrationsCatalog: the catalog page, one card per integration with a sentence, the state
               (Ligada/Desligada) and a "Configurar" link to the existing page. The rare ones sit in an "Outras"
               card; "Ver todas" expands the links in the same page. States come from the same find queries the
               integration pages already use (no new endpoint).
2. route     - /manager/instance/:instanceId/integracoes, next to the other instance routes.
3. menu      - the "Eventos" group and the "Integrações" group become a single "Integrações" item. The 12
               subitems leave the menu; every page remains reachable from the catalog and by URL.
4. pages     - the breadcrumb/command palette entry for the new page.
5. html      - links integracoes-catalogo.css and raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after atendente-ia.py (H).

Usage (from the repository root):
  python3 -I manager/patches/integracoes-catalogo.py           # apply
  python3 -I manager/patches/integracoes-catalogo.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'integracoes-catalogo.css')
CACHE_VERSION = '60'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_VERSION = '1'
CSS_TAG = '<link rel="stylesheet" href="/assets/integracoes-catalogo.css?v=' + CSS_VERSION + '" />'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:integracoes-catalogo:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


# ------------------------------------------------------------------------------------------------ 1. component
COMPONENT = r"""
const WaIntegrationsCatalog=(()=>{
  const CARDS=[
    ['openai','AI','OpenAI','A chave e o modelo usados pelo Atendente IA.','openai'],
    ['webhook','WH','Webhook','Envia mensagens e eventos para outro sistema.','webhook'],
    ['chatwoot','CW','Chatwoot','Atenda o WhatsApp dentro do Chatwoot.','chatwoot'],
    ['n8n','n8','n8n','Automações com fluxos visuais.','n8n'],
    ['typebot','TB','Typebot','Fluxos de perguntas e respostas montados no Typebot.','typebot']
  ];
  const OTHERS=[
    ['dify','DI','Dify','Agentes de IA no Dify.'],
    ['flowise','FL','Flowise','Fluxos de IA no Flowise.'],
    ['evoai','EV','EvoAI','Agentes de IA da EvoAI.'],
    ['evolutionBot','BE','Bot Evolution','Bots do Evolution API.'],
    ['websocket','WS','WebSocket','Eventos em tempo real.'],
    ['rabbitmq','RM','RabbitMQ','Eventos por fila.'],
    ['sqs','SQ','SQS','Eventos por fila na AWS.']
  ];
  function isOn(data){
    if(Array.isArray(data))return data.some(item=>item&&item.enabled!==!1&&item.enabled!==0);
    return !!(data&&(data.enabled===!0||data.enabled===1));
  }
  function Page(){
    const{instance:n}=ct();
    const[all,setAll]=y.useState(!1);
    const queries={
      openai:FI({instanceName:n?.name,token:n?.token}),
      webhook:Sse({instanceName:n?.name,token:n?.token}),
      chatwoot:hX({instanceName:n?.name,token:n?.token}),
      n8n:II({instanceName:n?.name,token:n?.token}),
      typebot:zI({instanceName:n?.name,token:n?.token})
    };
    const stateOf=key=>{const q=queries[key];return q.isLoading?null:isOn(q.data)?'on':'off'};
    const base='/manager/instance/'+(n?n.id:'')+'/';
    const cards=CARDS.map(card=>{
      const state=stateOf(card[0]);
      return i.jsxs('article',{className:'wa-int-card',children:[
        i.jsxs('div',{className:'wa-int-top',children:[
          i.jsx('span',{className:'wa-int-mono','aria-hidden':!0,children:card[1]}),
          i.jsxs('div',{children:[i.jsx('h2',{children:card[2]}),i.jsx('p',{children:card[3]})]})
        ]}),
        i.jsxs('div',{className:'wa-int-foot',children:[
          state?i.jsxs('span',{className:'wa-int-state','data-on':state==='on'?'true':'false',children:[
            i.jsx('span',{className:'wa-int-dot','aria-hidden':!0}),
            state==='on'?'Ligada':'Desligada'
          ]}):i.jsx('span',{className:'wa-int-state wa-int-loading',children:'Verificando'}),
          i.jsx(Fu,{to:base+card[4],className:'wa-int-config',children:'Configurar'})
        ]})
      ]},card[0]);
    });
    cards.push(i.jsxs('article',{className:'wa-int-card',children:[
      i.jsxs('div',{className:'wa-int-top',children:[
        i.jsx('span',{className:'wa-int-mono','aria-hidden':!0,children:'+4'}),
        i.jsxs('div',{children:[
          i.jsx('h2',{children:'Outras'}),
          i.jsx('p',{children:'Dify, Flowise, EvoAI, Bot Evolution, WebSocket, RabbitMQ e SQS.'})
        ]})
      ]}),
      i.jsxs('div',{className:'wa-int-foot',children:[
        i.jsx('span',{className:'wa-int-state',children:'Para quem integra'}),
        i.jsx('button',{type:'button',className:'wa-int-toggle','aria-expanded':all?'true':'false',
          onClick:()=>setAll(!all),children:all?'Ver menos':'Ver todas'})
      ]})
    ]},'others'));
    return i.jsxs('main',{className:'pt-5',children:[
      i.jsx('h1',{className:'wa-page-title text-lg font-medium',children:'Integrações'}),
      i.jsx('p',{className:'wa-int-desc',children:'Conecte esta instância a outros sistemas. O atendimento por IA fica em "Atendente IA".'}),
      i.jsx('div',{className:'wa-int-grid',children:cards}),
      all?i.jsxs('section',{className:'wa-int-more',children:[
        i.jsx('h2',{children:'Para quem integra'}),
        i.jsx('p',{children:'As configurações continuam nas páginas de cada integração.'}),
        i.jsx('div',{className:'wa-int-more-grid',children:OTHERS.map(item=>i.jsxs(Fu,{
          to:base+item[0],className:'wa-int-more-link',children:[
            i.jsx('span',{className:'wa-int-mono wa-int-mono-sm','aria-hidden':!0,children:item[1]}),
            i.jsxs('span',{children:[i.jsx('strong',{children:item[2]}),i.jsx('small',{children:item[3]})]})
          ]},item[0]))})
      ]}):null
    ]});
  }
  return{Page};
})();
"""
COMPONENT_ANCHOR = 'function jse(){'


def g_component(s):
    return rep(s, COMPONENT_ANCHOR, COMPONENT + COMPONENT_ANCHOR, 'WaIntegrationsCatalog before jse')


# ------------------------------------------------------------------------------------------------ 2. route
ROUTE_OLD = ('{path:"/manager/instance/:instanceId/openai",'
             'element:i.jsx(tn,{children:i.jsx(un,{children:i.jsx(Tk,{})})})},')
ROUTE_NEW = (ROUTE_OLD + '{path:"/manager/instance/:instanceId/integracoes",'
             'element:i.jsx(tn,{children:i.jsx(un,{children:i.jsx(WaIntegrationsCatalog.Page,{})})})},')


def g_route(s):
    return rep(s, ROUTE_OLD, ROUTE_NEW, 'integracoes route')


# ------------------------------------------------------------------------------------------------ 3. menu
EVENTS_OLD = ('{title:e("sidebar.events"),icon:dB,children:[{id:"webhook",title:e("sidebar.webhook"),'
              'path:"webhook"},{id:"websocket",title:e("sidebar.websocket"),path:"websocket"},'
              '{id:"rabbitmq",title:e("sidebar.rabbitmq"),path:"rabbitmq"},'
              '{id:"sqs",title:e("sidebar.sqs"),path:"sqs"}]},')
INTEGRATIONS_OLD = ('{title:e("sidebar.integrations"),icon:mT,children:[{id:"evoai",title:e("sidebar.evoai"),'
                    'path:"evoai"},{id:"n8n",title:e("sidebar.n8n"),path:"n8n"},'
                    '{id:"evolutionBot",title:e("sidebar.evolutionBot"),path:"evolutionBot"},'
                    '{id:"chatwoot",title:e("sidebar.chatwoot"),path:"chatwoot"},'
                    '{id:"typebot",title:e("sidebar.typebot"),path:"typebot"},'
                    '{id:"dify",title:e("sidebar.dify"),path:"dify"},'
                    '{id:"flowise",title:e("sidebar.flowise"),path:"flowise"}]},')
MENU_NEW = '{id:"integrations",title:e("sidebar.integrations"),icon:mT,path:"integracoes",cfg:!0},'


def g_menu(s):
    s = rep(s, EVENTS_OLD, '', 'remove Eventos group')
    return rep(s, INTEGRATIONS_OLD, MENU_NEW, 'Integrações single item')


# ------------------------------------------------------------------------------------------------ 4. pages
PAGES_OLD = "['openai','Atendente IA','bot'],['observability','Observabilidade','pulse'],"
PAGES_NEW = ("['openai','Atendente IA','bot'],['integracoes','Integrações','cog'],"
             "['observability','Observabilidade','pulse'],")


def g_pages(s):
    return rep(s, PAGES_OLD, PAGES_NEW, 'breadcrumb entry')


GROUPS = [('component', g_component), ('route', g_route), ('menu', g_menu), ('pages', g_pages)]


# ------------------------------------------------------------------------------------------------ 5. html
def patch_html(html):
    if CSS_TAG in html:
        return html
    if '/assets/integracoes-catalogo.css' in html:
        raise PatchError('index.html: integracoes-catalogo.css present with another version; edit CSS_VERSION')
    anchor = '    <link rel="stylesheet" href="/assets/atendente-ia.css?v='
    if html.count(anchor) != 1:
        raise PatchError('index.html: atendente-ia.css link expected once (apply atendente-ia.py first)')
    pos = html.find('\n', html.find(anchor)) + 1
    return html[:pos] + '    ' + CSS_TAG + '\n' + html[pos:]


def bump_css(html):
    return re.sub(r'(/assets/integracoes-catalogo\.css\?v=)(\d+)',
                  lambda m: m.group(1) + (CSS_VERSION if int(m.group(2)) < int(CSS_VERSION) else m.group(2)),
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
    if not os.path.isfile(CSS):
        missing.append('integracoes-catalogo.css')
    if patch_html(bump_css(html)) != html:
        missing.append('index.html')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/integracoes-catalogo.css is missing')
    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')
    new_html = patch_html(bump_css(html))
    new_html = bump_index(new_html)
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: integracoes-catalogo.css?v={CSS_VERSION}, bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
