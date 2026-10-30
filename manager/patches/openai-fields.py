#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager bundle (OpenAI integration screens).

Why a patch and not a rebuild: manager/dist is the upstream evolution-manager-v2 2.3.5 build plus manual
customizations made directly in the minified bundle (branding, fixed URL, PT-BR, observability...). Rebuilding
from source would drop them, so changes are applied here as exact string replacements.

Groups (each one is applied once and leaves a marker comment at the top of the bundle):
  tokens  - tokenParam and humanResumeMinutes in the OpenAI bot form (create/edit) and in the default settings;
            FormInput gets an optional `helper` (description) prop; fixes the bot query/form cache that was not
            keyed by bot id (editing bot B could show bot A data).
  help    - short descriptions under the relevant OpenAI fields (bot form and default settings).
  pause   - sessions dialog: human pause state per contact (badge, time to resume, last human message),
            "Resume now"/"Pause" buttons, works from the OpenAI page header too (all bots, with a Bot column).

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.

Usage (from the repository root):
  python3 -I manager/patches/openai-fields.py           # apply (bundle + cache bust in index.html)
  python3 -I manager/patches/openai-fields.py --check   # exit 1 unless every group is applied
Validate afterwards: cp manager/dist/assets/index-b29a5d7a.js /tmp/x.mjs && node --check /tmp/x.mjs
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CACHE_VERSION = '8'
LANGS = ('en', 'es', 'fr', 'pt')


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:openai-fields:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


def js(value):
    """Python dict/str -> JS literal with unquoted (identifier) keys."""
    if isinstance(value, dict):
        return '{' + ','.join(k + ':' + js(v) for k, v in value.items()) + '}'
    return json.dumps(value, ensure_ascii=False)


def openai_objects(s):
    """Start offsets of the OpenAI translation object of each language, keyed by language."""
    search = {
        'en': 'search:"Search for remoteJid..."',
        'es': 'search:"Buscar por remoteJid..."',
        'fr': 'search:"Rechercher par remoteJid..."',
        'pt': 'search:"Pesquisar por remoteJid..."',
    }
    found = {}
    start = -1
    while True:
        start = s.find('{title:"OpenAI",sessions:{label:"', start + 1)
        if start < 0:
            break
        head = s[start:start + 200]
        langs = [k for k, v in search.items() if v in head]
        if len(langs) != 1:
            raise PatchError(f'translations: cannot identify language at {start}')
        found[langs[0]] = start
    if sorted(found) != sorted(LANGS) or s.count('{title:"OpenAI",sessions:{label:"') != 4:
        raise PatchError(f'translations: expected 4 OpenAI objects, got {sorted(found)}')
    return found


def insert_translations(s, anchor, texts, label):
    """Inserts texts[lang] (JS 'key:value,' text) right after `anchor` inside each OpenAI translation object."""
    starts = openai_objects(s)
    # Insert from the end so earlier offsets stay valid
    for lang, start in sorted(starts.items(), key=lambda kv: -kv[1]):
        end = s.find('button:{create:"OpenAI"', start)
        pos = s.find(anchor, start)
        if end < 0 or pos < 0 or pos > end:
            raise PatchError(f'{label}: anchor {anchor!r} not found in {lang}')
        if s.find(anchor, pos + 1, end) >= 0:
            raise PatchError(f'{label}: anchor {anchor!r} repeated in {lang}')
        # anchor ends right before the first key of the object: insert there
        cut = pos + len(anchor)
        s = s[:cut] + texts[lang] + s[cut:]
    return s


def form_title_anchor(s, start):
    """`form:{title:"<localized>",` of the OpenAI object that starts at `start`."""
    pos = s.find('form:{title:"', start)
    end = s.find('",', pos)
    return s[pos:end + 2]


def insert_in_form(s, texts, label):
    starts = openai_objects(s)
    for lang, start in sorted(starts.items(), key=lambda kv: -kv[1]):
        anchor = form_title_anchor(s, start)
        limit = s.find('button:{create:"OpenAI"', start)
        pos = s.find(anchor, start)
        if pos < 0 or pos > limit:
            raise PatchError(f'{label}: form anchor not found in {lang}')
        cut = pos + len(anchor)
        s = s[:cut] + texts[lang] + s[cut:]
    return s


# ---------------------------------------------------------------------------------------------------------------
# Texts
# ---------------------------------------------------------------------------------------------------------------
STOP_BOT_LABEL = {
    'en': 'Stop bot from me',
    'es': 'Detener bot por mí',
    'fr': 'Arrêter le Bot de Moi',
    'pt': 'Parar bot por mim',
}

TOKENS_TEXT = {
    'pt': {
        'tokenParam': {
            'label': 'Parâmetro de limite de tokens',
            'description': 'Modelos novos (gpt-5, gpt-6, o1/o3...) exigem max_completion_tokens. No automático a API '
                           'escolhe sozinha e, se a OpenAI recusar, tenta o outro.',
            'inherit': 'Herdar das configurações padrão',
            'auto': 'Automático (recomendado)',
            'max_tokens': 'max_tokens',
            'max_completion_tokens': 'max_completion_tokens',
            'inheritNote': '"Herdar" usa o valor definido nas Configurações Padrão.',
            'ownValueNote': 'Este bot já tem um valor próprio: depois de definido, não dá para voltar a herdar por aqui.',
        },
        'humanResumeMinutes': {
            'label': 'Retomar a IA após (minutos)',
            'description': 'Quando alguém da equipe responde o contato pelo WhatsApp (celular, Web ou Desktop), a IA '
                           'para nesse chat. Ela volta sozinha X minutos após a última mensagem humana. 0 = só volta '
                           'quando reativada manualmente. Requer "Parar bot por mim" ligado.',
            'inheritNote': 'Deixe vazio para herdar das Configurações Padrão.',
            'ownValueNote': 'Este bot já tem um valor próprio: apagar o campo não volta a herdar (o valor atual é mantido).',
            'placeholder': 'Herdar das configurações padrão',
            'stopBotOff': 'Atenção: "Parar bot por mim" está desligado, então a IA não pausa quando a equipe responde.',
        },
    },
    'en': {
        'tokenParam': {
            'label': 'Token limit parameter',
            'description': 'Newer models (gpt-5, gpt-6, o1/o3...) require max_completion_tokens. On automatic the API '
                           'picks it by itself and, if OpenAI rejects it, tries the other one.',
            'inherit': 'Inherit from default settings',
            'auto': 'Automatic (recommended)',
            'max_tokens': 'max_tokens',
            'max_completion_tokens': 'max_completion_tokens',
            'inheritNote': '"Inherit" uses the value set in the Default Settings.',
            'ownValueNote': 'This bot already has its own value: once set, it cannot go back to inheriting from here.',
        },
        'humanResumeMinutes': {
            'label': 'Resume AI after (minutes)',
            'description': 'When someone on the team replies to the contact on WhatsApp (phone, Web or Desktop), the AI '
                           'stops in that chat. It comes back by itself X minutes after the last human message. 0 = it '
                           'only comes back when resumed manually. Requires "Stop bot from me" on.',
            'inheritNote': 'Leave empty to inherit from the Default Settings.',
            'ownValueNote': 'This bot already has its own value: clearing the field does not inherit again (the current '
                            'value is kept).',
            'placeholder': 'Inherit from default settings',
            'stopBotOff': 'Warning: "Stop bot from me" is off, so the AI does not pause when the team replies.',
        },
    },
    'es': {
        'tokenParam': {
            'label': 'Parámetro de límite de tokens',
            'description': 'Los modelos nuevos (gpt-5, gpt-6, o1/o3...) exigen max_completion_tokens. En automático la '
                           'API elige sola y, si OpenAI lo rechaza, prueba el otro.',
            'inherit': 'Heredar de la configuración predeterminada',
            'auto': 'Automático (recomendado)',
            'max_tokens': 'max_tokens',
            'max_completion_tokens': 'max_completion_tokens',
            'inheritNote': '"Heredar" usa el valor definido en las Configuraciones Predeterminadas.',
            'ownValueNote': 'Este bot ya tiene un valor propio: una vez definido, no se puede volver a heredar desde aquí.',
        },
        'humanResumeMinutes': {
            'label': 'Reanudar la IA después de (minutos)',
            'description': 'Cuando alguien del equipo responde al contacto por WhatsApp (celular, Web o Desktop), la IA '
                           'se detiene en ese chat. Vuelve sola X minutos después del último mensaje humano. 0 = solo '
                           'vuelve cuando se reactiva manualmente. Requiere "Detener bot por mí" activado.',
            'inheritNote': 'Déjalo vacío para heredar de las Configuraciones Predeterminadas.',
            'ownValueNote': 'Este bot ya tiene un valor propio: borrar el campo no vuelve a heredar (se mantiene el '
                            'valor actual).',
            'placeholder': 'Heredar de la configuración predeterminada',
            'stopBotOff': 'Atención: "Detener bot por mí" está desactivado, así que la IA no se pausa cuando el equipo '
                          'responde.',
        },
    },
    'fr': {
        'tokenParam': {
            'label': 'Paramètre de limite de tokens',
            'description': 'Les modèles récents (gpt-5, gpt-6, o1/o3...) exigent max_completion_tokens. En automatique, '
                           "l'API choisit seule et, si OpenAI refuse, essaie l'autre.",
            'inherit': 'Hériter des paramètres par défaut',
            'auto': 'Automatique (recommandé)',
            'max_tokens': 'max_tokens',
            'max_completion_tokens': 'max_completion_tokens',
            'inheritNote': '« Hériter » utilise la valeur définie dans les Paramètres par Défaut.',
            'ownValueNote': 'Ce bot a déjà sa propre valeur : une fois définie, impossible de revenir à « Hériter » ici.',
        },
        'humanResumeMinutes': {
            'label': "Reprendre l'IA après (minutes)",
            'description': "Quand quelqu'un de l'équipe répond au contact sur WhatsApp (téléphone, Web ou Desktop), "
                           "l'IA s'arrête dans cette conversation. Elle revient seule X minutes après le dernier message "
                           'humain. 0 = elle ne revient que si elle est réactivée manuellement. Nécessite « Arrêter le '
                           'Bot de Moi » activé.',
            'inheritNote': 'Laissez vide pour hériter des Paramètres par Défaut.',
            'ownValueNote': 'Ce bot a déjà sa propre valeur : vider le champ ne fait pas hériter de nouveau (la valeur '
                            'actuelle est conservée).',
            'placeholder': 'Hériter des paramètres par défaut',
            'stopBotOff': "Attention : « Arrêter le Bot de Moi » est désactivé, l'IA ne se met donc pas en pause quand "
                          "l'équipe répond.",
        },
    },
}



# ---------------------------------------------------------------------------------------------------------------
# Group "tokens"
# ---------------------------------------------------------------------------------------------------------------
def patch_tokens(s):
    # FormInput (`le`, shared by every screen): optional `helper` rendered as FormDescription, like FormSelect does.
    # Nothing passes `helper` to it today, so other screens render exactly as before.
    s = rep(s,
            'const le=({name:e,label:t,children:n,required:r,readOnly:s,className:o,...l})=>i.jsx(Lo,{...l,name:e,'
            'render:({field:u})=>i.jsxs(no,{className:o,children:[t&&i.jsxs(Nr,{children:[t,r&&i.jsx("span",'
            '{className:"ml-2 text-rose-600",children:"*"})]}),i.jsx(_s,{children:y.isValidElement(n)&&y.cloneElement(n,'
            '{...u,value:u.value??"",required:r,readOnly:s,checked:u.value,onCheckedChange:u.onChange})}),i.jsx(Td,{})]})})',
            'const le=({name:e,label:t,children:n,required:r,readOnly:s,className:o,helper:__ofH,...l})=>i.jsx(Lo,{...l,'
            'name:e,render:({field:u})=>i.jsxs(no,{className:o,children:[t&&i.jsxs(Nr,{children:[t,r&&i.jsx("span",'
            '{className:"ml-2 text-rose-600",children:"*"})]}),i.jsx(_s,{children:y.isValidElement(n)&&y.cloneElement(n,'
            '{...u,value:u.value??"",required:r,readOnly:s,checked:u.value,onCheckedChange:u.onChange})}),'
            '__ofH&&i.jsx(ag,{children:__ofH}),i.jsx(Td,{})]})})',
            'FormInput helper')

    # --- bot form (BI): schema, defaults, fields ---
    s = rep(s,
            'maxTokens:P.coerce.number().optional(),triggerType:P.string(),triggerOperator:P.string().optional(),'
            'triggerValue:P.string().optional(),expire:P.coerce.number().optional()',
            'maxTokens:P.coerce.number().optional(),'
            'tokenParam:P.enum(["inherit","auto","max_tokens","max_completion_tokens"]).optional(),'
            'humanResumeMinutes:P.preprocess(e=>e===""||e==null||Number.isNaN(Number(e))?void 0:Number(e),'
            'P.number().int().min(0).optional()),'
            'triggerType:P.string(),triggerOperator:P.string().optional(),'
            'triggerValue:P.string().optional(),expire:P.coerce.number().optional()',
            'bot schema')
    s = rep(s,
            'keepOpen:!1,debounceTime:0,splitMessages:!1,timePerChar:0}}),C=w.watch("botType")',
            'keepOpen:!1,debounceTime:0,splitMessages:!1,timePerChar:0,tokenParam:"inherit"}}),C=w.watch("botType")',
            'bot defaults')
    # tokenParam only applies to Chat Completions (the assistant API has no max tokens here)
    s = rep(s,
            'i.jsx(le,{name:"maxTokens",label:f("openai.form.maxTokens.label"),children:i.jsx(ne,{type:"number"})})]',
            'i.jsx(le,{name:"maxTokens",label:f("openai.form.maxTokens.label"),children:i.jsx(ne,{type:"number"})}),'
            'i.jsx(Jt,{name:"tokenParam",label:f("openai.form.tokenParam.label"),'
            'helper:f("openai.form.tokenParam.description")+" "+f(e?.tokenParam&&e.tokenParam!=="inherit"?'
            '"openai.form.tokenParam.ownValueNote":"openai.form.tokenParam.inheritNote"),options:['
            '...(e?.tokenParam&&e.tokenParam!=="inherit"?[]:[{label:f("openai.form.tokenParam.inherit"),value:"inherit"}]),'
            '{label:f("openai.form.tokenParam.auto"),value:"auto"},'
            '{label:f("openai.form.tokenParam.max_tokens"),value:"max_tokens"},'
            '{label:f("openai.form.tokenParam.max_completion_tokens"),value:"max_completion_tokens"}]})]',
            'bot tokenParam select')
    # humanResumeMinutes right after the switch it depends on
    s = rep(s,
            'i.jsx(Pe,{name:"stopBotFromMe",label:f("openai.form.stopBotFromMe.label"),reverse:!0}),',
            'i.jsx(Pe,{name:"stopBotFromMe",label:f("openai.form.stopBotFromMe.label"),reverse:!0}),'
            'i.jsx(le,{name:"humanResumeMinutes",label:f("openai.form.humanResumeMinutes.label"),'
            'helper:i.jsxs(i.Fragment,{children:[f("openai.form.humanResumeMinutes.description")," ",'
            'f(e?.humanResumeMinutes!=null?"openai.form.humanResumeMinutes.ownValueNote":'
            '"openai.form.humanResumeMinutes.inheritNote"),!w.watch("stopBotFromMe")&&i.jsx("span",'
            '{className:"mt-1 block font-medium text-amber-900",children:f("openai.form.humanResumeMinutes.stopBotOff")})]}),'
            'children:i.jsx(ne,{type:"number",min:0,step:1,placeholder:f("openai.form.humanResumeMinutes.placeholder")})}),',
            'bot humanResumeMinutes input')

    # --- create payload: only send what was chosen ("inherit"/empty = inherit from the default settings) ---
    s = rep(s,
            'splitMessages:f.splitMessages||!1,timePerChar:f.timePerChar||0};await r({instanceName:n.name,'
            'token:n.token,data:h}),me.success(t("openai.toast.success.create"))',
            'splitMessages:f.splitMessages||!1,timePerChar:f.timePerChar||0,'
            '...f.tokenParam&&f.tokenParam!=="inherit"?{tokenParam:f.tokenParam}:{},'
            '...f.humanResumeMinutes!==void 0?{humanResumeMinutes:f.humanResumeMinutes}:{}};'
            'await r({instanceName:n.name,token:n.token,data:h}),me.success(t("openai.toast.success.create"))',
            'create payload')

    # --- update page: query keyed by bot, initial data, payload, form remounted per bot ---
    s = rep(s, 'queryKey:Cre({instanceName:t})', 'queryKey:Cre({instanceName:t,openaiId:r})', 'bot query key')
    s = rep(s,
            'splitMessages:f?.splitMessages||!1,timePerChar:f?.timePerChar||0}),[f?.assistantId,f?.assistantMessages',
            'splitMessages:f?.splitMessages||!1,timePerChar:f?.timePerChar||0,tokenParam:f?.tokenParam??"inherit",'
            'humanResumeMinutes:f?.humanResumeMinutes??void 0}),[f?.tokenParam,f?.humanResumeMinutes,f?.assistantId,'
            'f?.assistantMessages',
            'update initialData')
    s = rep(s,
            'splitMessages:b.splitMessages||!1,timePerChar:b.timePerChar||0};await d({instanceName:r.name,openaiId:e,'
            'data:w}),me.success(n("openai.toast.success.update"))',
            'splitMessages:b.splitMessages||!1,timePerChar:b.timePerChar||0,'
            '...b.tokenParam&&b.tokenParam!=="inherit"?{tokenParam:b.tokenParam}:{},'
            '...b.humanResumeMinutes!==void 0?{humanResumeMinutes:b.humanResumeMinutes}:{}};'
            'await d({instanceName:r.name,openaiId:e,data:w}),me.success(n("openai.toast.success.update"))',
            'update payload')
    s = rep(s,
            'isLoading:h,openDeletionDialog:o,setOpenDeletionDialog:l})})}function Tk(',
            'isLoading:h,openDeletionDialog:o,setOpenDeletionDialog:l},e)})}function Tk(',
            'update form key')

    # --- default settings (hre) ---
    s = rep(s,
            'splitMessages:P.boolean().optional(),timePerChar:P.coerce.number().optional()});function hre(){',
            'splitMessages:P.boolean().optional(),timePerChar:P.coerce.number().optional(),'
            'tokenParam:P.enum(["auto","max_tokens","max_completion_tokens"]).default("auto"),'
            'humanResumeMinutes:P.coerce.number().int().min(0).default(0)});function hre(){',
            'settings schema')
    s = rep(s,
            'openaiIdFallback:void 0,splitMessages:!1,timePerChar:0}});y.useEffect(()=>{o&&h.reset({',
            'openaiIdFallback:void 0,splitMessages:!1,timePerChar:0,tokenParam:"auto",humanResumeMinutes:0}});'
            'y.useEffect(()=>{o&&h.reset({',
            'settings defaults')
    s = rep(s,
            'splitMessages:o.splitMessages,timePerChar:o.timePerChar??0})},[o]);',
            'splitMessages:o.splitMessages,timePerChar:o.timePerChar??0,tokenParam:o.tokenParam??"auto",'
            'humanResumeMinutes:o.humanResumeMinutes??0})},[o]);',
            'settings reset')
    s = rep(s,
            'ignoreJids:x.ignoreJids,splitMessages:x.splitMessages,timePerChar:x.timePerChar};await n({',
            'ignoreJids:x.ignoreJids,splitMessages:x.splitMessages,timePerChar:x.timePerChar,tokenParam:x.tokenParam,'
            'humanResumeMinutes:x.humanResumeMinutes};await n({',
            'settings payload')
    # FormSelect is uncontrolled (defaultValue): remount it when the loaded value arrives
    s = rep(s,
            'i.jsx(Pe,{name:"stopBotFromMe",label:e("openai.form.stopBotFromMe.label"),reverse:!0}),',
            'i.jsx(Pe,{name:"stopBotFromMe",label:e("openai.form.stopBotFromMe.label"),reverse:!0}),'
            'i.jsx(le,{name:"humanResumeMinutes",label:e("openai.form.humanResumeMinutes.label"),'
            'helper:i.jsxs(i.Fragment,{children:[e("openai.form.humanResumeMinutes.description"),'
            '!h.watch("stopBotFromMe")&&i.jsx("span",{className:"mt-1 block font-medium text-amber-900",'
            'children:e("openai.form.humanResumeMinutes.stopBotOff")})]}),'
            'children:i.jsx(ne,{type:"number",min:0,step:1})}),',
            'settings humanResumeMinutes input')
    s = rep(s,
            'i.jsx(Pe,{name:"speechToText",label:e("openai.form.speechToText.label"),reverse:!0}),',
            'i.jsx(Pe,{name:"speechToText",label:e("openai.form.speechToText.label"),reverse:!0}),'
            'i.jsx(Jt,{name:"tokenParam",label:e("openai.form.tokenParam.label"),'
            'helper:e("openai.form.tokenParam.description"),options:['
            '{label:e("openai.form.tokenParam.auto"),value:"auto"},'
            '{label:e("openai.form.tokenParam.max_tokens"),value:"max_tokens"},'
            '{label:e("openai.form.tokenParam.max_completion_tokens"),value:"max_completion_tokens"}]},'
            '`tokenParam-${h.watch("tokenParam")}`),',
            'settings tokenParam select')

    texts = {k: 'tokenParam:' + js(v['tokenParam']) + ',humanResumeMinutes:' + js(v['humanResumeMinutes']) + ','
             for k, v in TOKENS_TEXT.items()}
    return insert_in_form(s, texts, 'tokens translations')


# ---------------------------------------------------------------------------------------------------------------
# Group "help"
# ---------------------------------------------------------------------------------------------------------------
HELP_TEXT = {
    'pt': {
        'stopBotFromMe': 'Quando alguém da equipe envia mensagem ao contato pelo próprio número (celular, WhatsApp Web '
                         'ou Desktop), a IA pausa nesse chat para não atrapalhar o atendimento humano. Veja "Retomar a '
                         'IA após".',
        'listeningFromMe': 'A IA também processa as mensagens enviadas pelo próprio número, como se fossem do contato. '
                           'Normalmente fica desligado.',
        'expire': 'Não tem efeito no bot OpenAI. Para a IA voltar depois que a equipe assume a conversa, use "Retomar '
                  'a IA após (minutos)".',
        'keywordFinish': 'Se o contato enviar exatamente esta palavra (ex.: #sair), a conversa com a IA é encerrada. '
                         'Vazio = desativado.',
        'delayMessage': 'Tempo, em milissegundos, mostrando "digitando..." antes de enviar cada resposta (1000 = 1 '
                        'segundo).',
        'unknownMessage': 'Única mensagem enviada ao contato quando a OpenAI falha; deixe vazio para não enviar nada.',
        'debounceTime': 'Junta mensagens enviadas em sequência antes de responder: espera este tempo (em segundos) sem '
                        'novas mensagens e responde tudo de uma vez. 0 = responde cada mensagem na hora.',
        'splitMessages': 'Divide respostas longas em várias mensagens, uma por parágrafo, como uma pessoa digitando.',
        'timePerChar': 'Espera antes de cada mensagem, em milissegundos por caractere (mínimo 1 s, máximo 20 s), para '
                       'simular digitação.',
        'keepOpen': 'Ao encerrar a conversa (palavra de finalização ou ação "Encerrar"), o contato fica como "Encerrada" '
                    'e a IA não volta a responder até ser reativada. Desligado: a sessão é apagada e a próxima mensagem '
                    'do contato começa uma conversa nova.',
        'maxTokens': 'Tamanho máximo da resposta (0 = 500). Modelos de raciocínio (gpt-5/o-series) gastam tokens '
                     'pensando: use 2000+.',
        'model': 'Modelo da OpenAI que gera as respostas. Escolha a credencial e clique em "Carregar Modelos" para ver '
                 'a lista.',
        'triggerType': 'Quando a IA começa a atender um contato: Todos = qualquer mensagem; Palavra-chave = só quando a '
                       'mensagem casa com o gatilho; Avançado = condições combinadas. Atenção: "Nenhum" hoje se '
                       'comporta como "Todos".',
    },
    'en': {
        'stopBotFromMe': 'When someone on the team messages the contact from the number itself (phone, WhatsApp Web or '
                         'Desktop), the AI pauses in that chat so it does not get in the way of the human. See "Resume '
                         'AI after".',
        'listeningFromMe': 'The AI also processes messages sent from the number itself, as if they came from the '
                           'contact. Usually off.',
        'expire': 'Has no effect on the OpenAI bot. To bring the AI back after the team takes over, use "Resume AI '
                  'after (minutes)".',
        'keywordFinish': 'If the contact sends exactly this word (e.g. #exit), the conversation with the AI is closed. '
                         'Empty = disabled.',
        'delayMessage': 'Time, in milliseconds, showing "typing..." before each reply is sent (1000 = 1 second).',
        'unknownMessage': 'The only message sent to the contact when OpenAI fails; leave empty to send nothing.',
        'debounceTime': 'Groups messages sent in a row before replying: waits this long (in seconds) without new '
                        'messages and answers them all at once. 0 = replies to each message right away.',
        'splitMessages': 'Splits long replies into several messages, one per paragraph, like a person typing.',
        'timePerChar': 'Wait before each message, in milliseconds per character (minimum 1 s, maximum 20 s), to '
                       'simulate typing.',
        'keepOpen': 'When the conversation is closed (finish keyword or "Close" action), the contact stays as "Closed" '
                    'and the AI does not reply again until it is resumed. Off: the session is deleted and the next '
                    'message from the contact starts a new conversation.',
        'maxTokens': 'Maximum reply size (0 = 500). Reasoning models (gpt-5/o-series) spend tokens thinking: use 2000+.',
        'model': 'OpenAI model that writes the replies. Choose the credential and click "Load Models" to see the list.',
        'triggerType': 'When the AI starts serving a contact: All = any message; Keyword = only when the message '
                       'matches the trigger; Advanced = combined conditions. Note: "None" currently behaves like "All".',
    },
    'es': {
        'stopBotFromMe': 'Cuando alguien del equipo envía un mensaje al contacto desde el propio número (celular, '
                         'WhatsApp Web o Desktop), la IA se pausa en ese chat para no interferir en la atención humana. '
                         'Ver "Reanudar la IA después de".',
        'listeningFromMe': 'La IA también procesa los mensajes enviados desde el propio número, como si fueran del '
                           'contacto. Normalmente desactivado.',
        'expire': 'No tiene efecto en el bot OpenAI. Para que la IA vuelva después de que el equipo asuma la '
                  'conversación, usa "Reanudar la IA después de (minutos)".',
        'keywordFinish': 'Si el contacto envía exactamente esta palabra (ej.: #salir), la conversación con la IA se '
                         'cierra. Vacío = desactivado.',
        'delayMessage': 'Tiempo, en milisegundos, mostrando "escribiendo..." antes de enviar cada respuesta (1000 = 1 '
                        'segundo).',
        'unknownMessage': 'Único mensaje enviado al contacto cuando OpenAI falla; déjalo vacío para no enviar nada.',
        'debounceTime': 'Junta los mensajes enviados seguidos antes de responder: espera este tiempo (en segundos) sin '
                        'mensajes nuevos y responde todo de una vez. 0 = responde cada mensaje al instante.',
        'splitMessages': 'Divide las respuestas largas en varios mensajes, uno por párrafo, como una persona escribiendo.',
        'timePerChar': 'Espera antes de cada mensaje, en milisegundos por carácter (mínimo 1 s, máximo 20 s), para '
                       'simular escritura.',
        'keepOpen': 'Al cerrar la conversación (palabra de finalización o acción "Cerrar"), el contacto queda como '
                    '"Cerrada" y la IA no vuelve a responder hasta que se reactive. Desactivado: la sesión se borra y '
                    'el próximo mensaje del contacto inicia una conversación nueva.',
        'maxTokens': 'Tamaño máximo de la respuesta (0 = 500). Los modelos de razonamiento (gpt-5/o-series) gastan '
                     'tokens pensando: usa 2000+.',
        'model': 'Modelo de OpenAI que genera las respuestas. Elige la credencial y haz clic en "Cargar Modelos" para '
                 'ver la lista.',
        'triggerType': 'Cuándo la IA empieza a atender a un contacto: Todos = cualquier mensaje; Palabra clave = solo '
                       'cuando el mensaje coincide con el disparador; Avanzado = condiciones combinadas. Atención: '
                       '"Ninguno" hoy se comporta como "Todos".',
    },
    'fr': {
        'stopBotFromMe': "Quand quelqu'un de l'équipe écrit au contact depuis le numéro lui-même (téléphone, WhatsApp "
                         "Web ou Desktop), l'IA se met en pause dans cette conversation pour ne pas gêner l'humain. "
                         "Voir « Reprendre l'IA après ».",
        'listeningFromMe': "L'IA traite aussi les messages envoyés depuis le numéro lui-même, comme s'ils venaient du "
                           'contact. Généralement désactivé.',
        'expire': "Sans effet sur le bot OpenAI. Pour que l'IA revienne après la prise en main par l'équipe, utilisez "
                  "« Reprendre l'IA après (minutes) ».",
        'keywordFinish': "Si le contact envoie exactement ce mot (ex. : #fin), la conversation avec l'IA est fermée. "
                         'Vide = désactivé.',
        'delayMessage': 'Durée, en millisecondes, d\'affichage de « en train d\'écrire... » avant chaque réponse '
                        '(1000 = 1 seconde).',
        'unknownMessage': "Seul message envoyé au contact quand OpenAI échoue ; laissez vide pour ne rien envoyer.",
        'debounceTime': 'Regroupe les messages envoyés à la suite avant de répondre : attend cette durée (en secondes) '
                        'sans nouveau message puis répond à tout en une fois. 0 = répond à chaque message tout de suite.',
        'splitMessages': 'Découpe les longues réponses en plusieurs messages, un par paragraphe, comme une personne qui '
                         'écrit.',
        'timePerChar': 'Attente avant chaque message, en millisecondes par caractère (minimum 1 s, maximum 20 s), pour '
                       'simuler la frappe.',
        'keepOpen': "À la fermeture (mot de fin ou action « Fermer »), le contact reste « Fermée » et l'IA ne répond "
                    "plus tant qu'elle n'est pas réactivée. Désactivé : la session est supprimée et le prochain message "
                    'du contact démarre une nouvelle conversation.',
        'maxTokens': 'Taille maximale de la réponse (0 = 500). Les modèles de raisonnement (gpt-5/o-series) consomment '
                     'des tokens pour réfléchir : utilisez 2000+.',
        'model': 'Modèle OpenAI qui rédige les réponses. Choisissez les identifiants et cliquez sur « Charger les '
                 'Modèles » pour voir la liste.',
        'triggerType': "Quand l'IA commence à servir un contact : Tous = n'importe quel message ; Mot-clé = seulement si "
                       'le message correspond au déclencheur ; Avancé = conditions combinées. Attention : « Aucun » se '
                       'comporte aujourd\'hui comme « Tous ».',
    },
}

# (component, field, t function) -> description key. Bot form uses `f`, default settings use `e`.
HELP_FIELDS = [
    ('Pe', 'stopBotFromMe', 'f'), ('Pe', 'listeningFromMe', 'f'), ('le', 'expire', 'f'),
    ('le', 'keywordFinish', 'f'), ('le', 'delayMessage', 'f'), ('le', 'unknownMessage', 'f'),
    ('le', 'debounceTime', 'f'), ('Pe', 'splitMessages', 'f'), ('le', 'timePerChar', 'f'), ('Pe', 'keepOpen', 'f'),
    ('le', 'maxTokens', 'f'), ('Jt', 'model', 'f'), ('Jt', 'triggerType', 'f'),
    ('Pe', 'stopBotFromMe', 'e'), ('Pe', 'listeningFromMe', 'e'), ('le', 'expire', 'e'),
    ('le', 'keywordFinish', 'e'), ('le', 'delayMessage', 'e'), ('le', 'unknownMessage', 'e'),
    ('le', 'debounceTime', 'e'), ('Pe', 'splitMessages', 'e'), ('le', 'timePerChar', 'e'), ('Pe', 'keepOpen', 'e'),
]


def patch_help(s):
    for comp, field, fn in HELP_FIELDS:
        old = f'i.jsx({comp},{{name:"{field}",label:{fn}("openai.form.{field}.label"),'
        new = old + f'helper:{fn}("openai.form.help.{field}"),'
        s = rep(s, old, new, f'help {field} ({fn})')
    texts = {k: 'help:' + js(v) + ',' for k, v in HELP_TEXT.items()}
    return insert_in_form(s, texts, 'help translations')


# ---------------------------------------------------------------------------------------------------------------
# Group "pause"
# ---------------------------------------------------------------------------------------------------------------
PAUSE_TEXT = {
    'pt': {
        'active': 'IA ativa', 'human': 'Pausada por humano', 'manual': 'Pausada manualmente',
        'legacy': 'Pausada (anterior à atualização)', 'paused': 'Pausada', 'closed': 'Encerrada',
        'resumesIn': 'Volta em {{time}}', 'resumesNext': 'Volta na próxima mensagem do contato',
        'manualOnly': 'Só volta quando reativada manualmente', 'lastHuman': 'Última mensagem humana: {{time}}',
        'resumeNow': 'Reativar agora', 'pause': 'Pausar', 'bot': 'Bot',
        'actionResume': 'Reativar IA', 'actionPause': 'Pausar IA', 'actionClose': 'Encerrar',
        'actionDelete': 'Excluir sessão',
    },
    'en': {
        'active': 'AI active', 'human': 'Paused by a human', 'manual': 'Paused manually',
        'legacy': 'Paused (before the update)', 'paused': 'Paused', 'closed': 'Closed',
        'resumesIn': 'Resumes in {{time}}', 'resumesNext': "Resumes on the contact's next message",
        'manualOnly': 'Only resumes when reactivated manually', 'lastHuman': 'Last human message: {{time}}',
        'resumeNow': 'Resume now', 'pause': 'Pause', 'bot': 'Bot',
        'actionResume': 'Resume AI', 'actionPause': 'Pause AI', 'actionClose': 'Close', 'actionDelete': 'Delete session',
    },
    'es': {
        'active': 'IA activa', 'human': 'Pausada por un humano', 'manual': 'Pausada manualmente',
        'legacy': 'Pausada (anterior a la actualización)', 'paused': 'Pausada', 'closed': 'Cerrada',
        'resumesIn': 'Vuelve en {{time}}', 'resumesNext': 'Vuelve con el próximo mensaje del contacto',
        'manualOnly': 'Solo vuelve cuando se reactiva manualmente', 'lastHuman': 'Último mensaje humano: {{time}}',
        'resumeNow': 'Reactivar ahora', 'pause': 'Pausar', 'bot': 'Bot',
        'actionResume': 'Reactivar IA', 'actionPause': 'Pausar IA', 'actionClose': 'Cerrar',
        'actionDelete': 'Eliminar sesión',
    },
    'fr': {
        'active': 'IA active', 'human': 'En pause (humain)', 'manual': 'En pause (manuelle)',
        'legacy': 'En pause (avant la mise à jour)', 'paused': 'En pause', 'closed': 'Fermée',
        'resumesIn': 'Reprend dans {{time}}', 'resumesNext': 'Reprend au prochain message du contact',
        'manualOnly': 'Ne reprend que si réactivée manuellement', 'lastHuman': 'Dernier message humain : {{time}}',
        'resumeNow': 'Réactiver', 'pause': 'Mettre en pause', 'bot': 'Bot',
        'actionResume': "Réactiver l'IA", 'actionPause': "Mettre l'IA en pause", 'actionClose': 'Fermer',
        'actionDelete': 'Supprimer la session',
    },
}

RJ_COL = ('{accessorKey:"remoteJid",header:()=>i.jsx("div",{className:"text-center",'
          'children:t("openai.sessions.table.remoteJid")}),cell:({row:w})=>i.jsx("div",{children:w.getValue("remoteJid")})}')
SID_COL = ('{accessorKey:"sessionId",header:()=>i.jsx("div",{className:"text-center",'
           'children:t("openai.sessions.table.sessionId")}),cell:({row:w})=>i.jsx("div",{children:w.getValue("sessionId")})}')

STATE_CELL = (
    # time left as "1h 30min" / "45min" / "2d 3h"
    'const __ofFmt=_sec=>{const _m=Math.max(1,Math.ceil(_sec/60)),_h=Math.floor(_m/60),_d=Math.floor(_h/24);'
    'return _d>0?`${_d}d ${_h%24}h`:_h>0?(_m%60?`${_h}h ${_m%60}min`:`${_h}h`):`${_m}min`},'
    # humanPause: null = not paused; undefined = old backend (falls back to the plain status)
    '__ofCell=_c=>{const _p=_c.humanPause,_g="border-emerald-500/20 bg-emerald-50/50 text-emerald-900",'
    '_a="border-amber-500/20 bg-amber-50/50 text-amber-900";let _k,_cl;'
    'if(_c.status==="closed")_k="closed";'
    'else if(_p){_k=_p.reason==="manual"?"manual":_p.reason==="legacy"?"legacy":"human";_cl=_a}'
    'else if(_c.status==="paused"){_k="paused";_cl=_a}'
    'else if(_c.status==="opened"){_k="active";_cl=_g}'
    'const _isP=!!_p||_c.status==="paused",_l=[];'
    'if(_p){if(_p.autoResume&&typeof _p.remainingSeconds==="number"){'
    'const _r=Math.max(0,_p.remainingSeconds-Math.floor(Math.max(0,__ofNow-(__ofDU||__ofNow))/1e3));'
    '_l.push(_r>0?t("openai.sessions.state.resumesIn",{time:__ofFmt(_r)}):t("openai.sessions.state.resumesNext"))}'
    'else _l.push(t("openai.sessions.state.manualOnly"));'
    'if(_p.lastHumanMessageAt){const _t=new Date(_p.lastHumanMessageAt);'
    'isNaN(_t.getTime())||_l.push(t("openai.sessions.state.lastHuman",{time:_t.toLocaleString(void 0,'
    '{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}))}}'
    'return i.jsxs("div",{className:"flex min-w-[8rem] flex-col items-start gap-1","data-session-state":_k||_c.status,children:['
    '_k?i.jsx(vu,{variant:_k==="closed"?"secondary":"outline",className:_cl,children:t("openai.sessions.state."+_k)})'
    ':i.jsx("span",{children:_c.status}),'
    '..._l.map((_z,_j)=>i.jsx("span",{className:"text-xs text-muted-foreground",children:_z},_j)),'
    '_c.status!=="closed"&&i.jsx(se,{type:"button",size:"sm",variant:_isP?"default":"outline",className:"mt-1",'
    'onClick:()=>x(_c.remoteJid,_isP?"opened":"paused"),'
    'children:t(_isP?"openai.sessions.state.resumeNow":"openai.sessions.state.pause")})]})};'
)


def patch_pause(s):
    # Columns: contact name and AI state first (what matters, and what fits a phone screen), then jid and session id
    s = rep(s, SID_COL + ',', '', 'sessions: move sessionId column')
    # Sessions query keyed by bot (it was shared by every bot of the instance)
    s = rep(s, 'queryKey:yre({instanceName:t})', 'queryKey:yre({instanceName:t,openaiId:r})', 'sessions query key')
    # Without a bot (header button of the OpenAI page) list every OpenAI session of the instance: the backend
    # returns all of them when the bot id does not exist. Re-fetch every minute and tick the countdown every 30 s.
    s = rep(s,
            '{data:d,refetch:f}=xre({instanceName:n?.name,openaiId:e,enabled:l}),[h,m]=y.useState("");function g(){f()}',
            '{data:d,refetch:f,dataUpdatedAt:__ofDU}=xre({instanceName:n?.name,openaiId:e??"all",enabled:l,'
            'refetchInterval:6e4}),[h,m]=y.useState(""),[__ofNow,__ofSetNow]=y.useState(()=>Date.now()),'
            '{data:__ofBots}=FI({instanceName:n?.name,enabled:l&&!e});'
            'y.useEffect(()=>{if(!l)return;__ofSetNow(Date.now());const __ofI=setInterval(()=>__ofSetNow(Date.now()),3e4);'
            'return()=>clearInterval(__ofI)},[l,__ofDU]);function g(){f()}',
            'sessions query')
    s = rep(s,
            '{accessorKey:"status",header:()=>i.jsx("div",{className:"text-center",'
            'children:t("openai.sessions.table.status")}),cell:({row:w})=>i.jsx("div",{children:w.getValue("status")})}',
            '...(e?[]:[{accessorKey:"botId",header:()=>i.jsx("div",{className:"text-center",'
            'children:t("openai.sessions.state.bot")}),cell:({row:w})=>i.jsx("div",{children:'
            '__ofBots?.find?.(_b=>_b.id===w.original.botId)?.description||w.original.botId||""})}]),'
            '{accessorKey:"status",header:()=>i.jsx("div",{className:"text-center",'
            'children:t("openai.sessions.table.status")}),cell:({row:w})=>__ofCell(w.original)},' + RJ_COL + ',' + SID_COL,
            'sessions status cell')
    # The dialog is a grid: without min-w-0 the table stretches it past a phone screen instead of scrolling
    s = rep(s,
            'i.jsxs("div",{children:[i.jsxs("div",{className:"flex items-center justify-between gap-6 p-5",'
            'children:[i.jsx(ne,{placeholder:t("openai.sessions.search")',
            'i.jsxs("div",{className:"min-w-0",children:[i.jsxs("div",{className:"flex items-center justify-between '
            'gap-6 p-5",children:[i.jsx(ne,{placeholder:t("openai.sessions.search")',
            'sessions dialog width')
    # helpers live inside $I (they use t, x and the clock state)
    s = rep(s,
            'const x=async(w,C)=>{try{if(!n)return;await r({instanceName:n.name,token:n.token,remoteJid:w,status:C}),'
            'me.success(t("openai.toast.success.status")),g()}catch(k){console.error("Error:",k),'
            'me.error(`Erro: ${k?.response?.data?.response?.message}`)}},b=[' + RJ_COL + ',',
            'const x=async(w,C)=>{try{if(!n)return;await r({instanceName:n.name,token:n.token,remoteJid:w,status:C}),'
            'me.success(t("openai.toast.success.status")),g()}catch(k){console.error("Error:",k),'
            'me.error(`Erro: ${k?.response?.data?.response?.message}`)}};' + STATE_CELL + 'const b=[',
            'sessions helpers')
    # Dropdown: "resume" also for a session that is opened but still marked as human paused
    s = rep(s,
            'C.status!=="opened"&&i.jsxs(wt,{onClick:()=>x(C.remoteJid,"opened"),children:[i.jsx(Fi,'
            '{className:"mr-2 h-4 w-4"}),t("openai.sessions.table.actions.open")]})',
            '(C.status!=="opened"||!!C.humanPause)&&i.jsxs(wt,{onClick:()=>x(C.remoteJid,"opened"),children:[i.jsx(Fi,'
            '{className:"mr-2 h-4 w-4"}),t("openai.sessions.state.actionResume")]})',
            'dropdown resume')
    s = rep(s, 't("openai.sessions.table.actions.pause")', 't("openai.sessions.state.actionPause")', 'dropdown pause')
    s = rep(s, 't("openai.sessions.table.actions.close")', 't("openai.sessions.state.actionClose")', 'dropdown close')
    s = rep(s, 't("openai.sessions.table.actions.delete")', 't("openai.sessions.state.actionDelete")', 'dropdown delete')
    texts = {k: 'state:' + js(v) + ',' for k, v in PAUSE_TEXT.items()}
    return insert_translations(s, 'sessions:{', texts, 'pause translations')


GROUPS = [('tokens', patch_tokens), ('help', patch_help), ('pause', patch_pause)]


def bump_index(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag not found exactly once')
    end = html.index('"', pos)
    current = html[pos + len(SCRIPT_TAG):end]
    if current == CACHE_VERSION:
        return html
    if not current.isdigit() or int(current) >= int(CACHE_VERSION):
        raise PatchError(f'index.html: unexpected bundle version ?v={current}')
    return html[:pos + len(SCRIPT_TAG)] + CACHE_VERSION + html[end:]


def main():
    check = '--check' in sys.argv[1:]
    s = open(BUNDLE, encoding='utf-8').read()
    html = open(INDEX, encoding='utf-8').read()
    missing = [name for name, _ in GROUPS if marker(name) not in s]

    if check:
        ok = not missing and bump_index(html) == html
        print('ok: all groups applied' if ok else f'missing: {missing or ["index.html cache version"]}')
        return 0 if ok else 1

    report = []
    for name, fn in GROUPS:
        if name not in missing:
            report.append(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        report.append(f'{name}: applied')

    new_html = bump_index(html)
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    print('\n'.join(report))
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
        print(f'index.html: bundle ?v={CACHE_VERSION}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(2)
