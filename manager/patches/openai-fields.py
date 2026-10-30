#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager bundle (OpenAI integration screens).

Why a patch and not a rebuild: manager/dist is the upstream evolution-manager-v2 2.3.5 build plus manual
customizations made directly in the minified bundle (branding, fixed URL, PT-BR, observability...). Rebuilding
from source would drop them, so changes are applied here as exact string replacements.

Groups (each one is applied once and leaves a marker comment at the top of the bundle):
  tokens  - tokenParam and humanResumeMinutes in the OpenAI bot form (create/edit) and in the default settings;
            FormInput gets an optional `helper` (description) prop; fixes the bot query/form cache that was not
            keyed by bot id (editing bot B could show bot A data).

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


GROUPS = [('tokens', patch_tokens)]


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

    for name, fn in GROUPS:
        if name not in missing:
            print(f'{name}: already applied')
            continue
        s = marker(name) + fn(s)
        print(f'{name}: applied')

    new_html = bump_index(html)
    open(BUNDLE, 'w', encoding='utf-8').write(s)
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
