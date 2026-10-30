# WhatsAI — Atendimento com IA no WhatsApp

> **Atribuição:** projeto inspirado no Evolution Foundation/Evolution API. Base licenciada sob Apache 2.0, com condições adicionais.

Plataforma própria de atendimento automatizado: Evolution API (Cloud API oficial da Meta) + agente OpenAI por instância + painel WhatsAI. Cada cliente = 1 instância (1 número) com seu próprio agente.

> Este README é o manual operacional e comercial do projeto. Atualizado em 29/10/2026.
>
> **Canal do escritório atual:** o escritório de advocacia em produção usa **Baileys** (`WHATSAPP-BAILEYS`, conexão por QR code), não a Cloud API. A oferta comercial das seções 5 e 6 é a Cloud API oficial, mas a **pausa humana** e a detecção bot x humano (seção 12) funcionam **somente no Baileys**; na Cloud API ficam para uma versão futura (limitações na seção 12.7).

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
| API | `https://evolution-api-x93o.onrender.com` |
| Manager | `https://whatsaibr.vercel.app` |
| Neon (direct) | `ep-patient-band-b5qn7dx2.c-7.us-east-2.aws.neon.tech` / db `neondb` |
| Keep-alive | cron-job.org job `8703746` (GET `/` a cada 5 min) |
| Repo | `github.com/devconnecting1/evolution-api-render` (remote `render`) |

## 2. Segredos e acessos

- **API key global** (`AUTHENTICATION_API_KEY`): definida somente no dashboard do Render (`sync: false`), fora do Git. É super-admin — **nunca** compartilhar com cliente. A chave antiga ficou no histórico do repositório; rotacione-a.
- **Neon**: URI direct configurada no Render (`DATABASE_CONNECTION_URI`, `sync: false`). Não commitar.
- **Tokens de deploy** (efêmeros, Cloud Shell): `/tmp/opencode/vercel-token`, `/tmp/opencode/cron-job-token`. Se sumirem, gerar novos. No GitHub, o secret `VERCEL_TOKEN` alimenta o workflow de deploy do manager.
- **Manager**: acesso somente do operador (você). Cliente usa apenas o WhatsApp.

## 3. Deploy

```bash
# API (o remote "origin" é o upstream EvolutionAPI — NÃO usar para push)
git push render main          # dispara deploy automático no Render

# Manager: deploy automático via GitHub Actions ao alterar manager/dist/**
# Fallback manual:
./scripts/sync-readmes.sh     # copia os READMEs para o manager
cd manager/dist
VERCEL_TOKEN=$(cat /tmp/opencode/vercel-token) \
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
- [ ] (Oficial) Webhook `/webhook/meta` ativo e templates aprovados (se houver envio fora da janela de 24 h)
- [ ] Agente responde "oi" com o tom do cliente
- [ ] Perguntas de preço/horário/endereço corretas
- [ ] Handoff humano funcionando (`#sair` ou pedido explícito)
- [ ] Áudio transcrito (se `speechToText`)
- [ ] Cliente avisado sobre políticas/limites da Meta e fair use
- [ ] Contrato + cobrança do setup

## 6. Planos e preços

Recomendação: cobrar uma **implementação de R$ 1.500 a 3.000** e uma **mensalidade de R$ 297 a 797**, conforme o porte do cliente. A conta usa o custo real do projeto mais o mercado brasileiro em 2026; com essa faixa a margem fica entre 85% e 90%.

### Quanto cada cliente custa

| Item | Custo estimado por cliente/mês |
|---|---|
| Servidor + banco (Render Standard + Neon Launch divididos por ~20 clientes) | ~R$ 10–20 |
| OpenAI com **gpt-4o-mini** (~1.000 respostas/mês) | ~R$ 3–5 |
| OpenAI com **gpt-4o** (~1.000 respostas/mês) | ~R$ 40–50 |
| WhatsApp **Baileys** | R$ 0 |
| WhatsApp **Cloud API**: respostas dentro de 24 h | gratuitas (há fontes dizendo que isso pode mudar a partir de out/2026) |
| WhatsApp **Cloud API**: mensagens de marketing | ~R$ 0,32 por mensagem |
| Tempo de suporte (1–3 h/mês) | é o maior custo real |

Considerado: ~2.000 tokens de entrada e 200 de saída por resposta, com prompt e histórico. Com o **gpt-4o-mini**, o custo de IA fica quase zero; use o gpt-4o só para quem precisa de mais qualidade.

### Preço sugerido

**Implementação (cobrança única)**

| Pacote | O que inclui | Preço |
|---|---|---|
| Essencial | 1 número, prompt personalizado, base de perguntas frequentes, pausa humana, testes, treinamento de 1 h | **R$ 1.500 – 2.500** |
| Profissional | Essencial + integrações (agenda, planilha, CRM, n8n), transcrição de áudio, imagens | **R$ 3.000 – 6.000** |
| Oficial / Enterprise | Cloud API com verificação Meta, Coexistence, templates, fluxos sob medida | **R$ 6.000+** |

**Mensalidade**

| Plano | Franquia | Preço |
|---|---|---|
| Essencial | até ~1.000 respostas da IA/mês, 1 número, 1 ajuste de prompt/mês | **R$ 297 – 397** |
| Profissional | até ~3.000 respostas, relatório mensal, ajustes ilimitados, suporte em horário comercial | **R$ 597 – 797** |
| Premium | volume alto, integrações, SLA, Cloud API oficial | **R$ 1.200+** |
| Excedente | resposta acima da franquia | R$ 0,10 – 0,20 cada |

**Como estruturar a cobrança**
- **Contrato mínimo de 6 meses.** Com contrato de 12 meses, dê 30 a 50% de desconto na implementação, porque isso aumenta muito o fechamento.
- **Chave OpenAI:** use a sua chave, embutida no preço, ou peça a do cliente, cobrando menos e repassando o custo. Para clientes pequenos, embutir é mais simples. Para volume alto, use a chave do cliente.
- **Margem:** no plano Essencial a R$ 397, o custo direto fica entre R$ 20 e 60, o que dá **85–90% de margem** antes do seu tempo.

### Cuidados que entram no preço e no contrato
1. **Baileys não é oficial.** O WhatsApp pode banir o número, principalmente se o cliente fizer disparos em massa. Coloque isso no contrato e ofereça a Cloud API como opção "segura", mais cara.
2. **Regras da Meta para IA em 2026 estão mudando.** Há notícias de restrição a "assistentes de IA de uso geral" e de cobrança por mensagens a chatbots de IA, inclusive no Brasil, com disputa judicial. Bots de atendimento da própria empresa costumam ser permitidos, mas acompanhe e deixe uma cláusula de reajuste caso a Meta passe a cobrar.
3. **LGPD:** inclua um termo de tratamento de dados, avise o contato de que ele fala com uma IA e não guarde mais do que precisa.
4. **Escritórios de advocacia:** o Provimento 205/2021 da OAB limita a publicidade. A IA não deve prometer resultado nem captar clientes ativamente, só fazer triagem e agendamento.

**Exemplo (escritório de advocacia):** implementação de R$ 2.000 (ou R$ 1.000 com contrato de 12 meses), mensalidade de R$ 497 no Profissional com gpt-4o-mini e franquia de 2.000 respostas.

Os preços de mercado vêm de fontes de terceiros e mudam rápido. Confirme os valores atuais da OpenAI e da Meta antes de fechar contrato.

**Fontes**
- [Digisac — quanto custa um chatbot para WhatsApp](https://digisac.com.br/blog/quanto-custa-um-chatbot-para-whatsapp-e-como-calcular-o-retorno)
- [Eesel — Chatbot de IA para WhatsApp em 2026: custos e regras da Meta](https://www.eesel.ai/es/blog/whatsapp-ai-chatbot)
- [Olhar Digital — Meta vai cobrar por mensagens enviadas para IAs no WhatsApp](https://olhardigital.com.br/2026/03/09/pro/meta-vai-cobrar-por-mensagens-enviadas-para-ias-no-whatsapp-entenda/)
- [Tecnoblog — Meta vai cobrar chatbots de IA por uso do WhatsApp](https://tecnoblog.net/noticias/meta-vai-cobrar-chatbots-de-ia-por-uso-do-whatsapp/)
- [Tecnoblog — WhatsApp proíbe presença do ChatGPT e outras IAs](https://tecnoblog.net/noticias/whatsapp-proibe-presenca-do-chatgpt-e-outras-ias/)
- [TI Inside — custos para conversas no WhatsApp Business](https://tiinside.com.br/13/07/2026/custos-para-conversas-no-whatsapp-business-podem-chegar-a-us-500/)
- [SendPulse — WhatsApp muda regras de cobrança (out/2026)](https://sendpulse.com/br/blog/whatsapp-muda-regras-de-cobranca-para-empresas-outubro-2026)
- [Meta — Pricing on the WhatsApp Business Platform](https://developers.facebook.com/docs/whatsapp/pricing)
- [ChatMaxima — WhatsApp API pricing Brazil (jul/2026)](https://chatmaxima.com/whatsapp-api-pricing/brazil/)
- [AgentDeals — WhatsApp API pricing 2026](https://agentdeals.dev/whatsapp-business-api-pricing-2026)
- [Kommo — updated pricing rules for WhatsApp Business](https://support.kommo.com/docs/updated-pricing-rules-for-whatsapp-business.md)
- [MorphLLM — OpenAI API pricing 2026](https://morphllm.com/openai-api-pricing)
- [AnotherWrapper — GPT-4o mini pricing](https://anotherwrapper.com/tools/llm-pricing/gpt-4o-mini-2024-07-18)
- [Curlscape — OpenAI API pricing guide 2026](https://curlscape.com/blog/openai-api-pricing-guide-2026)

## 7. LGPD, segurança e riscos

- Contrato de operador de dados; retenção padrão de 90 dias (configurável); backup no Neon.
- Advocacia: sigilo profissional — não solicitar documentos sensíveis pelo chat; usar link seguro.
- **Cloud API oficial**: conexão via token permanente, WABA e Phone Number ID. A Meta pode limitar por qualidade/política, exige templates fora da janela de 24 h e cartão do cliente cadastrado; não prometa isenção de bloqueio por violação de política.
- Manager e chave global são do operador. Cliente nunca recebe a chave global.
- Uma credencial OpenAI não pode ser cadastrada em duas instâncias (a API recusa chave repetida). Para cliente com 2 números, gerar 2 project keys (uma por instância); não compartilhe a mesma key entre clientes.

## 8. Manutenção

- **Keep-alive**: cron-job.org `8703746` (5 min). Sem ele, o free dorme em 15 min.
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
| Cliente não recebe nada quando a OpenAI falha | Esperado se `unknownMessage` estiver vazio; configure em PT-BR (seção 12.5) |

## 10. Observabilidade

A aba **Observabilidade** do manager (`/manager/observability` ou `/manager/instance/:instanceId/observability`) mostra, em um só lugar, storage/consumo/limites de Neon, Render, Vercel e GitHub Actions. O endpoint `GET /observability` exige o header `apikey` (chave global) e usa cache de 60 s; `?refresh=1` força a consulta. Ele apenas lê APIs externas, não grava no Postgres. A rota antiga `/observability` redireciona para a página nativa.

| Variável | Uso | Como obter |
|---|---|---|
| `NEON_API_KEY` | Consultar projeto, branches e consumo | Neon Console > Account settings > API keys (org key) |
| `NEON_PROJECT_ID` | Projeto `spring-boat-14626479` | Neon Console > Project settings |
| `NEON_ORG_ID` | Organização `org-soft-mouse-21767293` | Neon Console > Organization settings |
| `RENDER_API_KEY` | Consultar serviços, deploys e métricas | Render > Account settings > API keys |
| `RENDER_OWNER_ID` | Opcional; se vazio, descobre via `/owners` | Render > Workspace settings |
| `RENDER_SERVICE_IDS` | Opcional; lista separada por vírgula | Render > serviço > ID |
| `VERCEL_TOKEN` | Consultar team, projeto e deploys | Vercel > Account settings > Tokens |
| `VERCEL_TEAM_ID` | Team `team_L4ydLNVlb1XnoQd49WIvXRfw` | Vercel > Team settings |
| `VERCEL_PROJECT_ID` | Projeto `prj_1qlhQq1PuLn20KRs2FK0fsD0GIvU` | Vercel > Project settings |
| `GITHUB_TOKEN` | Opcional; billing de Actions e repositório | GitHub > Developer settings > PAT |
| `GITHUB_OWNER` / `GITHUB_REPO` | Default `devconnecting1/evolution-api-render` | — |

- No `render.yaml`, os IDs ficam versionados e os tokens usam `sync: false`; preencha os valores no dashboard do Render (Service > Environment) e faça o deploy. Não commite tokens.
- **Neon:** storage soma o `logical_size` das branches contra 1 GB do Free; compute em CU-horas contra 100; egress estimado contra 5 GB; branches contra 10. Ajuste os limites se o plano mudar.
- **Render:** mostra serviços, último deploy, CPU/memória/rede e uma **estimativa** de instance hours contra 750 h. O consumo oficial de bandwidth/build minutes só existe no dashboard.
- **Vercel:** plano Hobby; builds são inferidos dos deploys. O endpoint oficial `/v1/usage` exige Pro/Enterprise, então alguns números ficam parciais.
- **GitHub:** minutos de Actions via billing API quando o token tem `manage_billing:read`; sem isso, o card fica parcial.
- A página atualiza a cada 60 s e tem botão **Atualizar**. Cards sem chave aparecem como **Não configurado**; 401/403 indicam chave inválida ou sessão expirada.
- Segurança: os tokens ficam somente no backend; o browser usa apenas a chave global já existente no login. Se um token vazar, rotacione no provedor e no Render.

## 11. Registro de decisões

- Plano Render free por opção de custo; upgrade para Starter quando houver clientes pagantes.
- Manager sem fonte: patches aplicados direto no bundle (documentados na seção 4).
- Integrações habilitadas em `render.yaml` (commit `13f1bb28`).
- Marca WhatsAI aplicada ao manager (título, logos, textos).
- Conexão oficial (Cloud API) é a única oferta a clientes; modos de teste internos não são vendidos. Exceção operacional: o escritório de advocacia já em produção roda em Baileys (seção 12).
- 29/10/2026: bot OpenAI ganhou `tokenParam` (compatibilidade com modelos de raciocínio) e `humanResumeMinutes` (pausa/retomada quando o dono escreve), só Baileys. `expire` continua sem efeito no OpenAI. Detalhes, curls, limitações e deploy na seção 12.

## 12. Bot OpenAI: modelos, pausa humana e limitações

Vale para o bot OpenAI (`/openai/*`) em instâncias **Baileys**. Os exemplos seguem o código do fork (rotas e campos `required` do schema), que em vários pontos difere da OpenAPI oficial.

Variáveis usadas nos exemplos:

```bash
SERVER_URL="https://evolution-api-x93o.onrender.com"
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
| Auto-resposta de chamada (`msgCall`) | Não pausa |

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
#    (chatCompletion exige ainda model e maxTokens; assistant exige assistantId)
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

As imagens do cliente vão para a OpenAI como **data URL** (base64): a API baixa pelo canal, usa o base64 da mensagem ou a URL pública (S3/MinIO). No modo Assistants a imagem sobe por upload `vision` e **os arquivos ficam na conta OpenAI** (considere na política de privacidade/LGPD). Se não conseguir obter a imagem, o fluxo segue só com texto e a nota `[imagem não pôde ser processada]` (no lugar do antigo erro `Failed to download file`).

### 12.7 Limitações conhecidas

- **Manager (bundle sem fonte):** não mostra nem edita `tokenParam` e `humanResumeMinutes`; só pela API. Salvar um bot/settings no Manager **não apaga** os valores definidos por API.
- **Cloud API (WHATSAPP-BUSINESS):** a pausa humana **não funciona**.
  - Sem Coexistence, o app do celular não envia mensagens pelo número (não existe eco).
  - Com Coexistence, a Meta envia `smb_message_echoes`, que a API não trata.
  - No app Meta assine só o campo `messages` (outros campos geram erro logado).
- WhatsApp Web/Desktop do dono funciona igual ao celular (Baileys).
- O registro de ids do bot e o mapa do `tokenParam` são **por processo**: valem para 1 réplica da API (Render atual). Com mais réplicas, pausa humana e memória do `tokenParam` ficam inconsistentes.
- Envios pela API REST (n8n, CRM, painel próprio) **não** pausam o bot; só mensagens digitadas no WhatsApp (celular/Web/Desktop) ou respostas de atendente pelo Chatwoot. Para pausar a partir de um painel, use `changeStatus` `paused`.
- Mensagens do cliente durante a pausa não são guardadas para responder depois.
- Só o bot OpenAI tem retomada por `humanResumeMinutes`; Typebot, Dify etc. mantêm o comportamento anterior.

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
