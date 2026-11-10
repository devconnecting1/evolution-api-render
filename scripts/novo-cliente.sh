#!/usr/bin/env bash
set -euo pipefail

API="${EVOLUTION_API_URL:-https://evolution-api-x93o.onrender.com}"
MANAGER="${WHATS_AI_MANAGER_URL:-https://whatsaibr.vercel.app}"
KEY="${EVOLUTION_API_KEY:-}"
MODEL="${OPENAI_MODEL:-gpt-6-luna}"
DB_MODE="${DB_MODE:-own}"   # own (banco próprio, padrão) ou shared
ETICA="${ETICA:-}"          # advocacia (Código de Ética da OAB acima do prompt) ou none (padrao; com COPIAR_DE, o da origem)
COPIAR_DE="${COPIAR_DE:-}"  # numero adicional do mesmo cliente: copia bot, prompt, settings, Leads e Comportamento
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

usage() {
  echo "uso: EVOLUTION_API_KEY=... $0 <instancia> <numero-e164> <essencial|profissional|premium> <arquivo-prompt> [openai-key]"
  echo "     opcionais: OPENAI_MODEL (padrao gpt-6-luna), DB_MODE=own|shared (padrao own), ETICA=advocacia|none"
  echo "     numero adicional do mesmo cliente: COPIAR_DE=<instancia-origem> e '-' no lugar do arquivo-prompt"
  echo "       (copia prompt, modelo e campos do bot, settings do bot, Leads e Comportamento; a chave OpenAI e o"
  echo "        plano sao informados de novo; Agenda e Processos ficam desligados para configurar no painel)"
  exit 1
}

[ $# -ge 4 ] || usage
INSTANCE="$1"
NUMBER="$2"
PLAN="$3"
PROMPT_FILE="$4"
OPENAI_KEY="${5:-${OPENAI_API_KEY:-}}"

[ -n "$KEY" ] || { echo "defina EVOLUTION_API_KEY"; exit 1; }
[ -n "$OPENAI_KEY" ] || { echo "informe a OpenAI key (5o argumento ou OPENAI_API_KEY)"; exit 1; }
if [ -n "$COPIAR_DE" ] && [ "$PROMPT_FILE" = "-" ]; then
  :
elif [ ! -f "$PROMPT_FILE" ]; then
  echo "prompt nao encontrado: $PROMPT_FILE"; exit 1
fi

# franquia de cada plano: README-WHATSAI.md, secoes 6 e 15. maxTokens 2000 porque modelos de raciocinio
# (gpt-5.x, gpt-6) gastam parte do limite pensando (secao 12.1)
case "$PLAN" in
  essencial)    PLAN_NAME="Essencial" ;;
  profissional) PLAN_NAME="Profissional" ;;
  premium)      PLAN_NAME="Premium" ;;
  *) echo "plano invalido: $PLAN (essencial|profissional|premium)"; exit 1 ;;
esac
MAXTOKENS=2000

api() { curl -sS -H "apikey: $KEY" -H "Content-Type: application/json" "$@"; }

if [ -n "$COPIAR_DE" ]; then
  [ "$COPIAR_DE" != "$INSTANCE" ] || { echo "COPIAR_DE precisa ser outra instancia"; exit 1; }
  echo "== 0/7 lendo a configuracao de '$COPIAR_DE'"
  api "$API/openai/find/$COPIAR_DE" > "$TMP/src-bot.json"
  api "$API/openai/fetchSettings/$COPIAR_DE" > "$TMP/src-settings.json"
  api "$API/leads/settings/$COPIAR_DE" > "$TMP/src-leads.json" || echo '{}' > "$TMP/src-leads.json"
  api "$API/settings/find/$COPIAR_DE" > "$TMP/src-behavior.json" || echo '{}' > "$TMP/src-behavior.json"
  python3 - "$TMP/src-bot.json" <<'PY' || { echo "!! '$COPIAR_DE' sem bot OpenAI para copiar"; exit 1; }
import json, sys
bots = json.load(open(sys.argv[1], encoding="utf-8"))
if not isinstance(bots, list) or not bots:
    sys.exit(1)
print("   bot de origem: %s, %s, %d mensagem(ns) de sistema" % (bots[0].get("description"), bots[0].get("model"), len(bots[0].get("systemMessages") or [])))
PY
fi

echo "== 1/7 instancia $INSTANCE (banco: $DB_MODE)"
python3 - "$INSTANCE" "$NUMBER" "$DB_MODE" > "$TMP/instance.json" <<'PY'
import json, sys
print(json.dumps({"instanceName": sys.argv[1], "qrcode": True, "integration": "WHATSAPP-BAILEYS",
                  "number": sys.argv[2], "dbMode": sys.argv[3]}))
PY
RESP=$(api -X POST "$API/instance/create" -d @"$TMP/instance.json")
case "$RESP" in
  *'"status":4'*) echo "   aviso: ${RESP:0:200} (seguindo; instancia pode ja existir)" ;;
  *) echo "   ${RESP:0:200}" ;;
esac

echo "== 2/7 conecte o WhatsApp"
echo "   abra $MANAGER/instances, clique em Get QR Code (ou Get Pairing Code) e conecte '$INSTANCE'."
CONNECT=$(api "$API/instance/connect/$INSTANCE?number=$NUMBER" || true)
PAIRING=$(printf '%s' "$CONNECT" | python3 -c 'import sys, json
try: print(json.load(sys.stdin).get("pairingCode") or "")
except Exception: print("")')
if [ -n "$PAIRING" ]; then echo "   pairing code: $PAIRING"; fi
echo "   aguardando conexao (ate 10 min)..."
STATE=""
for _ in $(seq 1 60); do
  STATE=$(api "$API/instance/connectionState/$INSTANCE" | python3 -c 'import sys, json
try: print(json.load(sys.stdin)["instance"]["state"])
except Exception: print("unknown")')
  if [ "$STATE" = "open" ]; then break; fi
  sleep 10
done
if [ "$STATE" != "open" ]; then
  echo "!! nao conectou (estado: $STATE). Conecte no manager e rode de novo; a criacao sera pulada."
  exit 1
fi
echo "   conectada."

echo "== 3/7 credencial OpenAI"
CREDS_ID=$(api "$API/openai/creds/$INSTANCE" | python3 -c 'import sys, json
try:
  d = json.load(sys.stdin)
  print(d[0]["id"] if isinstance(d, list) and d else "")
except Exception:
  print("")')
if [ -z "$CREDS_ID" ]; then
  python3 - "$INSTANCE" "$OPENAI_KEY" > "$TMP/creds.json" <<'PY'
import json, sys
print(json.dumps({"name": sys.argv[1] + "-openai", "apiKey": sys.argv[2]}))
PY
  CREDS=$(api -X POST "$API/openai/creds/$INSTANCE" -d @"$TMP/creds.json")
  CREDS_ID=$(printf '%s' "$CREDS" | python3 -c 'import sys, json
try: print(json.load(sys.stdin).get("id") or "")
except Exception: print("")')
fi
[ -n "$CREDS_ID" ] || { echo "!! falha na credencial OpenAI (chave repetida?): ${CREDS:0:300}"; exit 1; }
echo "   creds: $CREDS_ID"

echo "== 4/7 agente OpenAI ($PLAN, $MODEL)"
BOT_COUNT=$(api "$API/openai/find/$INSTANCE" | python3 -c 'import sys, json
try:
  d = json.load(sys.stdin)
  print(len(d) if isinstance(d, list) else 0)
except Exception:
  print(0)')
if [ "$BOT_COUNT" -gt 0 ]; then
  echo "   bot ja existe, pulando criacao"
else
  python3 - "$INSTANCE" "$CREDS_ID" "$PROMPT_FILE" "$MAXTOKENS" "$MODEL" "$TMP/src-bot.json" "$COPIAR_DE" > "$TMP/bot.json" <<'PY'
import json, os, sys
if sys.argv[7]:
    # numero adicional: os campos do bot da origem (lista fechada do schema); credencial e descricao sao desta instancia
    src = json.load(open(sys.argv[6], encoding="utf-8"))[0]
    keep = ["botType", "model", "systemMessages", "assistantMessages", "userMessages", "maxTokens", "tokenParam",
            "humanResumeMinutes", "historyMessages", "triggerType", "triggerOperator", "triggerValue", "expire",
            "keywordFinish", "delayMessage", "unknownMessage", "listeningFromMe", "stopBotFromMe", "keepOpen",
            "debounceTime", "ignoreJids"]
    bot = {k: src[k] for k in keep if src.get(k) is not None}
    # campos de texto vazios nao sao copiados (o painel salva "" e isso nao deve virar mensagem)
    for k in ("assistantMessages", "userMessages", "systemMessages"):
        if k in bot:
            bot[k] = [m for m in bot[k] if isinstance(m, str) and m.strip()]
            if not bot[k]:
                del bot[k]
    if sys.argv[3] != "-" and os.path.isfile(sys.argv[3]):
        bot["systemMessages"] = [open(sys.argv[3], encoding="utf-8").read()]
    bot.update({"enabled": True, "description": sys.argv[1] + " - bot", "openaiCredsId": sys.argv[2]})
    print(json.dumps(bot))
    sys.exit(0)
prompt = open(sys.argv[3], encoding="utf-8").read()
print(json.dumps({
  "enabled": True,
  "description": sys.argv[1] + " - bot",
  "openaiCredsId": sys.argv[2],
  "botType": "chatCompletion",
  "model": sys.argv[5],
  "systemMessages": [prompt],
  "maxTokens": int(sys.argv[4]),
  "tokenParam": "auto",
  "triggerType": "all",
  "humanResumeMinutes": 60,
  "historyMessages": 30,
}))
PY
  RESP=$(api -X POST "$API/openai/create/$INSTANCE" -d @"$TMP/bot.json")
  case "$RESP" in
    *'"status":4'*) echo "!! erro ao criar bot: ${RESP:0:300}"; exit 1 ;;
    *) echo "   bot criado" ;;
  esac
fi

echo "== 5/7 settings"
# valores recomendados (secao 12.4): pausa quando a equipe responde, volta 60 min depois da ultima mensagem
# dela, junta mensagens seguidas por 10 s, ignora grupos e avisa em PT-BR quando a OpenAI falha
python3 - "$CREDS_ID" "$ETICA" "$TMP/src-settings.json" "$COPIAR_DE" > "$TMP/settings.json" <<'PY'
import json, sys
ethics = sys.argv[2]
if sys.argv[4]:
    src = json.load(open(sys.argv[3], encoding="utf-8")) or {}
    keep = ["expire", "keywordFinish", "delayMessage", "unknownMessage", "listeningFromMe", "stopBotFromMe", "keepOpen",
            "debounceTime", "speechToText", "tokenParam", "humanResumeMinutes", "ignoreJids", "historyMessages",
            "ethicsProfile"]
    out = {k: src[k] for k in keep if src.get(k) is not None}
    out["openaiCredsId"] = sys.argv[1]
    if ethics:
        out["ethicsProfile"] = ethics
    print(json.dumps(out))
    sys.exit(0)
print(json.dumps({
  "openaiCredsId": sys.argv[1],
  "expire": 0,
  "keywordFinish": "#sair",
  "delayMessage": 1500,
  "unknownMessage": "Desculpe, tive um problema para responder agora. Alguém da equipe vai falar com você em breve.",
  "listeningFromMe": False,
  "stopBotFromMe": True,
  "keepOpen": False,
  "debounceTime": 10,
  "ignoreJids": ["@g.us"],
  "tokenParam": "auto",
  "humanResumeMinutes": 60,
  "historyMessages": 30,
  "ethicsProfile": ethics or "none",
}))
PY
RESP=$(api -X POST "$API/openai/settings/$INSTANCE" -d @"$TMP/settings.json")
case "$RESP" in
  *'"status":4'*) echo "!! erro nos settings: ${RESP:0:300}"; exit 1 ;;
  *) echo "   settings ok" ;;
esac

if [ -n "$COPIAR_DE" ]; then
  echo "   copiando Leads e Comportamento de '$COPIAR_DE'"
  python3 - "$TMP/src-leads.json" > "$TMP/leads.json" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    data = {}
settings = (data or {}).get("settings") or {}
# so os campos que o POST aceita (enabled, areas, extractionModel, notify)
print(json.dumps({k: settings[k] for k in ("enabled", "areas", "extractionModel", "notify") if k in settings})
      if (data or {}).get("configured") else "{}")
PY
  if [ "$(cat "$TMP/leads.json")" != "{}" ]; then
    RESP=$(api -X POST "$API/leads/settings/$INSTANCE" -d @"$TMP/leads.json")
    case "$RESP" in *'"status":4'*) echo "   aviso: Leads nao copiados: ${RESP:0:200}" ;; *) echo "   Leads ok (mesmas areas e numeros de aviso)" ;; esac
  else
    echo "   origem sem configuracao de Leads; ficam os padroes"
  fi
  python3 - "$TMP/src-behavior.json" > "$TMP/behavior.json" <<'PY'
import json, sys
try:
    src = json.load(open(sys.argv[1], encoding="utf-8")) or {}
except Exception:
    src = {}
keep = ["rejectCall", "msgCall", "groupsIgnore", "alwaysOnline", "readMessages", "readStatus", "syncFullHistory"]
print(json.dumps({k: src[k] for k in keep if src.get(k) is not None}))
PY
  if [ "$(cat "$TMP/behavior.json")" != "{}" ]; then
    RESP=$(api -X POST "$API/settings/set/$INSTANCE" -d @"$TMP/behavior.json")
    case "$RESP" in *'"status":4'*) echo "   aviso: Comportamento nao copiado: ${RESP:0:200}" ;; *) echo "   Comportamento ok" ;; esac
  fi
fi

echo "== 6/7 plano $PLAN_NAME"
python3 - "$PLAN_NAME" > "$TMP/limits.json" <<'PY'
import json, sys
print(json.dumps({"planName": sys.argv[1], "overLimitAction": "continue", "alertPercent": 80}))
PY
RESP=$(api -X POST "$API/usage/limits/$INSTANCE" -d @"$TMP/limits.json")
case "$RESP" in
  *'"status":4'*) echo "   aviso: plano nao salvo: ${RESP:0:300} (configure em Plano e limites)" ;;
  *) echo "   plano ok (horario de atendimento e mensagens: painel > Plano e limites)" ;;
esac

echo "== 7/7 teste da chave OpenAI"
api -X POST "$API/openai-health/$INSTANCE/test" | python3 -c 'import sys, json
try:
  for c in json.load(sys.stdin).get("credentials", []):
    print("   %s: %s%s" % (c.get("keyMasked"), c.get("text"), (" - " + c["hint"]) if c.get("hint") else ""))
except Exception:
  print("   sem resposta do teste; veja o cartao OpenAI da Observabilidade")'

echo "== resumo"
BOTS=$(api "$API/openai/find/$INSTANCE")
echo "   bots: ${BOTS:0:300}"
echo "   estado: $(api "$API/instance/connectionState/$INSTANCE")"
echo "ok: '$INSTANCE' configurada no plano $PLAN. Teste mandando uma mensagem de outro numero."
