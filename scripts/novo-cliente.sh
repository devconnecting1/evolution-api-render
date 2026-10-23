#!/usr/bin/env bash
set -euo pipefail

API="${EVOLUTION_API_URL:-https://evolution-api-x93o.onrender.com}"
MANAGER="${WHATS_AI_MANAGER_URL:-https://whatsaibr.vercel.app}"
KEY="${EVOLUTION_API_KEY:-}"
MODEL="${OPENAI_MODEL:-gpt-4o-mini}"

usage() {
  echo "uso: EVOLUTION_API_KEY=... $0 <instancia> <numero-e164> <start|pro|premium> <arquivo-prompt> [openai-key]"
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

case "$PLAN" in
  start)   MAXTOKENS=500;  EXPIRE=30;  ;;
  pro)     MAXTOKENS=800;  EXPIRE=60;  ;;
  premium) MAXTOKENS=1200; EXPIRE=120; ;;
  *) echo "plano invalido: $PLAN (start|pro|premium)"; exit 1 ;;
esac

api() { curl -sS -H "apikey: $KEY" -H "Content-Type: application/json" "$@"; }

echo "== 1/5 instancia $INSTANCE"
python3 - "$INSTANCE" "$NUMBER" > /tmp/whatsai-instance.json <<'PY'
import json, sys
print(json.dumps({"instanceName": sys.argv[1], "qrcode": True, "integration": "WHATSAPP-BAILEYS", "number": sys.argv[2]}))
PY
RESP=$(api -X POST "$API/instance/create" -d @/tmp/whatsai-instance.json)
case "$RESP" in
  *'"status":4'*) echo "   aviso: ${RESP:0:200} (seguindo; instancia pode ja existir)" ;;
  *) echo "   ${RESP:0:200}" ;;
esac

echo "== 2/5 conecte o WhatsApp"
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

echo "== 3/5 credencial OpenAI"
CREDS_ID=$(api "$API/openai/creds/$INSTANCE" | python3 -c 'import sys, json
try:
  d = json.load(sys.stdin)
  print(d[0]["id"] if isinstance(d, list) and d else "")
except Exception:
  print("")')
if [ -z "$CREDS_ID" ]; then
  python3 - "$INSTANCE" "$OPENAI_KEY" > /tmp/whatsai-creds.json <<'PY'
import json, sys
print(json.dumps({"name": sys.argv[1] + "-openai", "apiKey": sys.argv[2]}))
PY
  CREDS=$(api -X POST "$API/openai/creds/$INSTANCE" -d @/tmp/whatsai-creds.json)
  CREDS_ID=$(printf '%s' "$CREDS" | python3 -c 'import sys, json
try: print(json.load(sys.stdin).get("id") or "")
except Exception: print("")')
fi
[ -n "$CREDS_ID" ] || { echo "!! falha na credencial OpenAI (chave repetida?): ${CREDS:0:300}"; exit 1; }
echo "   creds: $CREDS_ID"

echo "== 4/5 agente OpenAI ($PLAN, $MODEL)"
BOT_COUNT=$(api "$API/openai/find/$INSTANCE" | python3 -c 'import sys, json
try:
  d = json.load(sys.stdin)
  print(len(d) if isinstance(d, list) else 0)
except Exception:
  print(0)')
if [ "$BOT_COUNT" -gt 0 ]; then
  echo "   bot ja existe, pulando criacao"
else
  python3 - "$INSTANCE" "$CREDS_ID" "$PROMPT_FILE" "$MAXTOKENS" "$EXPIRE" "$MODEL" > /tmp/whatsai-bot.json <<'PY'
import json, sys
prompt = open(sys.argv[3], encoding="utf-8").read()
print(json.dumps({
  "enabled": True,
  "description": sys.argv[1] + " - bot",
  "openaiCredsId": sys.argv[2],
  "botType": "chatCompletion",
  "model": sys.argv[6],
  "systemMessages": [prompt],
  "maxTokens": int(sys.argv[4]),
  "triggerType": "all",
  "expire": int(sys.argv[5]),
  "delayMessage": 3,
  "unknownMessage": "Desculpe, nao entendi. Pode reformular?",
  "listeningFromMe": False,
  "stopBotFromMe": True,
  "keepOpen": False,
  "debounceTime": 1000,
  "ignoreJids": [],
}))
PY
  RESP=$(api -X POST "$API/openai/create/$INSTANCE" -d @/tmp/whatsai-bot.json)
  case "$RESP" in
    *'"status":4'*) echo "!! erro ao criar bot: ${RESP:0:300}"; exit 1 ;;
    *) echo "   bot criado" ;;
  esac
fi

echo "== 5/5 settings"
python3 - "$CREDS_ID" "$EXPIRE" > /tmp/whatsai-settings.json <<'PY'
import json, sys
print(json.dumps({
  "openaiCredsId": sys.argv[1],
  "expire": int(sys.argv[2]),
  "keywordFinish": "#sair",
  "delayMessage": 3,
  "unknownMessage": "Desculpe, nao entendi. Pode reformular?",
  "listeningFromMe": False,
  "stopBotFromMe": True,
  "keepOpen": False,
  "debounceTime": 1000,
  "ignoreJids": [],
  "speechToText": True,
}))
PY
RESP=$(api -X POST "$API/openai/settings/$INSTANCE" -d @/tmp/whatsai-settings.json)
case "$RESP" in
  *'"status":4'*) echo "!! erro nos settings: ${RESP:0:300}"; exit 1 ;;
  *) echo "   settings ok" ;;
esac

echo "== resumo"
BOTS=$(api "$API/openai/find/$INSTANCE")
echo "   bots: ${BOTS:0:300}"
echo "   estado: $(api "$API/instance/connectionState/$INSTANCE")"
echo "ok: '$INSTANCE' configurada no plano $PLAN. Teste mandando uma mensagem de outro numero."
