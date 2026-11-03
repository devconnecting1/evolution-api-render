# WhatsAI — Atendimento com IA no WhatsApp

> **Atribuição:** projeto inspirado no Evolution Foundation/Evolution API. Base licenciada sob Apache 2.0, com condições adicionais.

Plataforma própria de atendimento automatizado: Evolution API (WhatsApp Web via Baileys ou Cloud API oficial da Meta) + agente OpenAI por instância + painel WhatsAI. Cada número = 1 instância com seu próprio agente.

> Este README é o manual operacional do projeto. Atualizado em 03/11/2026.
>
> **Canais:** os planos Essencial e Profissional usam **WhatsApp Web** (`WHATSAPP-BAILEYS`, QR code); o Premium usa a **Cloud API** (`WHATSAPP-BUSINESS`). O escritório de advocacia em produção usa Baileys. A **pausa humana** está validada em produção no Baileys. Na Cloud API ela funciona pelos ecos da **Coexistence** (`smb_message_echoes`), já tratados no código, mas **ainda não validados com um número real** (seção 12.7).

## 1. Arquitetura

```
WhatsApp do cliente
   │  (Cloud API oficial via token/webhook)
   ▼
Evolution API 2.3.7 — Render (Ohio)          Manager WhatsAI — Vercel
   ├── Neon Postgres (instâncias, contatos, chats, mensagens, sessões)
   ├── Redis (cache) — Render Key Value
   └── OpenAI (agente por instância)  ◄── cron-job.org (ping 5 min)
```

| Recurso | Endereço |
|---|---|
| API | URL do serviço web, configurada no painel do Render |
| Manager | `https://whatsaibr.vercel.app` |
| Banco Postgres | host e banco configurados no painel do provedor (Neon hoje) |
| Keep-alive | job no cron-job.org, configurado no painel do provedor (GET `/` a cada 5 min) |
| Repo | repositório privado do projeto no GitHub (remote `render`) |

## 2. Segredos e acessos

- **API key global** (`AUTHENTICATION_API_KEY`): definida somente no painel do Render (`sync: false`), fora do Git. É super-admin — **nunca** compartilhar com cliente. Se houver suspeita de exposição, rotacione-a.
- **Banco**: URI de conexão configurada no painel do Render (`DATABASE_CONNECTION_URI`, `sync: false`). Não commitar.
- **Tokens de deploy** (Vercel, cron-job.org): guardados fora do repositório, com o operador. Se sumirem, gerar novos no painel do provedor. No GitHub, o secret `VERCEL_TOKEN` alimenta o workflow de deploy do manager.
- **Manager**: acesso somente do operador (você). Cliente usa apenas o WhatsApp.

## 3. Deploy

```bash
# API (o remote "origin" é o upstream EvolutionAPI — NÃO usar para push)
git push render main          # dispara deploy automático no Render

# Manager: deploy automático via GitHub Actions ao alterar manager/dist/**
# Fallback manual:
./scripts/sync-readmes.sh     # copia os READMEs para o manager
cd manager/dist
VERCEL_TOKEN="<token da Vercel>" \
  npx -y vercel@65.2.0 deploy --prod --yes --archive=tgz
```

- Mudanças de env no `render.yaml` são aplicadas no deploy seguinte (Blueprint auto-sync). Se não aplicar: Render > Blueprint > **Sync**.
- Deploy reinicia a API (~4 min) e reconecta as instâncias automaticamente. Evite durante horário comercial dos clientes.
- CI: `Check Code Quality` roda lint/build; `Security` roda Gitleaks + `npm audit` (report-only); Dependabot abre atualizações semanais. O deploy do manager usa o secret `VERCEL_TOKEN`.

## 4. Manager (build sem fonte)

Só existe `manager/dist` (bundle Vite). Patches já aplicados:

1. **Marca WhatsAI**: `<title>`, textos "WhatsAI", logos SVG locais (`assets/images/whatsai-logo-white.svg` / `whatsai-logo-dark.svg`).
2. **Server URL padrão** no login = URL do Render.
3. **Favicon local** (`assets/images/favicon.svg`).
4. **Aba README**: item na sidebar (acima de Documentação) que abre um painel **dentro do dashboard** (mesma aba, sidebar visível) com um resumo operacional em um único card; `/readme` também funciona como acesso direto. Conteúdo: `readmes/RESUMO.md`, com links para o guia comercial e o manual interno. Arquivos: `assets/readme-tab.js`, `assets/readme-tab.css`, `assets/marked.min.js` e `readmes/` (gerado por `scripts/sync-readmes.sh`). Para atualizar o conteúdo, rode o sync antes do deploy.
5. **Observabilidade**: item na sidebar e no cabeçalho do dashboard (`/manager/observability` e `/manager/instance/:instanceId/observability`), página React nativa usando os componentes do projeto (`Card`, `Button`, `Badge`, `Alert`). Consulta `GET /observability` com a chave global do localStorage. A rota antiga `/observability` redireciona para a página nativa.

Campos do bot OpenAI no Manager: `manager/patches/openai-fields.py` (tokenParam, pausa humana, descrições), `manager/patches/responsive.py` (celular/tablet) e `manager/patches/openai-media.py` (seção Mídia e memória da conversa, seção 12.10), aplicados nessa ordem; cada um aceita `--check`.

Se o manager for reconstruído do zero, reaplicar esses patches. Rotas SPA via `manager/dist/vercel.json`; `/observability` tem rewrites explícitos antes do catch-all para a página de redirect.

## 5. Onboarding de cliente (runbook)

Dados necessários: nome da instância (slug, ex. `escritorio-silva`), número E.164 (`5521...`), plano, chave OpenAI (sua, embutida no preço, ou do cliente), informações do negócio para o prompt.

```bash
# 1. Escreva o prompt do cliente
cp prompts/exemplo-advocacia.md prompts/escritorio-silva.md
# edite nome, áreas, horários, regras, handoff
```

**Cloud API oficial — conexão via token:** crie a instância com o payload abaixo (token permanente, Phone Number ID e WABA ID da Meta). Requer Meta Business verificado, número dedicado, cartão na Meta e webhook `/webhook/meta`. Depois, os endpoints de OpenAI são os mesmos.

```json
{
  "instanceName": "escritorio-silva",
  "integration": "WHATSAPP-BUSINESS",
  "qrcode": false,
  "token": "<META_PERMANENT_TOKEN>",
  "number": "<PHONE_NUMBER_ID>",
  "businessId": "<WABA_ID>"
}
```

Depois de criar a instância, configure a credencial OpenAI e o agente pelos endpoints abaixo. Teste mandando "oi" de outro número e acompanhe em Integrações > OpenAI > Sessões.

### Endpoints usados (referência)

| Ação | Endpoint |
|---|---|
| Criar instância | `POST /instance/create` |
| Criar instância oficial | `POST /instance/create` (payload `WHATSAPP-BUSINESS` acima) |
| Estado | `GET /instance/connectionState/{instancia}` |
| Credencial OpenAI | `POST /openai/creds/{instancia}` |
| Criar agente | `POST /openai/create/{instancia}` |
| Settings do agente | `POST /openai/settings/{instancia}` |
| Pausar/retomar por contato | `POST /openai/changeStatus/{instancia}` (`opened`, `paused`, `closed`, `delete`) |
| Sessões | `GET /openai/fetchSessions/{openaiId}/{instancia}` |

Header de autenticação: `apikey: <chave>`.

### Checklist de entrega

- [ ] Instância `open` e perfil correto
- [ ] (Oficial) Meta Business verificado, WABA, Phone Number ID, token permanente e cartão cadastrados
- [ ] (Oficial) Webhook `/webhook/meta` ativo com os campos `messages` e `smb_message_echoes` (Coexistence) e templates aprovados (se houver envio fora da janela de 24 h)
- [ ] Agente responde "oi" com o tom do cliente
- [ ] Perguntas de preço/horário/endereço corretas
- [ ] Pedido de pessoa: a IA avisa que a equipe vai continuar (é só instrução do prompt; não há aviso automático à equipe). A equipe responde e a IA pausa
- [ ] Pausa e retomada testadas (teste com `humanResumeMinutes` = 2 e depois volte ao combinado)
- [ ] Áudio transcrito (`transcribeAudio`), foto e PDF lidos com o modelo do bot (PDF no gpt-6-luna ainda não validado: se o modelo recusar, a IA recebe só a descrição do arquivo)
- [ ] Cliente avisado sobre políticas/limites da Meta e fair use
- [ ] Contrato + cobrança do setup

## 6. Planos e preços

Preços fixos aprovados em 03/11/2026 (reajuste da implantação; contratos e propostas enviados antes mantêm seus preços durante a validade). A versão para o cliente (com o que inclui, adicionais e contrato) está no **Guia comercial** (`readmes/README-COMERCIAL.md`). Custos internos, margens e roteiro de vendas ficam no Guia de Vendas interno, fora do repositório: este manual é público em `/readme`.

| | Essencial | Profissional | Premium (API oficial) |
|---|---:|---:|---:|
| Mensalidade | R$ 397 | R$ 697 | R$ 1.297 |
| Implantação, contrato de 6 meses | R$ 1.990 | R$ 4.390 | a partir de R$ 7.390 |
| Implantação, contrato de 12 meses | R$ 1.490 | R$ 2.890 | a partir de R$ 5.290 |
| Respostas da IA incluídas por mês | 2.000 | 5.000 | 10.000 |
| Números | 1 | até 2 | 1 (+ sob consulta) |
| Ajustes nas instruções por mês | 2 | 4 | 8 |
| Integrações sob medida incluídas | – | 1 | 2 |
| Áudio, foto e PDF | Sim | Sim | Sim |

- **Excedente:** R$ 49 por bloco de 1.000 respostas. **Piloto assistido de 14 dias:** R$ 690, abatido da implantação.
- **Contrato mínimo de 6 meses**; depois, mês a mês.
- **Franquia:** hoje não há contador automático de respostas da IA (seção 13). Meça pelo uso do project key da OpenAI de cada instância.

### Cuidados que entram no contrato
1. **WhatsApp Web (Baileys) não é oficial.** O número pode ser bloqueado, principalmente com disparos em massa. Aviso de risco por escrito; a API oficial é a alternativa.
2. **Regras da Meta para IA mudaram em 2026** e podem mudar de novo: mantenha a cláusula de revisão de preço.
3. **LGPD:** termo de tratamento de dados, aviso de que o contato fala com uma IA e retenção combinada (padrão 90 dias; a exclusão hoje é manual, seção 7).
4. **Advocacia:** o Provimento 205/2021 da OAB limita a publicidade. A IA não promete resultado nem capta clientes ativamente; só faz triagem e agendamento.
5. **Nada prometido que não exista** (seção 13): aviso automático para a equipe, relatório automático e lembretes ativos **não** são recursos atuais.

## 7. LGPD, segurança e riscos

- Contrato de operador de dados; retenção padrão de 90 dias (configurável no contrato). **Não existe expurgo automático no código**: as mensagens ficam no banco até alguém apagar. Enquanto não houver rotina automática, faça a exclusão manualmente (mensal) e registre. Backup: snapshots do banco + `pg_dump` mensal (seção 8).
- Advocacia: sigilo profissional — não solicitar documentos sensíveis pelo chat; usar link seguro.
- **Cloud API oficial**: conexão via token permanente, WABA e Phone Number ID. A Meta pode limitar por qualidade/política, exige templates fora da janela de 24 h e cartão do cliente cadastrado; não prometa isenção de bloqueio por violação de política.
- Manager e chave global são do operador. Cliente nunca recebe a chave global.
- Uma credencial OpenAI não pode ser cadastrada em duas instâncias (a API recusa chave repetida). Para cliente com 2 números, gerar 2 project keys (uma por instância); não compartilhe a mesma key entre clientes.

## 8. Manutenção

- **Keep-alive**: job no cron-job.org, configurado no painel do provedor (5 min). Sem ele, o free dorme em 15 min.
- **Atualizações**: `git push render main` (revisar changelog do upstream antes).
- **Backup**: snapshots do Neon + `pg_dump` mensal para storage externo.
- **Monitorar**: uso de tokens OpenAI, sessões travadas, instâncias `close`, erros no log do Render; no oficial, qualidade/limites e billing da Meta.
- **Rotação**: chave global, tokens Vercel/cron e chaves OpenAI dos clientes em caso de vazamento.

## 9. Troubleshooting

| Sintoma | Causa / solução |
|---|---|
| Aba de integração em spinner + erro vermelho | Flag `*_ENABLED` desligada no Render; conferir `render.yaml` e redeploy |
| Manager não carrega/404 | Domínio correto é `whatsaibr.vercel.app` |
| API demora ~1 min na 1ª chamada | Render free dormiu; cron deve evitar |
| Contatos/chats vazios logo após conectar | Sincronização inicial; F5 após alguns minutos |
| Instância `connecting` eterna | Token, Phone Number ID ou WABA inválidos, ou número não verificado; revisar credenciais e reconectar |
| Cloud API não conecta | Token expirado, Phone Number ID/WABA errados ou número não verificado na Meta |
| Cloud API não envia fora do horário | Janela de 24 h fechada; enviar template aprovado (custo à parte) |
| Cloud API cobrando acima do esperado | Bot dividindo respostas em várias mensagens ou templates de marketing; revisar `splitMessages` e o rate card |
| Bot parou de responder a um contato (Baileys) | Provável pausa humana: `GET /openai/fetchSessions/{openaiId}/{instancia}`, procurar `status: paused` (e `parameters.humanLastMessageAt`); reative com `POST /openai/changeStatus/{instancia}` (`opened`). O campo `humanPause` de cada sessão mostra o motivo e quanto falta para retomar (seção 12.9). Ver seção 12.2 |
| Erro `400 Unsupported parameter: 'max_tokens'` | Modelo de raciocínio (gpt-5, o-series, gpt-6) exige `max_completion_tokens`; deixe `tokenParam: "auto"` (seção 12.1) |
| Card Sistema com "Falhas ao salvar mensagens" ou log `not stored (P1001)` | Banco inacessível (Neon acordando do scale-to-zero). A mensagem ainda vai para o bot, mas não fica salva. Use o endpoint *pooled* do Neon com `connect_timeout=15&pool_timeout=20` na `DATABASE_CONNECTION_URI` |
| Cliente não recebe nada quando a OpenAI falha | Esperado se `unknownMessage` estiver vazio; configure em PT-BR (seção 12.5) |

## 10. Observabilidade

A aba **Observabilidade** do manager (`/manager/observability` ou `/manager/instance/:instanceId/observability`) mostra, em um só lugar, storage/consumo/limites de Neon, Render, Vercel e GitHub Actions. O endpoint `GET /observability` exige o header `apikey` (chave global) e usa cache de 60 s; `?refresh=1` força a consulta. Ele apenas lê APIs externas, não grava no Postgres. A rota antiga `/observability` redireciona para a página nativa.

| Variável | Uso | Como obter |
|---|---|---|
| `NEON_API_KEY` | Consultar projeto, branches e consumo | Neon Console > Account settings > API keys (org key) |
| `NEON_PROJECT_ID` | ID do projeto (configurado no painel do provedor) | Neon Console > Project settings |
| `NEON_ORG_ID` | ID da organização (configurado no painel do provedor) | Neon Console > Organization settings |
| `RENDER_API_KEY` | Consultar serviços, deploys e métricas | Render > Account settings > API keys |
| `RENDER_OWNER_ID` | Opcional; se vazio, descobre via `/owners` | Render > Workspace settings |
| `RENDER_SERVICE_IDS` | Opcional; lista separada por vírgula | Render > serviço > ID |
| `VERCEL_TOKEN` | Consultar team, projeto e deploys | Vercel > Account settings > Tokens |
| `VERCEL_TEAM_ID` | ID do team (configurado no painel do provedor) | Vercel > Team settings |
| `VERCEL_PROJECT_ID` | ID do projeto (configurado no painel do provedor) | Vercel > Project settings |
| `GITHUB_TOKEN` | Opcional; billing de Actions e repositório | GitHub > Developer settings > PAT |
| `GITHUB_OWNER` / `GITHUB_REPO` | Default: o repositório deste projeto | — |

- No `render.yaml`, os IDs ficam versionados e os tokens usam `sync: false`; preencha os valores no painel do Render (Service > Environment) e faça o deploy. Não commite tokens.
- **Neon:** storage soma o `logical_size` das branches contra 1 GB do Free; compute em CU-horas contra 100; egress estimado contra 5 GB; branches contra 10. Ajuste os limites se o plano mudar.
- **Render:** mostra serviços, último deploy, CPU/memória/rede e uma **estimativa** de instance hours contra 750 h. O consumo oficial de bandwidth/build minutes só existe no dashboard.
- **Vercel:** plano Hobby; builds são inferidos dos deploys. O endpoint oficial `/v1/usage` exige Pro/Enterprise, então alguns números ficam parciais.
- **GitHub:** minutos de Actions via billing API quando o token tem `manage_billing:read`; sem isso, o card fica parcial.
- A página atualiza a cada 60 s e tem botão **Atualizar**. Cards sem chave aparecem como **Não configurado**; 401/403 indicam chave inválida ou sessão expirada.
- Segurança: os tokens ficam somente no backend; o browser usa apenas a chave global já existente no login. Se um token vazar, rotacione no provedor e no Render.

## 11. Registro de decisões

- Plano Render free por opção de custo; upgrade para Starter quando houver clientes pagantes.
- Manager sem fonte: patches aplicados direto no bundle (documentados na seção 4).
- Integrações habilitadas em `render.yaml`.
- Marca WhatsAI aplicada ao manager (título, logos, textos).
- ~~Conexão oficial (Cloud API) é a única oferta a clientes.~~ Substituído em 02/11/2026: Essencial e Profissional usam WhatsApp Web (Baileys), com aviso de risco no contrato; o Premium usa a Cloud API.
- 29/10/2026: bot OpenAI ganhou `tokenParam` (compatibilidade com modelos de raciocínio) e `humanResumeMinutes` (pausa/retomada quando o dono escreve). `expire` continua sem efeito no OpenAI. Detalhes, curls, limitações e deploy na seção 12.
- Cloud API: a pausa humana passou a funcionar pelos ecos da Coexistence (`smb_message_echoes`, PR #2). Falta validar com um número real.
- 02/11/2026: preços fixos aprovados (seção 6) e auditoria do que a landing promete contra o código (seção 13).
- 03/11/2026: servidor MCP embutido em `/mcp` para operar o projeto por assistentes de IA (seção 14).
- 03/11/2026: reajuste da implantação e dos adicionais (seção 6); mensalidades e excedente mantidos. Contratos e propostas enviados antes mantêm seus preços durante a validade.
- 03/11/2026: correções de robustez vindas das issues do upstream (branch `fix/upstream-hardening`): o bot responde uma vez por mensagem mesmo quando o WhatsApp reentrega o mesmo id (cache de 24 h); mensagens temporárias, de visualização única e documentos com legenda são lidos pelo conteúdo real; uma mensagem com erro não derruba as outras do lote; edições, exclusões e o aviso de "mensagens temporárias" não viram mensagem nova para a IA; `msgCall` só sai com `rejectCall` ligado; o token de uma instância não acessa outra pela query (`?instanceName=`); com o banco fora do ar a mensagem ainda vai para o bot e a falha aparece na Observabilidade; o card WhatsApp mostra a última mensagem recebida por instância. Paliativo da CVE do Baileys (GHSA-qvv5-jq5g-4cgg) até o upgrade: respostas de "placeholder resend" só são aceitas para ids que a própria API pediu. Nova migration `20261103120000_message_key_id_index` (só um índice, aplicada no start do container). O upgrade do Baileys continua pendente: testar antes num número descartável.
- Planejado: banco Neon Free → Supabase Free; Render Free → Starter (US$ 7/mês) ao ter cliente pagante; landing/painel fora do Vercel Hobby (os termos proíbem uso comercial) → Cloudflare Pages (gratuito) ou Vercel Pro.

## 12. Bot OpenAI: modelos, pausa humana e limitações

Vale para o bot OpenAI (`/openai/*`) em instâncias **Baileys**. Os exemplos seguem o código do fork (rotas e campos `required` do schema), que em vários pontos difere da OpenAPI oficial.

Variáveis usadas nos exemplos:

```bash
SERVER_URL="https://<url-da-api>"   # URL do serviço web, no painel do Render
APIKEY="<chave global ou token da instância>"
INSTANCE="escritorio-silva"
```

Header sempre `apikey: $APIKEY` e `Content-Type: application/json`. `creds` e `create` retornam 201; as demais rotas, 200.

### 12.1 `tokenParam` e `maxTokens` (modelos de raciocínio)

Modelos novos (gpt-5.x, gpt-6, o1/o3...) recusam `max_tokens` e exigem `max_completion_tokens`. O campo `tokenParam` existe no bot e nas settings (`'auto'` | `'max_tokens'` | `'max_completion_tokens'`; default `'auto'`). Precedência: bot > settings > `'auto'` (bot `null` herda do settings).

- **`auto`:** modelos que casam com `/^(ft:)?(o\d|gpt-5|gpt-6)/i` usam `max_completion_tokens`; os demais (gpt-4o, gpt-4o-mini...) usam `max_tokens`.
- **Retry único:** se a OpenAI responder 400 "Unsupported parameter", a API repete a chamada uma vez com o outro parâmetro. No `auto` o parâmetro que funcionou fica memorizado por modelo (só em memória; zera no restart). Em modo forçado também há 1 retry, com `WARN` no log, mas **sem** memorizar.
- **`maxTokens` continua obrigatório** no `chatCompletion` (fallback interno de 500 se vier vazio). Modelos de raciocínio gastam tokens internos de "pensamento" dentro desse limite: com `maxTokens` baixo a resposta pode vir vazia ou cortada. Para gpt-5/o-series use um valor maior (ex.: 2000 ou mais).
- Dois bots da mesma instância não podem ter o mesmo `model` + `maxTokens`; para trocar de modelo, atualize o bot existente (PUT).

### 12.2 Pausa humana e `humanResumeMinutes`

Problema resolvido: com `stopBotFromMe=true`, quando o dono escrevia (celular ou WhatsApp Web/Desktop) a sessão ia para `paused` e **nunca voltava**, e a primeira mensagem do cliente depois da pausa era engolida.

`humanResumeMinutes` (inteiro >= 0; **default 0 = nunca volta sozinha**). Precedência: bot > settings > 0 (bot `null` herda do settings). **Requer `stopBotFromMe=true`.**

| Situação | Comportamento |
|---|---|
| Dono escreve (celular, WhatsApp Web ou Desktop) com sessão existente | Sessão vai para `paused`; `parameters.humanLastMessageAt` = horário da mensagem humana. Atualizado a cada mensagem humana e nunca volta no tempo |
| Dono escreve e **não existe sessão** | Cria uma sessão **já pausada** (o bot não entra). Exige que algum bot case com a mensagem: use `triggerType: "all"` ou configure o bot de fallback. Com bots só por palavra-chave e sem fallback, nenhuma sessão é criada |
| Cliente escreve durante a pausa | Ignorado: sem resposta e sem gravar nada no banco. As mensagens **não ficam guardadas** para depois |
| Passaram X minutos desde a **última** mensagem humana e o cliente escreve | A sessão reabre e a mensagem do cliente é respondida **na hora** |
| `humanResumeMinutes = 0` | Só volta manualmente (`changeStatus` `opened`) ou pela `keywordFinish` do cliente (fecha/apaga a sessão) |
| Resposta do próprio bot (inclui partes do `splitMessages`) | **Não** pausa: os ids das mensagens enviadas pelo bot ficam registrados (TTL 10 min) e o eco é ignorado |
| Resposta da OpenAI chega depois que o humano escreveu | Descartada (a sessão volta a `paused`); as partes restantes do `splitMessages` também |
| Humano escreve durante o debounce do cliente | Nenhuma resposta (o debounce relê a sessão ao disparar) |
| Atendente responde pelo **Chatwoot** (integração ligada) | Conta como humano e pausa o bot |
| Envio pela API REST (`/message/sendText`, n8n, CRM) | **Não** pausa: a API não recebe de volta o que ela mesma envia (`emitOwnEvents: false`). Para pausar ao assumir por um painel próprio, chame `changeStatus` `paused` |
| Auto-resposta de chamada (`msgCall`) | Não pausa. Só é enviada quando `rejectCall` está ligado (a chamada é recusada) |

### 12.3 Sessões legadas e pausa manual

- **Sessão legada** (pausada antes desta versão, sem `humanLastMessageAt`): com `humanResumeMinutes > 0` usa o `updatedAt` da sessão (momento da pausa) como referência; com `0` fica pausada até `changeStatus` `opened`.
- **`changeStatus` `paused` (manual):** marca `parameters.manualPause=true`; **nunca** é reaberta por `humanResumeMinutes` e só sai com `changeStatus` `opened`.
- `changeStatus` `opened` limpa `humanLastMessageAt` e `manualPause`: a próxima mensagem do cliente é respondida e não repausa.
- `keepOpen=true` + `keywordFinish`: a sessão fica `closed` e o bot silencia nesse contato até um `changeStatus` `opened`. Para o escritório prefira `keepOpen=false` (a sessão é apagada e a próxima mensagem abre outra).

### 12.4 Exemplos (curl)

```bash
# 1. Credencial OpenAI (a mesma chave não pode ser cadastrada em duas instâncias)
curl -X POST "$SERVER_URL/openai/creds/$INSTANCE" \
  -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{"name":"openai-escritorio","apiKey":"sk-proj-..."}'
# a resposta traz o id: use como <openaiCredsId>

# 2. Settings da instância. Obrigatórios: openaiCredsId, expire, keywordFinish, delayMessage,
#    unknownMessage, listeningFromMe, stopBotFromMe, keepOpen, debounceTime, ignoreJids
curl -X POST "$SERVER_URL/openai/settings/$INSTANCE" \
  -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{
    "openaiCredsId": "<openaiCredsId>",
    "expire": 0,
    "keywordFinish": "#sair",
    "delayMessage": 1500,
    "unknownMessage": "Desculpe, tive um problema para responder agora. Um atendente do escritório vai falar com você em breve.",
    "listeningFromMe": false,
    "stopBotFromMe": true,
    "keepOpen": false,
    "debounceTime": 12,
    "ignoreJids": ["@g.us"],
    "speechToText": true,
    "tokenParam": "auto",
    "humanResumeMinutes": 60,
    "openaiIdFallback": "<openaiBotId>"
  }'
# "openaiIdFallback" (como na doc oficial) e "fallbackId" são aceitos; nenhum dos dois é obrigatório.
# O fetchSettings devolve esse campo como "fallbackId".

# 3. Criar bot chatCompletion. Obrigatórios: enabled, openaiCredsId, botType, triggerType
#    (chatCompletion exige ainda model e maxTokens). Use sempre botType "chatCompletion": o modo "assistant"
#    não funciona mais, porque a OpenAI desligou a Assistants API em 26/08/2026
curl -X POST "$SERVER_URL/openai/create/$INSTANCE" \
  -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "openaiCredsId": "<openaiCredsId>",
    "botType": "chatCompletion",
    "model": "gpt-4o",
    "systemMessages": ["Você é a assistente virtual do escritório. Responda em português, de forma curta e cordial."],
    "assistantMessages": [],
    "userMessages": [],
    "maxTokens": 500,
    "tokenParam": "auto",
    "humanResumeMinutes": 60,
    "triggerType": "all"
  }'
# Para gpt-5.x / gpt-6-luna use "model": "gpt-6-luna" e "maxTokens": 2000

# 4. Atualizar bot (PUT). O corpo passa pelo MESMO schema do create: mande sempre
#    enabled, openaiCredsId, botType e triggerType (+ model e maxTokens no chatCompletion)
curl -X PUT "$SERVER_URL/openai/update/<openaiBotId>/$INSTANCE" \
  -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "openaiCredsId": "<openaiCredsId>",
    "botType": "chatCompletion",
    "model": "gpt-6-luna",
    "maxTokens": 2000,
    "triggerType": "all",
    "tokenParam": "auto",
    "humanResumeMinutes": 30
  }'
# Não há como voltar um campo do bot a "herdar do settings" (null é rejeitado); ajuste o valor ou use as settings.

# 5. Ver as settings (tokenParam, humanResumeMinutes, fallbackId...)
curl "$SERVER_URL/openai/fetchSettings/$INSTANCE" -H "apikey: $APIKEY"

# 6. Reativar o bot para um contato, ou pausar manualmente. JID completo;
#    status: opened | paused | closed | delete
curl -X POST "$SERVER_URL/openai/changeStatus/$INSTANCE" \
  -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{"remoteJid":"5521999999999@s.whatsapp.net","status":"opened"}'

curl -X POST "$SERVER_URL/openai/changeStatus/$INSTANCE" \
  -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{"remoteJid":"5521999999999@s.whatsapp.net","status":"paused"}'

# 7. Ver as sessões: status (opened | paused | closed) e parameters
curl "$SERVER_URL/openai/fetchSessions/<openaiBotId>/$INSTANCE" -H "apikey: $APIKEY"
# pausa humana: "parameters": {"humanLastMessageAt": "2026-10-29T18:00:00.000Z"}
# pausa manual: "parameters": {"manualPause": true}
```

### 12.5 `expire`, erros da OpenAI e `unknownMessage`

- **`expire` não faz nada no bot OpenAI.** A doc oficial promete encerrar a sessão por inatividade, mas no fork só o Typebot aplica esse valor. A retomada após intervenção humana é feita por `humanResumeMinutes`, que **não** substitui `expire` (só vale para sessão pausada, contada desde a última mensagem humana).
- **Erros da OpenAI nunca vão ao cliente.** O cliente recebe apenas o `unknownMessage` das settings, se configurado; string vazia = não envia nada (o erro fica só no log). A mesma regra vale para falha de transcrição de áudio.
- Atenção: o default criado automaticamente é em inglês (`Sorry, I dont understand`). **Configure o `unknownMessage` em PT-BR** (exemplo acima). O envio só ocorre se a sessão ainda estiver `opened`.

### 12.6 Imagens

As imagens do cliente vão para a OpenAI como **data URL** (base64): a API baixa pelo canal, usa o base64 da mensagem ou a URL pública (S3/MinIO). Se não conseguir obter a imagem, o fluxo segue só com texto e a nota `[imagem não pôde ser processada]` (no lugar do antigo erro `Failed to download file`).

### 12.7 Limitações conhecidas

- **Manager (bundle sem fonte):** não mostra nem edita `tokenParam` e `humanResumeMinutes`; só pela API. Salvar um bot/settings no Manager **não apaga** os valores definidos por API.
- **Cloud API (WHATSAPP-BUSINESS):** a pausa humana depende da **Coexistence** e **ainda não foi validada com um número real**.
  - Sem Coexistence, o número só existe na API: não há app para a equipe responder e, portanto, não há eco. A equipe precisaria de outro canal (ex.: Chatwoot, que conta como humano) ou da pausa manual (`changeStatus`).
  - Com Coexistence, a Meta envia `smb_message_echoes` com as mensagens que o dono manda pelo app WhatsApp Business ou dispositivo vinculado; a API trata esses ecos como `fromMe` e pausa o bot como no Baileys. WhatsApp para Windows e WearOS **não** geram eco, e a Meta descreve o eco como "best-effort".
  - Coexistence só é ativada pelo Embedded Signup de um parceiro da Meta (Solution Partner ou Tech Provider) e exige o app WhatsApp Business 2.24.17 ou mais novo.
  - No app da Meta assine os campos `messages` e `smb_message_echoes`. `smb_app_state_sync`, `history` e `account_update` são ignorados com log verbose.
- WhatsApp Web/Desktop do dono funciona igual ao celular (Baileys).
- O registro de ids do bot e o mapa do `tokenParam` são **por processo**: valem para 1 réplica da API (Render atual). Com mais réplicas, pausa humana e memória do `tokenParam` ficam inconsistentes.
- Envios pela API REST (n8n, CRM, painel próprio) **não** pausam o bot; só mensagens digitadas no WhatsApp (celular/Web/Desktop) ou respostas de atendente pelo Chatwoot. Para pausar a partir de um painel, use `changeStatus` `paused`.
- Mensagens do cliente durante a pausa não são guardadas para responder depois.
- Só o bot OpenAI tem retomada por `humanResumeMinutes`; Typebot, Dify etc. mantêm o comportamento anterior.
- **Modo `assistant` indisponível:** a OpenAI desligou a Assistants API em 26/08/2026. Bots com `botType: "assistant"` (e o `functionUrl`, que só existia nesse modo) não respondem mais; use `chatCompletion`. Integrações com agenda, planilha ou CRM são feitas como serviço sob medida (webhook/n8n), não pelo bot.

### 12.8 Deploy e atualização

1. **Antes do merge:** crie um snapshot/branch do projeto no Neon.
2. A migration `20261029120000_add_openai_token_param_human_resume` é **aditiva** (colunas novas nullable ou com default) e roda no start do container (`Docker/scripts/deploy_database.sh` > `prisma migrate deploy`). O default `auto` preserva o comportamento do gpt-4o. **Atenção:** com `humanResumeMinutes = 0` (default) uma sessão pausada não reabre mais sozinha na mensagem seguinte do cliente (antes reabria, engolindo essa mensagem); logo após o deploy defina `humanResumeMinutes` pela API (settings e/ou bot) com o valor combinado com o escritório.
3. O merge na `main` dispara deploy automático no Render; a API fica ~4 min fora. Faça fora do horário comercial do escritório.
4. **Rollback:** reverter o merge e deixar o Render redeployar. As colunas extras permanecem no banco e são ignoradas pelo código antigo.
5. O script de migration imprime a `DATABASE_URL` no log de boot: não compartilhe esse trecho do log.

### 12.9 Ver o estado da pausa por contato

`GET /openai/fetchSessions/{openaiBotId}/{instancia}` devolve as sessões como antes e, em cada uma, o campo extra `humanPause`: `null` quando o bot está ativo naquele contato, ou um objeto com o estado da pausa. Só o bot OpenAI tem esse campo.

```bash
curl "$SERVER_URL/openai/fetchSessions/<openaiBotId>/$INSTANCE" -H "apikey: $APIKEY"
```

```json
[
  {
    "id": "cmoab1c2d0001xyz",
    "remoteJid": "5521999999999@s.whatsapp.net",
    "status": "paused",
    "botId": "<openaiBotId>",
    "parameters": { "humanLastMessageAt": "2026-10-29T18:00:00.000Z" },
    "updatedAt": "2026-10-29T18:00:00.123Z",
    "humanPause": {
      "reason": "human",
      "since": "2026-10-29T18:00:00.000Z",
      "lastHumanMessageAt": "2026-10-29T18:00:00.000Z",
      "resumeMinutes": 60,
      "resumesAt": "2026-10-29T19:00:00.000Z",
      "remainingSeconds": 2710,
      "autoResume": true
    }
  },
  {
    "id": "cmoab1c2d0002xyz",
    "remoteJid": "5521988888888@s.whatsapp.net",
    "status": "opened",
    "humanPause": null
  }
]
```

(Os demais campos da sessão, como `sessionId`, `pushName`, `awaitUser`, `context`, `type`, `instanceId`, `createdAt`, seguem iguais e foram omitidos acima.)

| Campo de `humanPause` | Significado |
|---|---|
| `reason` | `human`: o dono escreveu no WhatsApp. `manual`: `changeStatus` `paused`. `legacy`: pausada antes de existir `humanLastMessageAt` |
| `since` | Desde quando conta a pausa (ISO): a última mensagem humana; no `manual` e no `legacy`, o `updatedAt` da sessão. Pode ser `null` num `legacy` sem `updatedAt` |
| `lastHumanMessageAt` | Última mensagem humana registrada (ISO) ou `null` |
| `resumeMinutes` | `humanResumeMinutes` efetivo (bot, depois settings, depois 0) |
| `resumesAt` | Quando a pausa expira (ISO). `null` se for `manual` ou `resumeMinutes` for 0 |
| `remainingSeconds` | Segundos que faltam (>= 0). `0` = já expirou: o bot **volta na próxima mensagem do cliente** (não há timer; ninguém reabre a sessão sozinho). `null` quando `resumesAt` é `null` |
| `autoResume` | `true` quando existe um horário de retomada |

Leitura rápida: `humanPause: null` = bot ativo; `autoResume: false` = só volta com `changeStatus` `opened` (ou pela `keywordFinish` do cliente); `remainingSeconds: 0` = expirada, falta o cliente escrever. Uma sessão `closed` também vem com `humanPause: null`.

#### Webhook `openai.change_status`

Aviso opcional, no momento em que o estado da pausa muda. É um evento novo, **opt-in**: só é enviado à instância que o assinar na lista de eventos do webhook (`OPENAI_CHANGE_STATUS`). Não exige variável de ambiente nem migration. Sem assinatura, nada muda para quem já usa webhook.

```bash
# Inclua OPENAI_CHANGE_STATUS na lista (a lista substitui a anterior: mande também os eventos que já usa)
curl -X POST "$SERVER_URL/webhook/set/$INSTANCE" \
  -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "https://seu-painel.exemplo/webhook",
      "byEvents": false,
      "base64": false,
      "events": ["MESSAGES_UPSERT", "OPENAI_CHANGE_STATUS"]
    }
  }'
```

Com `byEvents: true` a URL recebe o sufixo `/openai-change-status`.

Quando dispara:

| `reason` | `status` | Origem |
|---|---|---|
| `human` | `paused` | O dono escreveu no WhatsApp (inclui criar a sessão já pausada). Dispara só na **entrada** da pausa; mensagens humanas seguintes só adiam o `resumesAt` (veja no `fetchSessions`) |
| `resumed` | `opened` | Retomada automática: passou `humanResumeMinutes` e o cliente escreveu |
| `manual` | `paused`, `opened`, `closed` ou `delete` | `POST /openai/changeStatus` |

Corpo do evento (campo `data`; o envelope tem `event`, `instance`, `date_time`, `sender`, `server_url`, `apikey`):

```json
{
  "event": "openai.change_status",
  "instance": "escritorio-silva",
  "data": {
    "remoteJid": "5521999999999@s.whatsapp.net",
    "status": "paused",
    "reason": "human",
    "session": { "id": "cmoab1c2d0001xyz", "botId": "<openaiBotId>" },
    "humanPause": {
      "reason": "human",
      "since": "2026-10-29T18:00:00.000Z",
      "lastHumanMessageAt": "2026-10-29T18:00:00.000Z",
      "resumeMinutes": 60,
      "resumesAt": "2026-10-29T19:00:00.000Z",
      "remainingSeconds": 3600,
      "autoResume": true
    }
  }
}
```

`humanPause` tem o mesmo formato do `fetchSessions` e é `null` quando a sessão deixou de estar pausada (`resumed`, `opened`, `closed`, `delete`). Observações: o envio é em segundo plano e uma falha só aparece no log (não atrasa nem derruba o bot); o evento só vale para o webhook da instância (não existe chave `WEBHOOK_EVENTS_*` para o webhook global); o fechamento pela `keywordFinish` do cliente não gera evento; o webhook não é reenviado se a API reiniciar.

### 12.10 Mídia (áudio, imagem, documentos) e memória da conversa

Campos do bot OpenAI e das settings. No bot, `null`/ausente = **herda** das settings; nas settings valem os defaults abaixo (aplicados pela migration `20261030120000_add_openai_media_and_history`, aditiva). Precedência: bot > settings > default. No Manager ficam na seção **"Mídia (áudio, imagem, documentos)"** do bot e das Configurações Padrão; `historyMessages` fica junto do `maxTokens` (bot) e do `tokenParam` (settings).

| Campo | Default | O que faz |
|---|---|---|
| `transcribeAudio` | `true` | Áudio do contato é transcrito e a IA responde ao texto. `false`: a IA recebe `[o contato enviou um áudio]` |
| `transcriptionModel` | `gpt-transcribe` | Modelo de `/v1/audio/transcriptions`. Se a OpenAI recusar o modelo (400/404 `model_not_found`), tenta `whisper-1` **uma vez** e loga `WARN` |
| `maxAudioSeconds` | `300` | Áudio mais longo (duração informada pelo WhatsApp) não é transcrito: `[o contato enviou um áudio de N min; a equipe vai ouvir]`. `0` = sem limite |
| `readImages` | `true` | `false`: a imagem não é baixada; a IA recebe `[o contato enviou uma imagem]` + legenda |
| `readDocuments` | `true` | PDFs dentro do limite vão para a IA (ver abaixo). `false`: todo documento vira descrição |
| `maxDocumentMB` | `10` | Tamanho máximo do PDF enviado à IA (1 a 32) |
| `historyMessages` | `10` | Quantas mensagens anteriores a IA lembra no Chat Completions (2 a 100). Mais mensagens = menos perguntas repetidas e custo um pouco maior. **Recomendado 30–40 para triagens longas** (com 10, o nome dito no início da triagem sai da janela) |

O que a IA recebe em cada tipo de mensagem (só no bot OpenAI; Typebot, Dify etc. continuam recebendo o texto cru):

| Mensagem | Texto que chega à IA |
|---|---|
| Vídeo (inclusive vídeo redondo e visualização única) | `[o contato enviou um vídeo]` + legenda |
| Figurinha | `[figurinha]` (antes chegava a palavra `unknown`) |
| Localização | `[localização: -23.5613, -46.6565 - Nome - Endereço]` (nome/endereço quando houver) |
| Contato | `[contato compartilhado: Maria Souza]` |
| Documento que não é PDF (doc, docx, xls...) ou PDF acima do limite | `[o contato enviou o documento contrato.docx (DOCX)]` + legenda |
| PDF com mais de 20 páginas | `[o contato enviou o documento autos.pdf (PDF, 35 páginas)]` |

**PDF:** no `chatCompletion` o PDF vai como *file input* do Chat Completions (`{"type":"file","file":{"filename","file_data":"data:application/pdf;base64,..."}}`, suportado pelo SDK `openai` instalado), sem biblioteca de PDF no servidor. Antes de enviar a API confere o tamanho (declarado pelo WhatsApp e real, após o download), se o arquivo é mesmo um PDF e conta as páginas (limite fixo de 20, para controlar custo: a OpenAI lê cada página como texto **e** imagem). Se o modelo recusar o arquivo (400), a chamada é refeita uma vez com o documento descrito como texto e o cliente recebe resposta normalmente.

**Privacidade e custo:**

- Base64 de imagem/PDF **nunca** vai para o histórico (`session.context`) nem para os logs: no histórico fica `[imagem]` / `[documento: nome.pdf]`. Por isso, nas mensagens seguintes a IA só lembra do documento pelo que ela mesma respondeu.
- O conteúdo das transcrições e dos PDFs não é logado (só tamanho, páginas e modelo).
- A transcrição usa a credencial **do bot**. Custo de referência: `gpt-transcribe` US$ 0,0045/min.
- `speechToText` das settings (transcrição no recebimento, para webhook/Chatwoot e outros bots) **não mudou**. Atenção: com ele ligado o áudio já chega transcrito a todos os bots, inclusive ao OpenAI, mesmo com `transcribeAudio=false`; essa transcrição agora também usa o `transcriptionModel` das settings (com o mesmo fallback para `whisper-1`).

```bash
# Settings: triagem longa e PDFs de até 15 MB (os demais campos obrigatórios como em 12.4)
curl -X POST "$SERVER_URL/openai/settings/$INSTANCE" \
  -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{ "...": "campos obrigatórios", "historyMessages": 40, "maxDocumentMB": 15, "transcriptionModel": "gpt-transcribe" }'

# Bot: não ler imagens e áudios de até 2 min (false e 0 são valores; campo ausente = herda)
curl -X PUT "$SERVER_URL/openai/update/<openaiBotId>/$INSTANCE" \
  -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{ "enabled": true, "openaiCredsId": "<openaiCredsId>", "botType": "chatCompletion",
        "model": "gpt-6-luna", "maxTokens": 2000, "triggerType": "all",
        "readImages": false, "maxAudioSeconds": 120 }'
```

Limitações: na Cloud API o WhatsApp não informa a duração do áudio (o limite de `maxAudioSeconds` não se aplica) nem sempre o tamanho do documento (a checagem é feita após o download); com `debounceTime`, só a **última** mensagem da rajada tem a mídia baixada (áudios/imagens anteriores da mesma rajada viram descrição); como nos outros campos, não dá para voltar um campo do bot a "herdar" depois de definido.

## 13. O que é automático e o que é serviço (auditoria de 02/11/2026)

Conferido no código (`src/api/integrations/chatbot/openai/**`, `base-chatbot.*`, `src/utils/humanPause.ts`, `src/utils/openaiMedia.ts`, `channel/meta/**`, `observability*`). Use esta lista para não prometer o que não existe.

| Recurso | Situação | Observação |
|---|---|---|
| Resposta 24 h com as instruções do negócio | Automático | Chat Completions; o prompt é a mensagem de sistema do bot |
| Memória da conversa | Automático | `historyMessages`, 2 a 100 (default 10; recomendado 30–40) |
| Áudio | Automático | `gpt-transcribe`, com `whisper-1` como reserva; até `maxAudioSeconds` (300 s). Na Cloud API a duração não é informada e o limite não se aplica |
| Foto | Automático | Vai como data URL. Depende de o modelo aceitar imagem: validar com o modelo do bot (gpt-6-luna) |
| PDF | Automático, a validar | *File input* até 10 MB e 20 páginas. Se o modelo recusar (400), a IA recebe só a descrição do arquivo. **Leitura de PDF pelo gpt-6-luna ainda não confirmada em produção** |
| Vídeo, figurinha, localização, contato | Automático | Viram descrição em texto para a IA |
| Junção de mensagens seguidas | Automático | `debounceTime` (produção: ~10 s) |
| Tempo de resposta | Medido | ~10 s de espera + ~18–26 s da OpenAI = **~30–40 s**. Não prometa "resposta na hora" nem "em 18 s" |
| Pausa quando a equipe responde | Automático (WhatsApp Web); a validar (Cloud API) | Cloud API só com Coexistence (seção 12.7) |
| Retomada após X minutos | Automático | `humanResumeMinutes`; a IA volta na **próxima** mensagem do cliente depois do prazo |
| Pausa e reativação manual | Serviço | Pelo painel ou `changeStatus`. **O cliente não acessa o painel** (seção 2): é feito pela nossa equipe |
| Ignorar grupos | Configuração | `groupsIgnore` da instância e/ou `ignoreJids: ["@g.us"]` |
| Falha técnica | Automático | Erro cru nunca vai ao cliente; ele recebe o `unknownMessage` (configure em PT-BR) ou nada |
| "Passa para uma pessoa quando o cliente pede" | **Só instrução do prompt** | Não há aviso para a equipe nem pausa automática no pedido. `#sair` (`keywordFinish`) com `keepOpen=false` apaga a sessão e a próxima mensagem abre outra, ou seja, a IA volta a responder |
| "Não inventa preços" | **Orientação** | O prompt instrui; não é garantia técnica |
| Se apresentar como assistente e não pedir dados sensíveis | **Orientação** | Depende do prompt de cada cliente |
| Vários números, cada um com sua IA | Automático | 1 instância por número, bot e credencial próprios. A visão de todos num painel é do operador |
| Integrações (agenda, planilha, CRM) | **Serviço sob medida** | Feitas como serviço próprio, via webhook (`MESSAGES_UPSERT`, `OPENAI_CHANGE_STATUS`) e n8n. O bot usa só Chat Completions, que não chama ferramentas. O `functionUrl` e o modo Assistants **não estão disponíveis**: a OpenAI desligou a Assistants API em 26/08/2026 |
| Relatório mensal | **Serviço manual** | Não existe relatório automático. Fonte: uso do project key na OpenAI, sessões e Observabilidade |
| Contagem da franquia de respostas | **Não existe** | As mensagens enviadas pela IA não são marcadas no banco (o registro de ids é só cache de 10 min) |
| Monitoramento e alertas | Painel do operador | A Observabilidade mostra limites e alertas na tela; não envia aviso por e-mail ou WhatsApp |
| Lembretes ativos de consulta | **Não existe** | Exigiria integração e, na Cloud API, templates pagos |
| Retenção de 90 dias | **Processo manual** | Não há expurgo automático (seção 7) |

Recomendações de produto, em ordem: (1) marcar no banco quais mensagens foram da IA e quais da equipe (contagem de franquia, relatório e auditoria); (2) quando o cliente pedir uma pessoa, pausar a sessão e avisar a equipe (mensagem para um número interno ou webhook); (3) relatório mensal gerado a partir dessa marcação; (4) expurgo automático pela retenção do contrato; (5) validar PDF e foto no gpt-6-luna e a pausa da Cloud API com um número em Coexistence.

## 14. MCP (Claude, ChatGPT, Cursor)

A API tem um **servidor MCP** (Model Context Protocol) embutido, no mesmo serviço web do Render: sem serviço novo, sem custo novo. Com ele, um assistente de IA (Claude Code, Claude Desktop, conector do claude.ai, ChatGPT em modo desenvolvedor, Cursor, Codex) consulta instâncias, conversas, mídias e o bot, e faz algumas ações limitadas.

- **Endpoint:** `POST https://<url-da-api>/mcp` (a URL do serviço web, no painel do Render). Transporte *Streamable HTTP*, sem sessão (cada POST é independente); `GET` e `DELETE` respondem 405.
- **Chave:** header `Authorization: Bearer <chave>` ou `apikey: <chave>`, as mesmas da API REST. A **chave global** (`AUTHENTICATION_API_KEY`) vê todas as instâncias; o **token de uma instância** vê só aquela instância (a observabilidade exige a chave global). Não precisa de nenhuma variável nova: funciona logo após o deploy.
- **Render free dorme:** a primeira chamada depois de um tempo parado pode levar **~50 s** (o serviço está acordando). Se o cliente der timeout, repita.

### 14.1 Como conectar

Use sempre placeholders nos exemplos e guarde a chave fora do Git.

**Claude Code**

```bash
claude mcp add --transport http whatsai https://<url-da-api>/mcp --header "apikey: SUA_CHAVE"
```

**Claude Desktop** (via `mcp-remote`, em `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "whatsai": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<url-da-api>/mcp", "--header", "apikey:${WHATSAI_KEY}"],
      "env": { "WHATSAI_KEY": "SUA_CHAVE" }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`; não commite este arquivo com a chave):

```json
{
  "mcpServers": {
    "whatsai": { "url": "https://<url-da-api>/mcp", "headers": { "apikey": "SUA_CHAVE" } }
  }
}
```

**Codex e outros clientes:** qualquer cliente com *Streamable HTTP* e header customizado funciona com a URL acima e o header `Authorization: Bearer SUA_CHAVE` (no Codex, o servidor HTTP com token por variável de ambiente; confira a documentação do cliente).

**ChatGPT (modo desenvolvedor) e conector personalizado do claude.ai:** esses clientes não deixam mandar header. Para eles existe o **modo URL**, desligado por padrão:

1. Gere um segredo longo e aleatório (mínimo 32 caracteres), por exemplo `openssl rand -hex 32`.
2. No Render: serviço da API > **Environment** > adicione `MCP_PATH_TOKEN` com esse valor > **Save** (o serviço reinicia). Não coloque o valor no `render.yaml` nem no Git.
3. No cliente, use a URL `https://<url-da-api>/mcp/<MCP_PATH_TOKEN>` com autenticação **nenhuma**.

O modo URL dá **acesso global**: trate a URL como senha (ela pode aparecer em logs de acesso do provedor). Para revogar, troque ou apague `MCP_PATH_TOKEN` no Render. Sem a variável (ou com menos de 32 caracteres), `/mcp/<qualquer coisa>` responde 404.

### 14.2 Ferramentas

| Ferramenta | Tipo | O que faz |
|---|---|---|
| `list_instances` | leitura | Instâncias, estado da conexão, número do dono, integração (contagens opcionais) |
| `get_instance_status` | leitura | Conexão ao vivo, se está carregada, última desconexão |
| `list_chats` | leitura | Conversas (LID e telefone juntos), filtros por texto, não lidas, sem grupos; paginação |
| `get_messages` | leitura | Mensagens de um contato, página 1 = mais recentes; texto, remetente, tipo, mídia, `messageId` |
| `search_messages` | leitura | Busca por texto, contato e datas; no máximo 50 resultados |
| `get_media` | leitura | Mídia pelo `messageId`: imagem até 1,5 MB volta como imagem; áudio/vídeo/documento só metadados, base64 com `include_base64` até 2 MB |
| `get_bot_config` | leitura | Bot(s) OpenAI e settings: modelo, prompt, gatilho, pausa humana etc. (chave OpenAI mascarada) |
| `list_paused_contacts` | leitura | Contatos com o bot pausado (humano ou manual) e quando voltam |
| `get_observability` | leitura | O mesmo resumo da página Observabilidade (só chave global) |
| `get_webhook_and_settings` | leitura | Settings da instância e webhook (segredos, headers e query da URL mascarados) |
| `send_text_message` | **envio** | Envia texto para um número (não envia para grupos) |
| `pause_bot_for_contact` | escrita | Pausa manual do bot para um contato (cria a sessão pausada se não existir) |
| `resume_bot_for_contact` | escrita | Reativa o bot para o contato |
| `update_bot_settings` | escrita | Altera só: prompt, modelo, expire, minutos da pausa humana, palavra de encerramento, ativo. Devolve os valores anteriores |

Na coluna de remetente, `bot` só é identificado nos últimos 10 minutos (o banco não marca a origem das mensagens, seção 13); depois aparece como `me` (número da instância).

**Recursos:** os manuais (`README-WHATSAI.md` e `readmes/*.md`) como `whatsai://docs/<nome>`. **Prompts:** `resumo_do_dia` (resume as conversas de um dia) e `revisar_atendimento` (revisa a conversa de um contato e sugere uma resposta **sem enviar**).

### 14.3 Segurança e custo

- **Não existe no MCP:** apagar ou desconectar instância, reiniciar, apagar mensagens, SQL livre, variáveis de ambiente, criar ou ver chaves de API.
- **Envio e alterações:** as ferramentas de escrita vêm marcadas para o cliente pedir confirmação; `send_text_message` sai para o cliente de verdade e `update_bot_settings` substitui valores. Confirme sempre antes de aprovar. Enviar pelo MCP não marca a mensagem como da IA: para assumir a conversa, pause o bot do contato antes.
- **Chaves:** comparadas em tempo constante, nunca registradas em log nem devolvidas; a chave OpenAI, tokens, headers de webhook e senhas aparecem mascarados (`****1234`). Erros voltam como mensagem curta, sem detalhes internos.
- **Tentativas erradas:** 10 falhas de autenticação em 15 min pelo mesmo IP bloqueiam esse IP por até 15 min (429), em memória.
- **Custo zero de infraestrutura:** nenhuma tabela ou migração nova, nenhum cache de mídia ou mensagem em banco ou disco, nenhum job, timer ou ping (o Neon continua suspendendo sozinho). Cada chamada faz poucas consultas limitadas; resultados têm teto de tamanho; mídias acima do limite nem são baixadas. O SDK do MCP só é carregado na primeira chamada.
