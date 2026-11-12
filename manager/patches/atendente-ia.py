#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: Atendente IA with sections and plain language (proposal H).

Before: the screen that defines how the AI serves the office lived in Integrações > OpenAI. It was one long form
with API terms ("Tipo de Bot: Chat Completion", "Mensagens do Assistente", "Carregar Modelos") and four buttons on
top. Now:

1. component - WaAI: the section navigation (aria-current, data-sec on the form) and the per-section footer with
               "Descartar" and "Salvar alterações" (the footer is not rendered inside the create dialog).
2. form      - the bot form groups the existing fields into sections (Identidade, Modelo e chave, Instruções,
               Quando responder, Avançado, Pausa humana, Mensagens longas, Mídia). Only one section is visible at a
               time; the fields, the react-hook-form state and the submit calls are the same. The duplicate bottom
               save is hidden by the CSS, every section has its own save. Sections with fields that only exist for
               the "Conversa com o modelo" type disappear from the navigation for the assistant type.
3. page      - the page title gets a one-line description and a "Testar uma conversa" link to Conversas; the bot
               list shows "Assistente da OpenAI" / "Conversa com o modelo" instead of the raw API bot type.
4. menu      - "Atendente IA" is a top-level item of the instance menu (under "Ajustes da instância") and no longer
               a subitem of Integrações. The breadcrumb and the Ctrl K menu use the same name.
5. texts     - pt-BR labels in the office's language ("Instruções para a IA", "Chave da OpenAI", "Modelo",
               "Quando a IA responde", "Salvar alterações"...). Only labels; keys and API payloads are untouched.
6. html      - links atendente-ia.css and raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after the other panel patches.

Usage (from the repository root):
  python3 -I manager/patches/atendente-ia.py           # apply
  python3 -I manager/patches/atendente-ia.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CSS = os.path.join(ROOT, 'manager', 'dist', 'assets', 'atendente-ia.css')
CACHE_VERSION = '53'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CSS_VERSION = '1'
CSS_TAG = '<link rel="stylesheet" href="/assets/atendente-ia.css?v=' + CSS_VERSION + '" />'


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:atendente-ia:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


# ------------------------------------------------------------------------------------------------ 1. component
COMPONENT = r"""
const WaAI=(()=>{
  const SECS=[['identidade','Identidade'],['modelo','Modelo e chave'],['instrucoes','Instruções'],
    ['quando','Quando responder'],['avancado','Avançado'],['pausa','Pausa humana'],
    ['mensagens','Mensagens longas'],['midia','Mídia']];
  const form=()=>document.querySelector('.wa-ai-form');
  function Nav(){
    const [cur,setCur]=y.useState('identidade');
    const go=id=>{setCur(id);const f=form();f&&f.setAttribute('data-sec',id)};
    y.useLayoutEffect(()=>{const f=form();f&&f.setAttribute('data-sec',cur)},[]);
    return i.jsxs('nav',{className:'wa-ai-nav','aria-label':'Seções do atendente',children:[
      i.jsx('p',{className:'wa-ai-nav-title',children:'Configuração do atendente'}),
      i.jsx('ul',{className:'wa-ai-nav-list',children:SECS.map(s=>i.jsx('li',{children:i.jsx('button',{
        type:'button',className:'wa-ai-nav-btn','data-sec':s[0],'aria-current':cur===s[0]?'true':void 0,
        onClick:()=>go(s[0]),children:s[1]})},s[0]))})]});
  }
  function Save({modal,onDiscard}){
    if(modal)return null;
    return i.jsxs('div',{className:'wa-ai-actions',children:[
      onDiscard?i.jsx('button',{type:'button',className:'wa-ai-btn wa-ai-btn-ghost',onClick:onDiscard,children:'Descartar'}):null,
      i.jsx('button',{type:'submit',className:'wa-ai-btn wa-ai-btn-primary',children:'Salvar alterações'})]});
  }
  return{Nav,Save};
})();
"""
COMPONENT_ANCHOR = 'function BI('


def g_component(s):
    return rep(s, COMPONENT_ANCHOR, COMPONENT + COMPONENT_ANCHOR, 'WaAI before BI')


# ------------------------------------------------------------------------------------------------ 2. form
FORM_OPEN_OLD = 'i.jsxs("form",{onSubmit:w.handleSubmit(t),className:"w-full space-y-6",children:['
FORM_OPEN_NEW = ('i.jsxs("form",{onSubmit:w.handleSubmit(t),className:"w-full space-y-6"+(s?"":" wa-ai-form"),'
                 'children:[!s&&i.jsx(WaAI.Nav,{}),')

IDENTITY_OLD = (
    'i.jsxs("div",{className:"space-y-4",children:[i.jsx(Pe,{name:"enabled",'
    'label:f("openai.form.enabled.label"),reverse:!0}),i.jsx(le,{name:"description",'
    'label:f("openai.form.description.label"),required:!0,children:i.jsx(ne,{})}),'
    'i.jsx("div",{className:"space-y-2",children:i.jsxs("div",{className:"flex items-end gap-2",children:['
    'i.jsx("div",{className:"flex-1",children:i.jsx(Jt,{name:"openaiCredsId",'
)
SAVE = 'i.jsx(WaAI.Save,{modal:s,onDiscard:()=>w.reset()})'
IDENTITY_NEW = (
    'i.jsxs("div",{className:"space-y-4 wa-ai-body",children:['
    'i.jsxs("section",{className:"wa-ai-sec","data-sec":"identidade",children:[i.jsx(Pe,{name:"enabled",'
    'label:f("openai.form.enabled.label"),reverse:!0}),i.jsx(le,{name:"description",'
    'label:f("openai.form.description.label"),required:!0,children:i.jsx(ne,{})}),' + SAVE + ',]}),'
    'i.jsxs("section",{className:"wa-ai-sec","data-sec":"modelo",children:['
    'i.jsx("div",{className:"space-y-2",children:i.jsxs("div",{className:"flex items-end gap-2",children:['
    'i.jsx("div",{className:"flex-1",children:i.jsx(Jt,{name:"openaiCredsId",'
)

ASSISTANT_OLD = ('i.jsx(le,{name:"functionUrl",label:f("openai.form.functionUrl.label"),required:!0,'
                 'children:i.jsx(ne,{})})]})'
                 ',C==="chatCompletion"&&i.jsxs(i.Fragment,{children:[i.jsx("div",{className:"space-y-2",'
                 'children:i.jsxs("div",{className:"flex items-end gap-2",children:['
                 'i.jsx("div",{className:"flex-1",children:i.jsx(Jt,{name:"model"')
ASSISTANT_NEW = ('i.jsx(le,{name:"functionUrl",label:f("openai.form.functionUrl.label"),required:!0,'
                 'children:i.jsx(ne,{})})]})'
                 ',' + SAVE + ',]}),C==="chatCompletion"&&i.jsxs(i.Fragment,{children:['
                 'i.jsxs("section",{className:"wa-ai-sec","data-sec":"modelo",children:['
                 'i.jsx("div",{className:"space-y-2",'
                 'children:i.jsxs("div",{className:"flex items-end gap-2",children:['
                 'i.jsx("div",{className:"flex-1",children:i.jsx(Jt,{name:"model"')

SYSTEM_OLD = ('f("openai.button.loadModels")]})})]})}),i.jsx(le,{name:"systemMessages",'
              'label:f("openai.form.systemMessages.label"),children:i.jsx(bi,{})}),')
SYSTEM_NEW = ('f("openai.button.loadModels")]})})]})}),' + SAVE + ',]}),'
              'i.jsxs("section",{className:"wa-ai-sec","data-sec":"instrucoes",children:['
              'i.jsx(le,{name:"systemMessages",'
              'label:f("openai.form.systemMessages.label"),children:i.jsx(bi,{})}),')

USER_OLD = ('i.jsx(le,{name:"userMessages",label:f("openai.form.userMessages.label"),children:i.jsx(bi,{})}),'
            'i.jsx(le,{name:"maxTokens",')
USER_NEW = ('i.jsx(le,{name:"userMessages",label:f("openai.form.userMessages.label"),children:i.jsx(bi,{})}),'
            + SAVE + ',]}),i.jsxs("section",{className:"wa-ai-sec","data-sec":"modelo",children:['
            'i.jsx(le,{name:"maxTokens",')

HISTORY_OLD = ('placeholder:f("openai.form.mediaOptions.placeholder")})})]}),'
              'i.jsxs("div",{className:"flex flex-col",children:[i.jsx("h3",{className:"my-4 text-lg font-medium",'
              'children:f("openai.form.triggerSettings.label")})')
HISTORY_NEW = ('placeholder:f("openai.form.mediaOptions.placeholder")})}),' + SAVE + ',]})]})'
              ',i.jsxs("div",{className:"flex flex-col",children:[i.jsx("h3",{className:"my-4 text-lg font-medium",'
              'children:f("openai.form.triggerSettings.label")})')

TRIGGER_OLD = (',i.jsxs("div",{className:"flex flex-col",children:[i.jsx("h3",{className:"my-4 text-lg font-medium",'
               'children:f("openai.form.triggerSettings.label")})')
TRIGGER_NEW = (',i.jsxs("section",{className:"wa-ai-sec","data-sec":"quando",children:['
               'i.jsxs("div",{className:"flex flex-col",children:[i.jsx("h3",{className:"my-4 text-lg font-medium",'
               'children:f("openai.form.triggerSettings.label")})')

GENERAL_OLD = ('k==="advanced"&&i.jsx(le,{name:"triggerValue",label:f("openai.form.triggerConditions.label"),'
               'required:!0,children:i.jsx(ne,{})}),i.jsxs("div",{className:"flex flex-col",'
               'children:[i.jsx("h3",{className:"my-4 text-lg font-medium",'
               'children:f("openai.form.generalSettings.label")})')
GENERAL_NEW = ('k==="advanced"&&i.jsx(le,{name:"triggerValue",label:f("openai.form.triggerConditions.label"),'
               'required:!0,children:i.jsx(ne,{})}),' + SAVE + ',]}),'
               'i.jsxs("section",{className:"wa-ai-sec","data-sec":"avancado",children:['
               'i.jsxs("div",{className:"flex flex-col",children:[i.jsx("h3",{className:"my-4 text-lg font-medium",'
               'children:f("openai.form.generalSettings.label")})')

PAUSE_OLD = ('i.jsx(Pe,{name:"listeningFromMe",label:f("openai.form.listeningFromMe.label"),'
             'helper:f("openai.form.help.listeningFromMe"),reverse:!0}),i.jsx(Pe,{name:"stopBotFromMe",')
PAUSE_NEW = ('i.jsx(Pe,{name:"listeningFromMe",label:f("openai.form.listeningFromMe.label"),'
             'helper:f("openai.form.help.listeningFromMe"),reverse:!0}),' + SAVE + ',]}),'
             'i.jsxs("section",{className:"wa-ai-sec","data-sec":"pausa",children:[i.jsx(Pe,{name:"stopBotFromMe",')

LONG_OLD = ('i.jsx(Pe,{name:"keepOpen",label:f("openai.form.keepOpen.label"),'
            'helper:f("openai.form.help.keepOpen"),reverse:!0}),i.jsx(le,{name:"debounceTime",')
LONG_NEW = ('i.jsx(Pe,{name:"keepOpen",label:f("openai.form.keepOpen.label"),'
            'helper:f("openai.form.help.keepOpen"),reverse:!0}),' + SAVE + ',]}),'
            'i.jsxs("section",{className:"wa-ai-sec","data-sec":"mensagens",children:[i.jsx(le,{name:"debounceTime",')

MEDIA_OLD = ('w.watch("splitMessages")&&i.jsx(le,{name:"timePerChar",'
             'label:f("openai.form.timePerChar.label"),helper:f("openai.form.help.timePerChar"),'
             'children:i.jsx(ne,{type:"number"})}),i.jsxs("div",{className:"flex flex-col",'
             'children:[i.jsx("h3",{className:"my-4 text-lg font-medium",'
             'children:f("openai.form.mediaOptions.section")})')
MEDIA_NEW = ('w.watch("splitMessages")&&i.jsx(le,{name:"timePerChar",'
             'label:f("openai.form.timePerChar.label"),helper:f("openai.form.help.timePerChar"),'
             'children:i.jsx(ne,{type:"number"})}),' + SAVE + ',]}),'
             'i.jsxs("section",{className:"wa-ai-sec","data-sec":"midia",children:['
             'i.jsxs("div",{className:"flex flex-col",children:[i.jsx("h3",{className:"my-4 text-lg font-medium",'
             'children:f("openai.form.mediaOptions.section")})')

END_OLD = ('children:i.jsx(ne,{type:"number",min:1,max:32,step:1,'
           'placeholder:f("openai.form.mediaOptions.placeholder")})})]}),s&&i.jsx(Yt,')
END_NEW = ('children:i.jsx(ne,{type:"number",min:1,max:32,step:1,'
           'placeholder:f("openai.form.mediaOptions.placeholder")})}),' + SAVE + ',]}),]}),s&&i.jsx(Yt,')

FOOT_OLD = ('!s&&i.jsxs("div",{children:[i.jsx($I,{openaiId:r}),'
            'i.jsxs("div",{className:"mt-5 flex items-center gap-3",')
FOOT_NEW = ('!s&&i.jsxs("div",{className:"wa-ai-foot",children:[i.jsx($I,{openaiId:r}),'
            'i.jsxs("div",{className:"mt-5 flex items-center gap-3",')

FORM_STEPS = [
    (FORM_OPEN_OLD, FORM_OPEN_NEW, 'form class and Nav'),
    (IDENTITY_OLD, IDENTITY_NEW, 'identity and model sections'),
    (ASSISTANT_OLD, ASSISTANT_NEW, 'assistant fields'),
    (SYSTEM_OLD, SYSTEM_NEW, 'instructions section'),
    (USER_OLD, USER_NEW, 'model fields after instructions'),
    (HISTORY_OLD, HISTORY_NEW, 'close model section'),
    (TRIGGER_OLD, TRIGGER_NEW, 'open trigger section'),
    (GENERAL_OLD, GENERAL_NEW, 'close trigger, open advanced'),
    (PAUSE_OLD, PAUSE_NEW, 'close advanced, open human pause'),
    (LONG_OLD, LONG_NEW, 'close pause, open long messages'),
    (MEDIA_OLD, MEDIA_NEW, 'close long messages, open media'),
    (END_OLD, END_NEW, 'close media and body'),
    (FOOT_OLD, FOOT_NEW, 'bottom controls'),
]


def g_form(s):
    for old, new, label in FORM_STEPS:
        s = rep(s, old, new, label)
    return s


# ------------------------------------------------------------------------------------------------ 3. page
HEADER_OLD = ('i.jsxs("div",{className:"mb-1 flex items-center justify-between",children:['
              'i.jsx("h1",{className:"wa-page-title text-lg font-medium",children:e("openai.title")}),'
              'i.jsxs("div",{className:"flex items-center justify-end gap-2",children:[i.jsx($I,{}),')
HEADER_NEW = ('i.jsxs("div",{className:"mb-1 flex items-center justify-between",children:['
              'i.jsx("h1",{className:"wa-page-title text-lg font-medium",children:e("openai.title")}),'
              'i.jsxs("div",{className:"flex items-center justify-end gap-2",children:['
              'i.jsx(Fu,{to:"/manager/instance/"+(n?n.id:"")+"/chat",className:"wa-ai-test",'
              'title:"Envie uma mensagem de outro celular e acompanhe a resposta em Conversas",'
              'children:"Testar uma conversa"}),i.jsx($I,{}),')

# a descrição desce para a linha de baixo: com cinco botões no topo, espremida ela quebrava em três linhas
HEADER_END_OLD = ('i.jsx(Sre,{resetTable:f})]})]}),i.jsx($t,{className:"my-4"})')
HEADER_END_NEW = ('i.jsx(Sre,{resetTable:f})]})]}),'
                   'i.jsx("p",{className:"wa-ai-desc",'
                   'children:"Como a IA atende, quando responde e com qual chave. As conversas ficam em Conversas."}),'
                   'i.jsx($t,{className:"my-4"})')

BOT_TYPE_OLD = ('i.jsx("p",{className:"text-sm font-normal text-muted-foreground",children:h.botType})'
                ']},h.id)):i.jsx(se,{variant:"link",children:e("openai.table.none")})')
BOT_TYPE_NEW = ('i.jsx("p",{className:"text-sm font-normal text-muted-foreground",'
                'children:h.botType==="assistant"?"Assistente da OpenAI":'
                'h.botType==="chatCompletion"?"Conversa com o modelo":h.botType})'
                ']},h.id)):i.jsx(se,{variant:"link",children:e("openai.table.none")})')


def g_page(s):
    s = rep(s, HEADER_OLD, HEADER_NEW, 'page header')
    s = rep(s, HEADER_END_OLD, HEADER_END_NEW, 'page description')
    return rep(s, BOT_TYPE_OLD, BOT_TYPE_NEW, 'bot list type')


# ------------------------------------------------------------------------------------------------ 4. menu
MENU_OLD = ('{navLabel:!0,title:e("sidebar.configurations"),icon:Oo,children:['
            '{id:"settings",title:e("sidebar.settings"),path:"settings"},'
            '{id:"proxy",title:e("sidebar.proxy"),path:"proxy"}]}')
MENU_NEW = ('{id:"openai",title:"Atendente IA",icon:WaPortalIcons.Bot,path:"openai",cfg:!0},'
            + MENU_OLD)

TREE_OLD = ('{id:"typebot",title:e("sidebar.typebot"),path:"typebot"},'
            '{id:"openai",title:e("sidebar.openai"),path:"openai"},{id:"dify"')
TREE_NEW = '{id:"typebot",title:e("sidebar.typebot"),path:"typebot"},{id:"dify"'

LABEL_OLD = 'if(u&&u.children&&!(p&&p.children))return'
LABEL_NEW = 'if(u&&(u.children||u.cfg)&&!(p&&(p.children||p.cfg)))return'

CRUMB_OLD = "['openai','OpenAI','bot']"
CRUMB_NEW = "['openai','Atendente IA','bot']"


def g_menu(s):
    s = rep(s, MENU_OLD, MENU_NEW, 'Atendente IA menu item')
    s = rep(s, TREE_OLD, TREE_NEW, 'remove OpenAI from Integrações')
    s = rep(s, LABEL_OLD, LABEL_NEW, 'nav label follows cfg items')
    return rep(s, CRUMB_OLD, CRUMB_NEW, 'breadcrumb name')


# ------------------------------------------------------------------------------------------------ 5. texts
TEXTS = [
    ('Gae={title:"OpenAI"', 'Gae={title:"Atendente IA"', 'page title'),
    ('form:{title:"Novo OpenAI"', 'form:{title:"Novo atendente"', 'create dialog title'),
    ('openaiCredsId:{label:"Credenciais do OpenAI"}', 'openaiCredsId:{label:"Chave da OpenAI"}', 'key label'),
    ('enabled:{label:"Ativo"}', 'enabled:{label:"Atendente ligado"}', 'enabled label'),
    ('description:{label:"Descrição"}', 'description:{label:"Nome do atendente"}', 'description label'),
    ('openaiSettings:{label:"Configurações do OpenAI"}', 'openaiSettings:{label:"Modelo e chave"}',
     'settings section label'),
    ('botType:{label:"Tipo de Bot",assistant:"Assistente",chatCompletion:"Chat Completion"}',
     'botType:{label:"Como a IA responde",assistant:"Assistente da OpenAI",chatCompletion:"Conversa com o modelo"}',
     'bot type labels'),
    ('assistantId:{label:"ID do Assistente"}', 'assistantId:{label:"ID do assistente na OpenAI"}', 'assistant id'),
    ('functionUrl:{label:"URL da Função"}', 'functionUrl:{label:"URL da função"}', 'function url'),
    ('model:{label:"Modelo de Linguagem"}', 'model:{label:"Modelo"}', 'model label'),
    ('systemMessages:{label:"Mensagens do Sistema",description:"Enviar mensagens do sistema para o OpenAI"}',
     'systemMessages:{label:"Instruções para a IA",description:"O que a IA deve fazer e como falar com o cliente. '
     'Vale para todas as conversas."}', 'system messages'),
    ('assistantMessages:{label:"Mensagens do Assistente",description:"Enviar mensagens do assistente para o OpenAI"}',
     'assistantMessages:{label:"Exemplos de respostas da IA",description:"Modelos de resposta que a IA deve seguir."}',
     'assistant messages'),
    ('userMessages:{label:"Mensagens do Usuário",description:"Enviar mensagens do usuário para o OpenAI"}',
     'userMessages:{label:"Exemplos de mensagens do cliente",description:"Perguntas comuns que o cliente faz."}',
     'user messages'),
    ('maxTokens:{label:"Máximo de Tokens"}', 'maxTokens:{label:"Tamanho máximo da resposta"}', 'max tokens'),
    ('triggerSettings:{label:"Configurações de Gatilho"}', 'triggerSettings:{label:"Quando a IA responde"}',
     'trigger section'),
    ('triggerType:{label:"Tipo de Gatilho"', 'triggerType:{label:"Iniciar a conversa quando"', 'trigger type'),
    ('triggerOperator:{label:"Operador do Gatilho"', 'triggerOperator:{label:"A mensagem"', 'trigger operator'),
    ('triggerValue:{label:"Gatilho"}', 'triggerValue:{label:"Palavra ou frase-chave"}', 'trigger value'),
    ('triggerConditions:{label:"Condições"}', 'triggerConditions:{label:"Condições da mensagem"}',
     'trigger conditions'),
    ('generalSettings:{label:"Configurações Gerais"}',
     'generalSettings:{label:"Mensagens e detalhes do atendimento"}', 'general section'),
    ('expire:{label:"Expirar em minutos"}', 'expire:{label:"Encerrar a conversa após (minutos)"}', 'expire label'),
    ('keywordFinish:{label:"Palavra-chave de Finalização"}', 'keywordFinish:{label:"Palavra que encerra a conversa"}',
     'finish keyword'),
    ('delayMessage:{label:"Mensagem de Atraso Padrão"}',
     'delayMessage:{label:"Tempo de digitando antes de responder (ms)"}', 'delay label'),
    ('unknownMessage:{label:"Mensagem Desconhecida"}', 'unknownMessage:{label:"Mensagem quando a OpenAI falha"}',
     'unknown message'),
    ('listeningFromMe:{label:"Ouvindo de mim",description:"Ouvir as mensagens enviadas por mim no bot"}',
     'listeningFromMe:{label:"Responder às mensagens enviadas pelo número",'
     'description:"A IA também responde ao que a equipe envia pelo WhatsApp."}', 'listening label'),
    ('stopBotFromMe:{label:"Parar bot por mim",description:"Pausar o bot quando eu enviar uma mensagem"}',
     'stopBotFromMe:{label:"Pausar a IA quando a equipe responder",'
     'description:"Quando alguém da equipe responde pelo celular ou WhatsApp Web, a IA para nesse contato."}',
     'stop bot label'),
    ('keepOpen:{label:"Manter aberto",description:"Manter o bot aberto após o término da conversa"}',
     'keepOpen:{label:"Manter a conversa aberta ao encerrar",'
     'description:"A IA não volta a responder até alguém reativar."}', 'keep open label'),
    ('debounceTime:{label:"Tempo de Debounce"}', 'debounceTime:{label:"Esperar mensagens seguidas (segundos)"}',
     'debounce label'),
    ('splitMessages:{label:"Dividir Mensagens",description:"Dividir mensagens longas em várias mensagens"}',
     'splitMessages:{label:"Dividir respostas longas",'
     'description:"Cada parágrafo vira uma mensagem, como uma pessoa digitando."}', 'split label'),
    ('timePerChar:{label:"Tempo por Caractere"}', 'timePerChar:{label:"Tempo de digitação por caractere (ms)"}',
     'time per char'),
    ('mediaOptions:{section:"Mídia (áudio, imagem, documentos)"',
     'mediaOptions:{section:"Áudios, imagens e documentos"', 'media section'),
    ('button:{create:"OpenAI",save:"Salvar",saving:"Salvando...",update:"Atualizar",'
     'defaultSettings:"Configurações Padrão",delete:"Excluir",loadModels:"Carregar Modelos",'
     'loading:"Carregando..."}',
     'button:{create:"Novo atendente",save:"Salvar alterações",saving:"Salvando...",update:"Salvar alterações",'
     'defaultSettings:"Configurações Padrão",delete:"Excluir",loadModels:"Buscar modelos",loading:"Buscando..."}',
     'buttons'),
    ('toast:{defaultSettings:{success:"Configurações padrão aplicadas com sucesso",'
     'error:"Ocorreu um erro ao aplicar as configurações padrão"},'
     'success:{update:"OpenAI atualizado com sucesso",create:"OpenAI criado com sucesso",'
     'delete:"OpenAI excluído com sucesso",status:"Status do OpenAI atualizado com sucesso",'
     'credentialsCreate:"Credenciais do OpenAI criadas com sucesso",'
     'credentialsDelete:"Credenciais do OpenAI excluídas com sucesso"},'
     'error:"Ocorreu um erro ao criar o OpenAI"}',
     'toast:{defaultSettings:{success:"Configurações padrão aplicadas com sucesso",'
     'error:"Ocorreu um erro ao aplicar as configurações padrão"},'
     'success:{update:"Atendente IA atualizado com sucesso",create:"Atendente criado com sucesso",'
     'delete:"Atendente excluído com sucesso",status:"Estado do atendente atualizado com sucesso",'
     'credentialsCreate:"Chave da OpenAI criada com sucesso",'
     'credentialsDelete:"Chave da OpenAI excluída com sucesso"},'
     'error:"Ocorreu um erro ao criar o atendente"}', 'toasts'),
    ('table:{none:"Nada para mostrar"}', 'table:{none:"Nenhum atendente ainda"}', 'empty list text'),
    ('Modelo da OpenAI que gera as respostas. Escolha a credencial e clique em \\"Carregar Modelos\\" para ver a lista.',
     'Modelo da OpenAI que gera as respostas. Escolha a chave e clique em \\"Buscar modelos\\" para ver a lista.',
     'model help'),
    ('Modelos de raciocínio (gpt-5/o-series) gastam tokens pensando: use 2000+.',
     'Modelos de raciocínio gastam tokens pensando: use 2000+.', 'max tokens help'),
    ('Modelos novos (gpt-5, gpt-6, o1/o3...) exigem max_completion_tokens.',
     'Modelos novos exigem max_completion_tokens.', 'token param help'),
]


def g_texts(s):
    start = s.find('Gae={title:"OpenAI"')
    end = s.find(',Jae={title:"Dify"', start)
    if start < 0 or end < 0 or s.count('Gae={title:"OpenAI"') != 1:
        raise PatchError('pt-BR OpenAI translations: block not found')
    block = s[start:end]
    for old, new, label in TEXTS:
        block = rep(block, old, new, label)
    return s[:start] + block + s[end:]


GROUPS = [('component', g_component), ('form', g_form), ('page', g_page), ('menu', g_menu), ('texts', g_texts)]


# ------------------------------------------------------------------------------------------------ 6. html
def patch_html(html):
    if CSS_TAG in html:
        return html
    if '/assets/atendente-ia.css' in html:
        raise PatchError('index.html: atendente-ia.css present with another version; edit CSS_VERSION')
    anchor = '    <link rel="stylesheet" href="/assets/first-run.css?v='
    if html.count(anchor) != 1:
        raise PatchError('index.html: first-run.css link expected once')
    pos = html.find('\n', html.find(anchor)) + 1
    return html[:pos] + '    ' + CSS_TAG + '\n' + html[pos:]


def bump_css(html):
    return re.sub(r'(/assets/atendente-ia\.css\?v=)(\d+)',
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
        missing.append('atendente-ia.css')
    if patch_html(bump_css(html)) != html:
        missing.append('index.html')
    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1
    if not os.path.isfile(CSS):
        raise PatchError('manager/dist/assets/atendente-ia.css is missing')
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
    report.append(f'index.html: atendente-ia.css?v={CSS_VERSION}, bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
