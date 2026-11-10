#!/usr/bin/env bash
set -euo pipefail

API="${EVOLUTION_API_URL:-https://evolution-api-x93o.onrender.com}"
MANAGER="${WHATS_AI_MANAGER_URL:-https://whatsaibr.vercel.app}"
KEY="${EVOLUTION_API_KEY:-}"
MODEL="${OPENAI_MODEL:-gpt-6-luna}"
DB_MODE="${DB_MODE:-own}"   # own (banco próprio, padrão) ou shared
ETICA="${ETICA:-none}"      # advocacia (Código de Ética da OAB acima do prompt) ou none
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

usage() {
  echo "uso: EVOLUTION_API_KEY=... $0 <instancia> <numero-e164> <essencial|profissional|premium> <arquivo-prompt> [openai-key]"
  echo "     opcionais: OPENAI_MODEL (padrao gpt-6-luna), DB_MODE=own|shared (padrao own), ETICA=advocacia|none"
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
[ -f "$PROMPT_FILE" ] || { echo "prompt nao encontrado: $PROMPT_FILE"; exit 1; }

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
  python3 - "$INSTANCE" "$CREDS_ID" "$PROMPT_FILE" "$MAXTOKENS" "$MODEL" > "$TMP/bot.json" <<'PY'
import json, sys
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
python3 - "$CREDS_ID" "$ETICA" > "$TMP/settings.json" <<'PY'
import json, sys
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
  "ethicsProfile": sys.argv[2],
}))
PY
RESP=$(api -X POST "$API/openai/settings/$INSTANCE" -d @"$TMP/settings.json")
case "$RESP" in
  *'"status":4'*) echo "!! erro nos settings: ${RESP:0:300}"; exit 1 ;;
  *) echo "   settings ok" ;;
esac

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
