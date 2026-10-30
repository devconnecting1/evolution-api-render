#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager bundle: OpenAI media options and conversation window.

Same method as openai-fields.py and responsive.py: manager/dist is the upstream evolution-manager-v2 2.3.5 build
plus manual customizations, so changes are exact string replacements on the minified bundle instead of a rebuild.

Groups (each one is applied once and leaves a marker comment at the top of the bundle):
  media   - "Mídia (áudio, imagem, documentos)" section in the OpenAI bot form (create/edit) and in the default
            settings: transcribeAudio, transcriptionModel, maxAudioSeconds, readImages, readDocuments,
            maxDocumentMB. On the bot every field can inherit: switches become "Herdar / Ligado / Desligado"
            selects and numbers/model stay empty; only chosen values are sent (false and 0 are sent).
            A short description under the existing "Fala para Texto" switch tells it apart.
  history - historyMessages (previous messages the AI remembers) next to maxTokens in the bot form (Chat
            Completion only) and next to tokenParam in the default settings.
Applying also bumps the bundle ?v= in index.html (to CACHE_VERSION) so browsers fetch the patched bundle.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped.
Order: run after openai-fields.py and responsive.py (it relies on the tokens/help groups of openai-fields.py).

Usage (from the repository root):
  python3 -I manager/patches/openai-media.py           # apply
  python3 -I manager/patches/openai-media.py --check   # exit 1 unless every group is applied
Validate afterwards: cp manager/dist/assets/index-b29a5d7a.js /tmp/x.mjs && node --check /tmp/x.mjs
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CACHE_VERSION = '10'
LANGS = ('en', 'es', 'fr', 'pt')
REQUIRED = ('/*whatsai-patch:openai-fields:tokens*/', '/*whatsai-patch:openai-fields:help*/')


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:openai-media:' + name + '*/'


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
    # openai-fields.py (pause group) inserted `state:{...}` at the start of `sessions`: look a bit further
    anchor = '{title:"OpenAI",sessions:{'
    found = {}
    start = -1
    while True:
        start = s.find(anchor, start + 1)
        if start < 0:
            break
        head = s[start:start + 1500]
        langs = [k for k, v in search.items() if v in head]
        if len(langs) != 1:
            raise PatchError(f'translations: cannot identify language at {start}')
        found[langs[0]] = start
    if sorted(found) != sorted(LANGS) or s.count(anchor) != 4:
        raise PatchError(f'translations: expected 4 OpenAI objects, got {sorted(found)}')
    return found


def insert_in_form(s, texts, label):
    """Inserts texts[lang] right after `form:{title:"...",` of each OpenAI translation object."""
    starts = openai_objects(s)
    for lang, start in sorted(starts.items(), key=lambda kv: -kv[1]):
        pos = s.find('form:{title:"', start)
        end = s.find('",', pos)
        limit = s.find('button:{create:"OpenAI"', start)
        if pos < 0 or end < 0 or pos > limit:
            raise PatchError(f'{label}: form anchor not found in {lang}')
        cut = end + 2
        s = s[:cut] + texts[lang] + s[cut:]
    return s


# ---------------------------------------------------------------------------------------------------------------
# Texts
# ---------------------------------------------------------------------------------------------------------------
MEDIA_TEXT = {
    'pt': {
        'section': 'Mídia (áudio, imagem, documentos)',
        'intro': 'O que a IA faz com o que o contato envia. Vídeos, figurinhas, localizações e contatos chegam à IA '
                 'como uma frase (ex.: "[o contato enviou um vídeo]").',
        'inherit': 'Herdar das configurações padrão',
        'on': 'Ligado',
        'off': 'Desligado',
        'placeholder': 'Herdar das configurações padrão',
        'inheritNote': '"Herdar" usa o valor das Configurações Padrão.',
        'ownValueNote': 'Este bot já tem um valor próprio: depois de definido, não dá para voltar a herdar por aqui.',
        'fieldInheritNote': 'Deixe vazio para herdar das Configurações Padrão.',
        'fieldOwnValueNote': 'Este bot já tem um valor próprio: apagar o campo não volta a herdar (o valor atual é '
                             'mantido).',
        'speechToTextHelp': 'Transcreve os áudios já no recebimento, para o webhook, o Chatwoot e os outros bots. '
                            'Ligado, o áudio chega transcrito também à IA OpenAI, mesmo com "Transcrever áudios" '
                            'desligado.',
        'transcribeAudio': {
            'label': 'Transcrever áudios',
            'description': 'A IA transcreve os áudios do contato e responde ao que foi dito. Desligado: a IA só fica '
                           'sabendo que chegou um áudio.',
        },
        'transcriptionModel': {
            'label': 'Modelo de transcrição',
            'description': 'Modelo da OpenAI que transcreve os áudios (recomendado: gpt-transcribe). Se a OpenAI '
                           'recusar o modelo, usa whisper-1.',
        },
        'maxAudioSeconds': {
            'label': 'Duração máxima do áudio (segundos)',
            'description': 'Áudios mais longos não são transcritos: a IA recebe que a equipe vai ouvir. 0 = sem '
                           'limite. Padrão 300 (5 min).',
        },
        'readImages': {
            'label': 'Ler imagens',
            'description': 'A IA vê fotos e prints enviados (custo um pouco maior). Desligado: a IA só recebe a '
                           'legenda e o aviso de que chegou uma imagem.',
        },
        'readDocuments': {
            'label': 'Ler PDFs',
            'description': 'A IA lê PDFs de até 20 páginas dentro do tamanho máximo. Word, Excel e outros formatos '
                           '(e PDFs maiores) chegam só com o nome e o tipo do arquivo.',
        },
        'maxDocumentMB': {
            'label': 'Tamanho máximo do PDF (MB)',
            'description': 'PDFs maiores não são enviados à IA. De 1 a 32; padrão 10.',
        },
    },
    'en': {
        'section': 'Media (audio, images, documents)',
        'intro': 'What the AI does with what the contact sends. Videos, stickers, locations and contacts reach the AI '
                 'as a sentence (e.g. "[o contato enviou um vídeo]").',
        'inherit': 'Inherit from default settings',
        'on': 'On',
        'off': 'Off',
        'placeholder': 'Inherit from default settings',
        'inheritNote': '"Inherit" uses the value of the Default Settings.',
        'ownValueNote': 'This bot already has its own value: once set, it cannot go back to inheriting from here.',
        'fieldInheritNote': 'Leave empty to inherit from the Default Settings.',
        'fieldOwnValueNote': 'This bot already has its own value: clearing the field does not inherit again (the '
                             'current value is kept).',
        'speechToTextHelp': 'Transcribes audios on arrival, for the webhook, Chatwoot and the other bots. When on, '
                            'the OpenAI AI also gets the audio already transcribed, even with "Transcribe audios" off.',
        'transcribeAudio': {
            'label': 'Transcribe audios',
            'description': "The AI transcribes the contact's audios and answers what was said. Off: the AI only "
                           'learns that an audio arrived.',
        },
        'transcriptionModel': {
            'label': 'Transcription model',
            'description': 'OpenAI model that transcribes the audios (recommended: gpt-transcribe). If OpenAI rejects '
                           'the model, whisper-1 is used.',
        },
        'maxAudioSeconds': {
            'label': 'Maximum audio length (seconds)',
            'description': 'Longer audios are not transcribed: the AI is told the team will listen. 0 = no limit. '
                           'Default 300 (5 min).',
        },
        'readImages': {
            'label': 'Read images',
            'description': 'The AI sees the photos and screenshots sent (a bit more expensive). Off: the AI only gets '
                           'the caption and a note that an image arrived.',
        },
        'readDocuments': {
            'label': 'Read PDFs',
            'description': 'The AI reads PDFs of up to 20 pages within the maximum size. Word, Excel and other formats '
                           '(and larger PDFs) arrive with the file name and type only.',
        },
        'maxDocumentMB': {
            'label': 'Maximum PDF size (MB)',
            'description': 'Larger PDFs are not sent to the AI. From 1 to 32; default 10.',
        },
    },
    'es': {
        'section': 'Multimedia (audio, imagen, documentos)',
        'intro': 'Qué hace la IA con lo que envía el contacto. Videos, stickers, ubicaciones y contactos llegan a la '
                 'IA como una frase (ej.: "[o contato enviou um vídeo]").',
        'inherit': 'Heredar de la configuración predeterminada',
        'on': 'Activado',
        'off': 'Desactivado',
        'placeholder': 'Heredar de la configuración predeterminada',
        'inheritNote': '"Heredar" usa el valor de las Configuraciones Predeterminadas.',
        'ownValueNote': 'Este bot ya tiene un valor propio: una vez definido, no se puede volver a heredar desde aquí.',
        'fieldInheritNote': 'Déjalo vacío para heredar de las Configuraciones Predeterminadas.',
        'fieldOwnValueNote': 'Este bot ya tiene un valor propio: borrar el campo no vuelve a heredar (se mantiene el '
                             'valor actual).',
        'speechToTextHelp': 'Transcribe los audios al recibirlos, para el webhook, Chatwoot y los otros bots. '
                            'Activado, el audio también llega transcrito a la IA OpenAI, aunque "Transcribir audios" '
                            'esté desactivado.',
        'transcribeAudio': {
            'label': 'Transcribir audios',
            'description': 'La IA transcribe los audios del contacto y responde a lo dicho. Desactivado: la IA solo '
                           'sabe que llegó un audio.',
        },
        'transcriptionModel': {
            'label': 'Modelo de transcripción',
            'description': 'Modelo de OpenAI que transcribe los audios (recomendado: gpt-transcribe). Si OpenAI '
                           'rechaza el modelo, usa whisper-1.',
        },
        'maxAudioSeconds': {
            'label': 'Duración máxima del audio (segundos)',
            'description': 'Los audios más largos no se transcriben: la IA recibe que el equipo lo escuchará. 0 = sin '
                           'límite. Predeterminado 300 (5 min).',
        },
        'readImages': {
            'label': 'Leer imágenes',
            'description': 'La IA ve las fotos y capturas enviadas (costo un poco mayor). Desactivado: la IA solo '
                           'recibe el pie de foto y el aviso de que llegó una imagen.',
        },
        'readDocuments': {
            'label': 'Leer PDFs',
            'description': 'La IA lee PDFs de hasta 20 páginas dentro del tamaño máximo. Word, Excel y otros formatos '
                           '(y PDFs más grandes) llegan solo con el nombre y el tipo del archivo.',
        },
        'maxDocumentMB': {
            'label': 'Tamaño máximo del PDF (MB)',
            'description': 'Los PDFs más grandes no se envían a la IA. De 1 a 32; predeterminado 10.',
        },
    },
    'fr': {
        'section': 'Médias (audio, images, documents)',
        'intro': "Ce que l'IA fait de ce que le contact envoie. Vidéos, autocollants, positions et contacts arrivent à "
                 "l'IA sous forme de phrase (ex. : « [o contato enviou um vídeo] »).",
        'inherit': 'Hériter des paramètres par défaut',
        'on': 'Activé',
        'off': 'Désactivé',
        'placeholder': 'Hériter des paramètres par défaut',
        'inheritNote': '« Hériter » utilise la valeur des Paramètres par Défaut.',
        'ownValueNote': 'Ce bot a déjà sa propre valeur : une fois définie, impossible de revenir à « Hériter » ici.',
        'fieldInheritNote': 'Laissez vide pour hériter des Paramètres par Défaut.',
        'fieldOwnValueNote': 'Ce bot a déjà sa propre valeur : vider le champ ne fait pas hériter de nouveau (la '
                             'valeur actuelle est conservée).',
        'speechToTextHelp': "Transcrit les audios dès leur réception, pour le webhook, Chatwoot et les autres bots. "
                            "Activé, l'audio arrive aussi transcrit à l'IA OpenAI, même si « Transcrire les audios » "
                            'est désactivé.',
        'transcribeAudio': {
            'label': 'Transcrire les audios',
            'description': "L'IA transcrit les audios du contact et répond à ce qui a été dit. Désactivé : l'IA sait "
                           "seulement qu'un audio est arrivé.",
        },
        'transcriptionModel': {
            'label': 'Modèle de transcription',
            'description': "Modèle OpenAI qui transcrit les audios (recommandé : gpt-transcribe). Si OpenAI refuse le "
                           'modèle, whisper-1 est utilisé.',
        },
        'maxAudioSeconds': {
            'label': "Durée maximale de l'audio (secondes)",
            'description': "Les audios plus longs ne sont pas transcrits : l'IA est informée que l'équipe va les "
                           'écouter. 0 = sans limite. Par défaut 300 (5 min).',
        },
        'readImages': {
            'label': 'Lire les images',
            'description': "L'IA voit les photos et captures envoyées (coût un peu plus élevé). Désactivé : l'IA ne "
                           "reçoit que la légende et l'avis qu'une image est arrivée.",
        },
        'readDocuments': {
            'label': 'Lire les PDF',
            'description': "L'IA lit les PDF de 20 pages maximum dans la taille maximale. Word, Excel et les autres "
                           'formats (et les PDF plus gros) arrivent seulement avec le nom et le type du fichier.',
        },
        'maxDocumentMB': {
            'label': 'Taille maximale du PDF (Mo)',
            'description': "Les PDF plus gros ne sont pas envoyés à l'IA. De 1 à 32 ; par défaut 10.",
        },
    },
}

HISTORY_TEXT = {
    'pt': {
        'label': 'Memória da conversa (mensagens)',
        'description': 'Quantas mensagens anteriores a IA lembra. Mais mensagens = menos perguntas repetidas e custo '
                       'um pouco maior. Recomendado 30–40 para triagens longas. De 2 a 100; padrão 10.',
    },
    'en': {
        'label': 'Conversation memory (messages)',
        'description': 'How many previous messages the AI remembers. More messages = fewer repeated questions and a '
                       'slightly higher cost. 30–40 recommended for long screenings. From 2 to 100; default 10.',
    },
    'es': {
        'label': 'Memoria de la conversación (mensajes)',
        'description': 'Cuántos mensajes anteriores recuerda la IA. Más mensajes = menos preguntas repetidas y un '
                       'costo un poco mayor. Recomendado 30–40 para triajes largos. De 2 a 100; predeterminado 10.',
    },
    'fr': {
        'label': 'Mémoire de la conversation (messages)',
        'description': "Combien de messages précédents l'IA retient. Plus de messages = moins de questions répétées "
                       'et un coût un peu plus élevé. 30–40 recommandés pour les longs triages. De 2 à 100 ; par '
                       'défaut 10.',
    },
}

BOOLEAN_FIELDS = ('transcribeAudio', 'readImages', 'readDocuments')
NUMBER_FIELDS = {'maxAudioSeconds': (0, None), 'maxDocumentMB': (1, 32), 'historyMessages': (2, 100)}
T = 'openai.form.mediaOptions.'


def zod_number(name):
    low, high = NUMBER_FIELDS[name]
    rule = f'P.number().int().min({low})' + (f'.max({high})' if high else '')
    return f'{name}:P.preprocess(e=>e===""||e==null||Number.isNaN(Number(e))?void 0:Number(e),{rule}.optional())'


def input_attrs(name):
    low, high = NUMBER_FIELDS[name]
    return f'type:"number",min:{low},' + (f'max:{high},' if high else '') + 'step:1'


# --- bot form (BI): `f` = t, `e` = initialData of the edited bot (undefined on create) ---------------------------
def bot_select(name):
    own = f'(e?.{name}==="true"||e?.{name}==="false")'
    return (f'i.jsx(Jt,{{name:"{name}",label:f("{T}{name}.label"),helper:f("{T}{name}.description")+" "+'
            f'f({own}?"{T}ownValueNote":"{T}inheritNote"),options:[...({own}?[]:[{{label:f("{T}inherit"),'
            f'value:"inherit"}}]),{{label:f("{T}on"),value:"true"}},{{label:f("{T}off"),value:"false"}}]}})')


def bot_input(name, label_key=None, attrs=None):
    label_key = label_key or f'{T}{name}'
    own = f'e?.{name}!=null&&e?.{name}!==""'
    attrs = attrs if attrs is not None else input_attrs(name) + ','
    return (f'i.jsx(le,{{name:"{name}",label:f("{label_key}.label"),helper:f("{label_key}.description")+" "+'
            f'f({own}?"{T}fieldOwnValueNote":"{T}fieldInheritNote"),'
            f'children:i.jsx(ne,{{{attrs}placeholder:f("{T}placeholder")}})}})')


def section(t):
    return (f'i.jsxs("div",{{className:"flex flex-col",children:[i.jsx("h3",{{className:"my-4 text-lg font-medium",'
            f'children:{t}("{T}section")}}),i.jsx($t,{{}}),i.jsx("p",{{className:"mt-3 text-sm text-muted-foreground",'
            f'children:{t}("{T}intro")}})]}})')


def bot_payload(v):
    """Only what was chosen: "inherit"/empty = field absent (inherits); false and 0 are sent."""
    parts = [f'...({v}.{n}==="true"||{v}.{n}==="false")?{{{n}:{v}.{n}==="true"}}:{{}}' for n in BOOLEAN_FIELDS]
    parts.append(f'...typeof {v}.transcriptionModel==="string"&&{v}.transcriptionModel.trim()?'
                 f'{{transcriptionModel:{v}.transcriptionModel.trim()}}:{{}}')
    parts += [f'...{v}.{n}!==void 0&&{v}.{n}!==null?{{{n}:{v}.{n}}}:{{}}' for n in NUMBER_FIELDS]
    return ','.join(parts)


# --- default settings (hre): `e` = t, `h` = form ----------------------------------------------------------------
def settings_switch(name):
    return f'i.jsx(Pe,{{name:"{name}",label:e("{T}{name}.label"),helper:e("{T}{name}.description"),reverse:!0}})'


def settings_input(name, label_key=None, attrs=None):
    label_key = label_key or f'{T}{name}'
    attrs = attrs if attrs is not None else input_attrs(name)
    return (f'i.jsx(le,{{name:"{name}",label:e("{label_key}.label"),helper:e("{label_key}.description"),'
            f'children:i.jsx(ne,{{{attrs}}})}})')


def patch_media(s):
    # --- bot form: schema, defaults, section ---
    s = rep(s,
            'tokenParam:P.enum(["inherit","auto","max_tokens","max_completion_tokens"]).optional(),',
            'tokenParam:P.enum(["inherit","auto","max_tokens","max_completion_tokens"]).optional(),'
            + ''.join(f'{n}:P.enum(["inherit","true","false"]).optional(),' for n in BOOLEAN_FIELDS)
            + 'transcriptionModel:P.string().max(100).optional(),'
            + zod_number('maxAudioSeconds') + ',' + zod_number('maxDocumentMB') + ',',
            'bot schema')
    s = rep(s,
            'splitMessages:!1,timePerChar:0,tokenParam:"inherit"}}),C=w.watch("botType")',
            'splitMessages:!1,timePerChar:0,tokenParam:"inherit",transcribeAudio:"inherit",transcriptionModel:"",'
            'readImages:"inherit",readDocuments:"inherit"}}),C=w.watch("botType")',
            'bot defaults')
    bot_fields = ','.join([
        section('f'),
        bot_select('transcribeAudio'),
        bot_input('transcriptionModel', attrs='maxLength:100,'),
        bot_input('maxAudioSeconds'),
        bot_select('readImages'),
        bot_select('readDocuments'),
        bot_input('maxDocumentMB'),
    ])
    s = rep(s,
            'helper:f("openai.form.help.timePerChar"),children:i.jsx(ne,{type:"number"})})]}),s&&i.jsx(Yt,',
            'helper:f("openai.form.help.timePerChar"),children:i.jsx(ne,{type:"number"})}),' + bot_fields
            + ']}),s&&i.jsx(Yt,',
            'bot media section')

    # --- create and update payloads, update initial data ---
    s = rep(s,
            '...f.humanResumeMinutes!==void 0?{humanResumeMinutes:f.humanResumeMinutes}:{}};await r(',
            '...f.humanResumeMinutes!==void 0?{humanResumeMinutes:f.humanResumeMinutes}:{},' + bot_payload('f')
            + '};await r(',
            'create payload')
    s = rep(s,
            '...b.humanResumeMinutes!==void 0?{humanResumeMinutes:b.humanResumeMinutes}:{}};await d(',
            '...b.humanResumeMinutes!==void 0?{humanResumeMinutes:b.humanResumeMinutes}:{},' + bot_payload('b')
            + '};await d(',
            'update payload')
    s = rep(s,
            'humanResumeMinutes:f?.humanResumeMinutes??void 0}),[f?.tokenParam,f?.humanResumeMinutes,',
            'humanResumeMinutes:f?.humanResumeMinutes??void 0,'
            + ''.join(f'{n}:f?.{n}==null?"inherit":String(f.{n}),' for n in BOOLEAN_FIELDS)
            + 'transcriptionModel:f?.transcriptionModel??"",maxAudioSeconds:f?.maxAudioSeconds??void 0,'
            'maxDocumentMB:f?.maxDocumentMB??void 0}),[f?.tokenParam,f?.humanResumeMinutes,'
            + ''.join(f'f?.{n},' for n in BOOLEAN_FIELDS)
            + 'f?.transcriptionModel,f?.maxAudioSeconds,f?.maxDocumentMB,',
            'update initialData')

    # --- default settings: schema, defaults, reset, payload, section ---
    s = rep(s,
            'humanResumeMinutes:P.coerce.number().int().min(0).default(0)});function hre(){',
            'humanResumeMinutes:P.coerce.number().int().min(0).default(0),transcribeAudio:P.boolean().default(!0),'
            'transcriptionModel:P.string().trim().min(1).max(100).default("gpt-transcribe"),'
            'maxAudioSeconds:P.coerce.number().int().min(0).default(300),readImages:P.boolean().default(!0),'
            'readDocuments:P.boolean().default(!0),maxDocumentMB:P.coerce.number().int().min(1).max(32).default(10)});'
            'function hre(){',
            'settings schema')
    s = rep(s,
            'tokenParam:"auto",humanResumeMinutes:0}});y.useEffect(()=>{o&&h.reset({',
            'tokenParam:"auto",humanResumeMinutes:0,transcribeAudio:!0,transcriptionModel:"gpt-transcribe",'
            'maxAudioSeconds:300,readImages:!0,readDocuments:!0,maxDocumentMB:10}});y.useEffect(()=>{o&&h.reset({',
            'settings defaults')
    s = rep(s,
            'tokenParam:o.tokenParam??"auto",humanResumeMinutes:o.humanResumeMinutes??0})},[o]);',
            'tokenParam:o.tokenParam??"auto",humanResumeMinutes:o.humanResumeMinutes??0,'
            'transcribeAudio:o.transcribeAudio??!0,transcriptionModel:o.transcriptionModel||"gpt-transcribe",'
            'maxAudioSeconds:o.maxAudioSeconds??300,readImages:o.readImages??!0,readDocuments:o.readDocuments??!0,'
            'maxDocumentMB:o.maxDocumentMB??10})},[o]);',
            'settings reset')
    s = rep(s,
            'tokenParam:x.tokenParam,humanResumeMinutes:x.humanResumeMinutes};await n({',
            'tokenParam:x.tokenParam,humanResumeMinutes:x.humanResumeMinutes,transcribeAudio:x.transcribeAudio,'
            'transcriptionModel:x.transcriptionModel,maxAudioSeconds:x.maxAudioSeconds,readImages:x.readImages,'
            'readDocuments:x.readDocuments,maxDocumentMB:x.maxDocumentMB};await n({',
            'settings payload')
    settings_fields = ','.join([
        section('e'),
        settings_switch('transcribeAudio'),
        settings_input('transcriptionModel', attrs='maxLength:100'),
        settings_input('maxAudioSeconds'),
        settings_switch('readImages'),
        settings_switch('readDocuments'),
        settings_input('maxDocumentMB'),
    ])
    s = rep(s,
            'placeholder:e("openai.form.ignoreJids.placeholder")})]})}),i.jsx(Yt,{children:i.jsx(se,{type:"submit",'
            'children:e("openai.button.save")})})',
            'placeholder:e("openai.form.ignoreJids.placeholder")}),' + settings_fields + ']})}),i.jsx(Yt,{children:'
            'i.jsx(se,{type:"submit",children:e("openai.button.save")})})',
            'settings media section')
    s = rep(s,
            'i.jsx(Pe,{name:"speechToText",label:e("openai.form.speechToText.label"),reverse:!0})',
            f'i.jsx(Pe,{{name:"speechToText",label:e("openai.form.speechToText.label"),'
            f'helper:e("{T}speechToTextHelp"),reverse:!0}})',
            'settings speechToText help')

    texts = {k: 'mediaOptions:' + js(v) + ',' for k, v in MEDIA_TEXT.items()}
    return insert_in_form(s, texts, 'media translations')


def patch_history(s):
    # --- bot form: Chat Completion only (the Assistants API keeps the thread itself), right after tokenParam ---
    s = rep(s,
            'transcriptionModel:P.string().max(100).optional(),',
            'transcriptionModel:P.string().max(100).optional(),' + zod_number('historyMessages') + ',',
            'bot schema')
    s = rep(s,
            'value:"max_completion_tokens"}]})]}),i.jsxs("div",{className:"flex flex-col",children:[i.jsx("h3",'
            '{className:"my-4 text-lg font-medium",children:f("openai.form.triggerSettings.label")})',
            'value:"max_completion_tokens"}]}),'
            + bot_input('historyMessages', label_key='openai.form.historyMessages')
            + ']}),i.jsxs("div",{className:"flex flex-col",children:[i.jsx("h3",'
            '{className:"my-4 text-lg font-medium",children:f("openai.form.triggerSettings.label")})',
            'bot historyMessages input')
    s = rep(s,
            'maxDocumentMB:f?.maxDocumentMB??void 0}),[',
            'maxDocumentMB:f?.maxDocumentMB??void 0,historyMessages:f?.historyMessages??void 0}),[f?.historyMessages,',
            'update initialData')

    # --- default settings, right after tokenParam ---
    s = rep(s,
            'maxDocumentMB:P.coerce.number().int().min(1).max(32).default(10)});function hre(){',
            'maxDocumentMB:P.coerce.number().int().min(1).max(32).default(10),'
            'historyMessages:P.coerce.number().int().min(2).max(100).default(10)});function hre(){',
            'settings schema')
    s = rep(s,
            'readDocuments:!0,maxDocumentMB:10}});y.useEffect(()=>{o&&h.reset({',
            'readDocuments:!0,maxDocumentMB:10,historyMessages:10}});y.useEffect(()=>{o&&h.reset({',
            'settings defaults')
    s = rep(s,
            'maxDocumentMB:o.maxDocumentMB??10})},[o]);',
            'maxDocumentMB:o.maxDocumentMB??10,historyMessages:o.historyMessages??10})},[o]);',
            'settings reset')
    s = rep(s,
            'maxDocumentMB:x.maxDocumentMB};await n({',
            'maxDocumentMB:x.maxDocumentMB,historyMessages:x.historyMessages};await n({',
            'settings payload')
    s = rep(s,
            '`tokenParam-${h.watch("tokenParam")}`),',
            '`tokenParam-${h.watch("tokenParam")}`),'
            + settings_input('historyMessages', label_key='openai.form.historyMessages') + ',',
            'settings historyMessages input')

    texts = {k: 'historyMessages:' + js(v) + ',' for k, v in HISTORY_TEXT.items()}
    return insert_in_form(s, texts, 'history translations')


GROUPS = [('media', patch_media), ('history', patch_history)]


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

    if check:
        ok = not missing and bump_index(html) == html
        print('ok: all groups applied' if ok else f'missing: {missing or ["index.html cache version"]}')
        return 0 if ok else 1

    if missing and any(required not in s for required in REQUIRED):
        raise PatchError('run manager/patches/openai-fields.py first (tokens and help groups)')

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
