# Baileys rc14: por que ainda não pode subir

> Análise de 11/11/2026. Nenhuma credencial ou dado de cliente é usado aqui.

## Situação

O `npm audit` do `main` tem 5 entradas (2 critical, 1 high, 2 moderate):

| Entrada | Severidade | Correção |
|---|---|---|
| `baileys` | critical | 7.0.0-rc12+ (alvo: rc14) |
| `@whiskeysockets/libsignal-node` | high | vem do Baileys rc12+ (`libsignal@6.0.0`) |
| `protobufjs` (6.8.8, aninhado no libsignal) | critical | vem do Baileys rc12+ (`protobufjs@7.6.6`) |
| `minio` | moderate | sem correção segura (ver abaixo) |
| `stream-json` (via minio) | moderate | sem correção segura (ver abaixo) |

A imagem base do Docker já foi atualizada para Node 24.22.3 no PR #77, que fecha os CVEs High de runtime
(`http2`/`tls`).

## O que foi testado com o rc14

O upgrade `baileys@7.0.0-rc14` foi instalado em uma branch descartável:

- `npm run build` passou (tsc + tsup).
- `npm audit` caiu para **2 moderate** (só minio/stream-json).
- A suíte unitária **não carrega**: os arquivos que importam Baileys falham com
  `ERR_PACKAGE_PATH_NOT_EXPORTED: No "exports" main defined in node_modules/whatsapp-rust-bridge/package.json`.
- Causa: o rc14 é **ESM-only** (`"type": "module"`) e depende de `whatsapp-rust-bridge@0.5.4`, cujo `exports`
  só declara a condição `"import"`. O projeto é CJS (`package.json` `"type": "commonjs"`, build `tsup` em `cjs`,
  produção `node dist/main`) e o `dist` externaliza `require("baileys")`. Em produção o mesmo erro de resolução
  apareceria no boot.

Resumo: o rc14 corrige a CVE crítica, mas **não é drop-in** no runtime atual.

## Opções

### 1. Migrar o projeto para ESM (recomendado no médio prazo)

- `package.json` com `"type": "module"`, `tsconfig` em `NodeNext`, `tsup` em `esm`, troca de `__dirname`/`require`
  por `import.meta.url`/`createRequire` e revisão dos imports CJS (Chatwoot, `amqplib/callback_api`, etc.).
- Custo alto e risco de regressão em todos os módulos; exige a suíte completa, build Docker e validação manual
  com número descartável.
- Ganho: permite acompanhar o Baileys 7.x e eliminar os 3 alertas critical/high.

### 2. Backport do guard do rc12 no rc9 (médio prazo, se a migração não couber agora)

- O rc12 adiciona o guard contra `protocolMessage` forjado (CVE-2026-48063). É uma mudança pequena, mas mexe no
  processamento de app-state/history sync.
- Exige manter um fork/patch do Baileys e validar com número descartável; não elimina os alertas de protobufjs
  aninhado no libsignal git (seria preciso avaliar o override do libsignal).
- Risco menor que a migração, mas com manutenção contínua.

### 3. Manter o rc9 com o paliativo (situação atual)

- O `PlaceholderResendTracker` bloqueia o upsert forjado com `requestId`, mas **não cobre** todo o vetor de
  app-state/history sync. O risco residual é corrupção de sessão/histórico e DoS.
- É a opção que não muda o runtime e mantém o WhatsApp do cliente estável.

### 4. Overrides de `libsignal`/`protobufjs` sem subir o Baileys

- Não corrige a CVE do próprio Baileys e mistura libsignal 2.0.1 com protobufjs 7.x; combinação não validada.
- Não recomendado.

## Minio e stream-json

- `stream-json@1.9.1` (via `minio@8.0.7`) é acusado em 3 avisos moderate; a versão corrigida é 3.6.0, que é
  ESM-only, mudou o caminho (`jsonl/parser.js` com p minúsculo) e não tem `.make()`; o minio 8.0.7 é CJS e faz
  `require("stream-json/jsonl/Parser.js")` no boot. Um override quebra a API inteira.
- O código vulnerável só roda nas notificações de bucket (`listenBucketNotification` etc.), que o WhatsAI não usa.
- Recomendação: manter, documentar e **dispensar os 2 alertas no Dependabot** como "código vulnerável não usado",
  citando essa evidência. Acompanhar o minio-js; quando sair uma 8.x com stream-json 3.6+, a atualização resolve.

## Recomendação

1. **Não mergear** o upgrade do Baileys agora. Manter o paliativo e o rc9.
2. Planejar a migração para ESM (opção 1) como projeto separado, com branch própria, suíte completa e validação
   com número descartável + staging.
3. Enquanto isso, dispensar os 2 alertas do minio no Dependabot com a justificativa acima.
4. Se a migração não for priorizada, avaliar o backport do guard (opção 2) com o mesmo rigor de teste.
5. Só depois de qualquer uma das opções, deploy em produção fora do horário comercial, conferindo o deploy `live`
   no Render e a instância `open`.

## Checklist de validação (quando houver número descartável)

1. Staging com serviço Render separado ou Docker local e banco descartável.
2. Parear, confirmar `open`, reiniciar e reconectar sem novo pareamento.
3. Texto, imagem, áudio, vídeo, documento, sticker, localização, contato, enquete, botões/lista, link preview,
   resposta citada, edição, exclusão, temporária, view-once e reação.
4. Grupos (criar, renomear, participantes, convite, ephemeral) e histórico inicial/on-demand.
5. LID, chamada recebida com `rejectCall`/`msgCall`, presença/privacidade/foto de perfil.
6. Bot OpenAI, pausa humana, leads, agenda, retenção e webhooks.
7. Soak de 24-48 h observando reconexões, memória, `Bad MAC` e escritas no banco.
8. Rollback para rc9 no número de teste (o rc14 grava a chave `identity-key`).
