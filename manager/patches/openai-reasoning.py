#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: "Raciocínio da IA" in the bot form (Atendente IA > Modelo e chave).

The bot gets a `reasoningEffort` select right after "Parâmetro do limite de tokens". The options follow the levels
the chosen model accepts (official OpenAI model pages, Nov 2026), with the recommendation in each label:

  Automático (padrão do modelo) · Nenhum · Mínimo · Baixo · Médio · Alto (recomendado) · Muito alto · Máximo

"Automático" is sent as 'auto' and stored as null (the model default). A model without reasoning (gpt-4o...) only shows
"Não se aplica a este modelo". The select is remounted when the model changes, so the list always matches the model.

Groups:
1. helper  - function WaRE(model) with the levels per model family (mirror of src/.../openai/reasoning-effort.ts).
2. form    - schema field, default 'auto', the select (with help text) after the tokenParam select.
3. payload - create and update send `reasoningEffort`; the edit form starts with the saved value ('auto' for null).
4. models  - the model select shows the label the server adds (price compared to gpt-6-luna, shutdown date).
5. html    - raises the bundle ?v= to CACHE_VERSION.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after openai-fields.py and openai-media.py.

Usage (from the repository root):
  python3 -I manager/patches/openai-reasoning.py           # apply
  python3 -I manager/patches/openai-reasoning.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
CACHE_VERSION = '84'
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='


class PatchError(Exception):
    pass


def marker(name):
    return '/*whatsai-patch:openai-reasoning:' + name + '*/'


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


# ------------------------------------------------------------------------------------------------ 1. helper
HELPER = r'''function WaRE(m){
  const id=String(m||"").trim().toLowerCase().replace(/^ft:([^:]+).*$/,"$1").replace(/-\d{4}-\d{2}-\d{2}$/,"");
  const ALL=["none","low","medium","high","xhigh","max"],NONONE=["low","medium","high","xhigh","max"];
  let lv=null,def="medium",tools=!1;
  if(/^gpt-6\.1-sol\b/.test(id)||/^gpt-6(\.\d+)?-astra\b/.test(id))lv=NONONE;
  else if(/^gpt-6\.1-terra\b/.test(id))lv=ALL;
  else if(/^gpt-6(\.0)?-(luna|sol)\b/.test(id)){lv=ALL;tools=!0}
  else if(/^gpt-5\.6-/.test(id))lv=ALL;
  else if(/^gpt-6/.test(id))lv=["low","medium","high"];
  else if(/^gpt-5(\.\d+)?-pro\b/.test(id)){lv=["high"];def="high"}
  else if(/^gpt-5\.5\b/.test(id))lv=["none","low","medium","high","xhigh"];
  else if(/^gpt-5\.4\b/.test(id)){lv=["none","low","medium","high","xhigh"];def="none"}
  else if(/^gpt-5\.2\b/.test(id)){lv=["none","low","medium","high","xhigh"];def="none"}
  else if(/^gpt-5\.[13]\b/.test(id)){lv=["none","low","medium","high"];def="none"}
  else if(/^gpt-5-chat\b/.test(id))lv=null;
  else if(/^gpt-5(-mini|-nano)?$/.test(id)||/^gpt-5-(mini|nano)\b/.test(id))lv=["minimal","low","medium","high"];
  else if(/^o[134](-mini|-pro)?\b/.test(id))lv=["low","medium","high"];
  const T={none:"Nenhum: sem pensar, mais rápido",minimal:"Mínimo: quase sem pensar",low:"Baixo: rápido",
    medium:"Médio: equilíbrio",high:"Alto: mais cuidadoso (recomendado)",xhigh:"Muito alto: só com teste",
    max:"Máximo: mais lento e caro"};
  if(!lv)return{options:[{label:id?"Não se aplica a este modelo":"Escolha o modelo primeiro",value:"auto"}],tools:!1,on:!1};
  return{options:[{label:"Automático ("+({none:"nenhum",minimal:"mínimo",medium:"médio",high:"alto"}[def]||def)+", padrão do modelo)",value:"auto"}]
    .concat(lv.map(v=>({label:T[v],value:v}))),tools:tools,on:!0};
}
'''


def g_helper(s):
    return rep(s, 'function Tk(', HELPER + 'function Tk(', 'helper before Tk')


# ------------------------------------------------------------------------------------------------ 2. form
SELECT = (
    'i.jsx(Jt,{name:"reasoningEffort",label:"Raciocínio da IA",'
    'helper:(()=>{const r=WaRE(w.watch("model"));return r.on?"Quanto a IA pensa antes de responder. Recomendado: '
    'Alto para triagens (advocacia, saúde) e Baixo para dúvidas simples e rápidas. Mais raciocínio dá respostas mais '
    'cuidadosas, mas leva alguns segundos a mais e gasta mais tokens; com Alto ou mais, use 8000 ou mais em Tamanho '
    'máximo da resposta. Muito alto e Máximo só valem se um teste mostrar ganho."+(r.tools?" Neste modelo, quando a IA usa uma ferramenta '
    '(agenda ou transferir para a equipe), a OpenAI só aceita Nenhum naquela resposta.":""):"Só modelos de '
    'raciocínio (gpt-5, gpt-6, o-series) têm este ajuste."})(),'
    'options:WaRE(w.watch("model")).options},"re-"+w.watch("model")),'
)


def g_form(s):
    s = rep(s,
            'tokenParam:P.enum(["inherit","auto","max_tokens","max_completion_tokens"]).optional(),',
            'tokenParam:P.enum(["inherit","auto","max_tokens","max_completion_tokens"]).optional(),'
            'reasoningEffort:P.string().optional(),',
            'bot schema')
    s = rep(s,
            'tokenParam:"inherit",transcribeAudio:"inherit"',
            'tokenParam:"inherit",reasoningEffort:"auto",transcribeAudio:"inherit"',
            'bot defaults')
    anchor = '{label:f("openai.form.tokenParam.max_completion_tokens"),value:"max_completion_tokens"}]}),'
    return rep(s, anchor, anchor + SELECT, 'reasoning select')


# ------------------------------------------------------------------------------------------------ 3. payload
def g_payload(s):
    s = rep(s,
            '...f.tokenParam&&f.tokenParam!=="inherit"?{tokenParam:f.tokenParam}:{},',
            '...f.tokenParam&&f.tokenParam!=="inherit"?{tokenParam:f.tokenParam}:{},'
            '...f.reasoningEffort?{reasoningEffort:f.reasoningEffort}:{},',
            'create payload')
    s = rep(s,
            'tokenParam:f?.tokenParam??"inherit",',
            'tokenParam:f?.tokenParam??"inherit",reasoningEffort:f?.reasoningEffort??"auto",',
            'update initialData')
    s = rep(s,
            '[f?.historyMessages,f?.tokenParam',
            '[f?.historyMessages,f?.reasoningEffort,f?.tokenParam',
            'update initialData deps')
    return rep(s,
               '...b.tokenParam&&b.tokenParam!=="inherit"?{tokenParam:b.tokenParam}:{},',
               '...b.tokenParam&&b.tokenParam!=="inherit"?{tokenParam:b.tokenParam}:{},'
               '...b.reasoningEffort?{reasoningEffort:b.reasoningEffort}:{},',
               'update payload')


def g_models(s):
    # "Buscar modelos": the server already filters the list to the models the bot can call and adds a label
    return rep(s,
               'options:M?.map(D=>({label:D.id,value:D.id}))??[]',
               'options:M?.map(D=>({label:D.label||D.id,value:D.id}))??[]',
               'model options label')


GROUPS = [('helper', g_helper), ('form', g_form), ('payload', g_payload), ('models', g_models)]


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
    if bump_index(html) != html:
        missing.append('index.html')
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
    new_html = bump_index(html)
    open(BUNDLE, 'w', encoding='utf-8').write(s)
    if new_html != html:
        open(INDEX, 'w', encoding='utf-8').write(new_html)
    report.append(f'index.html: bundle ?v={CACHE_VERSION}')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
