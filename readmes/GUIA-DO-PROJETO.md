# WhatsAI — Guia completo do projeto (para pessoas e agentes de IA)

> **Para que serve este documento:** dar a uma pessoa nova ou a um agente de IA (Claude Code, DeepSeek, Cursor etc.)
> o mapa completo do WhatsAI: o que é o produto, como o código funciona, como o painel e o site são feitos, como se
> faz deploy, como se testa e o que **não** fazer. Ele complementa — não substitui — duas fontes de verdade:
>
> - **Regras de trabalho e operação:** [`CLAUDE.md`](../CLAUDE.md)
> - **Manual do produto, planos, runbooks e decisões:** [`README-WHATSAI.md`](../README-WHATSAI.md)
>
> As imagens deste guia foram geradas com uma **API simulada e dados fictícios** (nome de escritório, contatos e
> conversas inventados). Nenhum dado de cliente real aparece aqui.

## Sumário

1. [Em 60 segundos](#1-em-60-segundos)
2. [O produto](#2-o-produto)
3. [Arquitetura de produção](#3-arquitetura-de-produção)
4. [O caminho de uma mensagem](#4-o-caminho-de-uma-mensagem)
5. [Mapa do repositório](#5-mapa-do-repositório)
6. [Banco e multi-tenancy](#6-banco-e-multi-tenancy)
7. [Funcionalidades por área](#7-funcionalidades-por-área)
8. [MCP do WhatsAI (e MCPs de operação)](#8-mcp-do-whatsai-e-mcps-de-operação)
9. [Painel (`manager/dist`)](#9-painel-managerdist)
10. [Site](#10-site)
11. [Deploy e operação](#11-deploy-e-operação)
12. [Testes e qualidade](#12-testes-e-qualidade)
13. [Regras para agentes de IA](#13-regras-para-agentes-de-ia)
14. [Capturas de tela](#14-capturas-de-tela)
15. [Recomendações priorizadas](#15-recomendações-priorizadas)
16. [Referências](#16-referências)
17. [Apêndice A — ficha técnica](#apêndice-a--ficha-técnica)
18. [Apêndice B — comandos úteis](#apêndice-b--comandos-úteis)
19. [Apêndice C — glossário](#apêndice-c--glossário)

---

## 1. Em 60 segundos

- O WhatsAI é um **fork do Evolution API 2.3.7** vendido como atendimento com IA no WhatsApp para escritórios
  (com foco em advocacia). Cada número de WhatsApp é uma **instância** com bot, configurações, histórico e
  credenciais próprios.
- A API é **um único serviço no Render** (Ohio, plano Free) que atende todas as instâncias. O banco de controle e,
  opcionalmente, um banco por instância ficam no **Neon**. O cache é um **Render Key Value** (Redis). As chamadas de
  IA vão para a **OpenAI** com a chave de cada instância.
- O **site e o painel** são estáticos e ficam na **Vercel** (`https://whatsaibr.vercel.app`). A API também sabe
  servir o painel em `/manager`, mas o caminho oficial é a Vercel.
- O **manual** não fica mais no painel: ele vive no GitHub e nos recursos MCP `whatsai://docs/*`.
- A API expõe um **servidor MCP próprio** em `POST /mcp` (42 ferramentas, 2 prompts e os recursos de documentação)
  para Claude, ChatGPT e Cursor operarem o WhatsAI com segurança.
- Regra de ouro: **um número = uma instância**. Não há fila durável interna: os eventos do Baileys são
  serializados por uma promise chain e os chatbots têm debounce em memória. O desenho assume **uma réplica**.

```mermaid
flowchart LR
  WA["WhatsApp do cliente"] -->|"Baileys / Cloud API"| API
  subgraph RENDER["Render (Ohio, Free)"]
    API["API WhatsAI<br/>Express + TypeScript"]
    REDIS[("Key Value (Redis)")]
  end
  subgraph NEON["Neon (PostgreSQL)"]
    CTRL[("Banco principal<br/>Instance, ClientAccess...")]
    OWN[("Banco próprio por instância<br/>opcional")]
  end
  API --> REDIS
  API --> CTRL
  API --> OWN
  API -->|"Chat Completions"| OAI["OpenAI"]
  API -->|"DataJud / DJEN"| PROC["Processos"]
  API -->|"OAuth"| GCAL["Google Agenda"]
  subgraph VERCEL["Vercel (Hobby)"]
    SITE["Site, /seguranca, termos"]
    PANEL["Painel SPA /manager"]
    PORTAL["/acesso — portal do cliente"]
  end
  EQUIPE["Equipe do escritório"] --> PANEL
  CLIENTE["Cliente do escritório"] --> PORTAL
  PANEL -->|"HTTPS + apikey"| API
  PORTAL -->|"HTTPS + código wac_"| API
  AGENTE["Claude / ChatGPT / Cursor"] --> MCP["POST /mcp"]
  MCP --- API
```

---

## 2. O produto

### 2.1 O que o escritório contrata

- **Triagem e atendimento no WhatsApp** com IA: o bot responde com o prompt do escritório, mantém contexto,
  entende áudio/imagem/PDF e para quando um humano assume.
- **Painel** para a equipe: instâncias, conversas, contatos da IA, leads, agenda, processos, plano e limites,
  comportamento do bot, OpenAI, webhooks, integrações e observabilidade.
- **Portal do cliente** (`/acesso`): o escritório gera um código `wac_` e libera só os módulos contratados
  (conversas, leads, agenda, processos, plano, conexão).
- **Serviço opcional:** onboarding, prompt, configuração e acompanhamento (o que é automático e o que é serviço
  está auditado na seção 13 do manual).

### 2.2 Planos e preços

Os valores-núcleo (mensalidade, franquia, implantação e excedente) são iguais no site, `llms.txt`,
`agents/whatsai.md`, `readmes/RESUMO.md`, `readmes/README-COMERCIAL.md` e na seção 6 do manual. **Não altere um sem
alterar todos** (o teste de unidade não cobre isso; é conferência manual).

| Plano | Mensalidade | Respostas de IA por mês | Implantação |
|---|---|---|---|
| Essencial | R$ 437 | 2.000 | R$ 1.800 |
| Profissional | R$ 767 | 5.000 | R$ 3.500 |
| Premium (API oficial) | R$ 1.427 | 10.000 | a partir de R$ 6.400 |

- Excedente: **R$ 49 por bloco de 1.000 respostas**.
- Número adicional: **R$ 287 / R$ 497 / R$ 927 por mês**, com implantação de **R$ 590 / R$ 1.080 / a partir de
  R$ 1.800**. Piloto: **R$ 690**. O Premium usa a Cloud API oficial e exige aprovação da Meta.
- O código guarda apenas os presets (`Essencial`/`Profissional`/`Premium`) e o preço do bloco em
  `src/utils/usageLimits.ts`. **Não há cobrança automática** (Stripe/Mercado Pago): o valor é estimado no resumo.
- **Não existe gating por plano**: Agenda, Leads, Processos e portal são ligados por instância/módulo, não pelo
  plano contratado.

### 2.3 Canais e ética

- Canais: **Baileys** (WhatsApp Web, o usado em produção), **Cloud API oficial da Meta** e **Evolution** (legado;
  saiu do diálogo de nova instância, mas o backend ainda suporta).
- Advocacia: perfil `ethicsProfile: "advocacia"` segue o Código de Ética da OAB e o Provimento 205/2021. A IA
  **não fala de gratuidade, preço, honorários ou autoelogio e não promete resultado**. Use "triagem" e
  "organizar os atendimentos", nunca "captação"; nada de nota numérica para pessoas.

---

## 3. Arquitetura de produção

### 3.1 Componentes

| Componente | Onde | Papel | Observação |
|---|---|---|---|
| API | Render, serviço `evolution-api`, `srv-dbd9qqi9lscs73aoe85g` | Express + TypeScript; canais, chatbots, eventos, MCP, painel estático | Plano Free, Ohio; dorme após ~15 min sem tráfego |
| Cache | Render Key Value `evolution-redis` | Cache de sessões/configurações; `allkeys-lru` | Sem persistência |
| Banco de controle | Neon, projeto principal `spring-boat-14626479` | Modelos de controle: `Instance`, `InstanceDatabase`, `ClientAccess`, `GlobalSetting`, `IsOnWhatsapp` | Sempre consultado antes de saber a instância; credenciais e contadores seguem o banco da instância quando há banco próprio |
| Bancos por instância | Neon, um projeto por instância (opcional) | Dados operacionais da instância | Ligado por `DB_PER_INSTANCE_ENABLED=true` |
| OpenAI | API externa | Chat Completions, transcrição, visão e ferramentas de agenda | Chave por instância; com banco compartilhado a API recusa a mesma chave em duas instâncias |
| Site/painel | Vercel, projeto `whatsaibr` | `manager/dist` estático | Deploy pelo workflow `Deploy Manager` |
| MCP | `POST https://<api>/mcp` | Ferramentas e docs para agentes | Auth por `Bearer`/`apikey` ou caminho secreto |
| Processos | DataJud (CNJ) + DJEN por OAB | Movimentações e publicações | Ticker de 5 min, só consulta quando vence |
| Google Agenda | API do Google | Eventos e bloqueio de horários | OAuth opcional por instância |

### 3.2 O que sustenta o desenho

- **Processo único:** caches de limites, registro de ids do bot, mapa de `tokenParam`, guard de contato e caches
  de evento/limites vivem em memória. O código assume **uma réplica** do Render.
- **Neon-friendly:** nada de timer que consulte o banco à toa. Limpeza de contadores e retenção pegam carona na
  primeira resposta da IA do dia; Agenda e Processos usam tickers single-flight que só consultam quando algo
  vence; a Observabilidade tem cache de 60 s; configurações de evento têm cache de 1 h.
- **Sem fila durável:** a ordenação é uma promise chain por instância; o debounce é `setTimeout`. Se o processo
  cair no meio, o evento não é reprocessado.
- **Eventos externos** (fan-out): webhook, WebSocket, RabbitMQ, SQS, NATS, Pusher e Kafka. O webhook de saída tem
  retry com backoff e JWT opcional; os demais têm o retry do próprio cliente.

---

## 4. O caminho de uma mensagem

### 4.1 Sequência

```mermaid
sequenceDiagram
  participant W as WhatsApp
  participant B as Baileys / Meta
  participant API as API
  participant DB as Postgres
  participant AI as OpenAI
  W->>B: mensagem do cliente
  B->>API: messages.upsert (fila serializada por instância)
  API->>DB: grava Message (se DATABASE_SAVE_DATA_NEW_MESSAGE)
  API->>API: webhook MESSAGES_UPSERT + fan-out para os chatbots
  API->>API: trigger do bot, pausa humana, debounce
  API->>API: gate de horário e limites (antes de qualquer chamada à IA)
  alt bloqueado
    API-->>W: silêncio ou aviso (uma vez por dia/contato)
  else liberado
    API->>AI: Chat Completions (+ histórico, mídia, ferramentas da Agenda)
    AI-->>API: resposta
    API->>W: envia (dividida; para se um humano assumir)
    API->>DB: conta a resposta + análise de Leads em background
  end
```

### 4.2 Passo a passo (com o código)

1. **Entrada:** `messages.upsert` do Baileys é serializado em `eventProcessingQueue` dentro de `runWithInstance`
   (o contexto de banco por instância). Cada mensagem do lote tem try/catch próprio; falha de decriptação é
   ignorada. O conteúdo é desembrulhado (view-once, documento com legenda etc.).
2. **Persistência e evento:** grava `Message` (se ligado), faz upload para S3 quando aplicável, emite o webhook
   `MESSAGES_UPSERT` e chama `chatbotController.emit`.
3. **Fan-out:** `claimMessageOnce` reivindica a mensagem uma única vez e distribui para EvolutionBot, Typebot,
   OpenAI, Dify, n8n, EvoAI e Flowise. O bot OpenAI é o único cujas respostas entram nos contadores de plano.
4. **Seleção do bot:** ignora grupos/`ignoreJids`; resolve a sessão pelo JID; escolhe o bot por `triggerType`
   (`all`, `none`, `advanced`, `keyword` com equals/regex/startsWith/endsWith/contains) ou fallback; mescla
   bot > settings; trata pausa humana; aplica debounce por `instanceId:remoteJid`.
5. **Gate:** o `UsageService.checkBeforeAnswer` roda **antes** de qualquer chamada à IA (inclusive transcrição):
   horário (`always`/`inside`/`outside`) → limite por contato/dia → limite diário → franquia mensal. A proteção
   fixa de **100 respostas por contato por dia** existe mesmo sem plano.
6. **IA:** monta a ética da advocacia como primeira mensagem de sistema, o prompt do escritório, mensagens fixas,
   histórico limitado por `historyMessages`, contexto de Processos (só datas) e a mensagem atual com mídia. Com a
   Agenda ligada, adiciona ferramentas (`consultar_horarios`, `meus_agendamentos`, `agendar`, `remarcar`,
   `cancelar`) em um laço de até 3 rodadas.
7. **Envio:** a resposta é dividida por links/mídia e, com `splitMessages`, por quebras duplas; cada parte checa
   `shouldStopSending` para não continuar depois de um humano assumir. Erros nunca vão crus ao cliente: só a
   mensagem `unknownMessage`.
8. **Contagem e Leads:** a resposta só é contada depois de efetivamente sair (`sent > 0`); uma resposta em várias
   partes conta uma vez; avisos de limite/fora do horário não contam. Em seguida, a análise de Leads roda em
   background (não chama a IA quando os limites bloquearam).

### 4.3 Pausa humana e retomada

- `stopBotFromMe=true`: uma mensagem `fromMe` que não é eco do bot **pausa** a sessão, grava
  `parameters.humanLastMessageAt` e, se não havia sessão, cria uma já pausada.
- `humanResumeMinutes` (bot > settings > 0) reabre quando o cliente escreve depois do prazo. Pausa manual
  (`changeStatus paused`) **nunca** é reaberta automaticamente; só `opened`.
- Durante a pausa o bot não responde e a mensagem não entra na sessão/histórico. Atenção: no Baileys a mensagem
  **já foi gravada em `Message`** antes do emit (com `DATABASE_SAVE_DATA_NEW_MESSAGE=true`, que o Render liga).
  O manual já foi corrigido para "sem resposta e fora da sessão/histórico".

### 4.4 Mídia

- Áudio do cliente é transcrito (modelo de transcrição configurado; fallback para o legado).
- Imagem entra como data URL; PDF como arquivo (padrão de 10 MB, configurável de 1 a 32 MB; ≤20 páginas, com
  fallback para descrição); vídeo, figurinha, localização e contato viram texto.
- O bot pode optar por não ler imagens/áudios; campos ausentes herdam do settings.

---

## 5. Mapa do repositório

| Caminho | O que tem |
|---|---|
| `src/api/routes/` | Rotas Express (`index.router.ts` monta tudo), `RouterBroker`, guards |
| `src/api/controllers/` | Camada fina HTTP: instância, usage, agenda, leads, processos, mensagens, chat, grupos etc. |
| `src/api/services/` | Regra de negócio: monitor, canais, usage, retenção, client access, agenda, Google, leads, processos, observabilidade, OpenAI health, alertas, cache |
| `src/api/repository/` | Prisma + roteamento de banco por instância (`instance-db/`) + `dbActivity` |
| `src/api/integrations/channel/` | Baileys, Meta Cloud API, Evolution legado, chamadas de voz |
| `src/api/integrations/chatbot/` | OpenAI (Chat Completions + Agenda AI) e demais chatbots |
| `src/api/integrations/event/` | WebSocket, webhook, RabbitMQ, SQS, NATS, Pusher, Kafka |
| `src/api/integrations/storage/` | S3/MinIO |
| `src/api/integrations/mcp/` | Servidor MCP do WhatsAI (ferramentas, prompts, recursos) |
| `src/utils/` | Pausa humana, mídia OpenAI, limites, client access, ética, processos, xlsx, throttle de auth |
| `prisma/` | Três schemas e as migrations por provider |
| `test/unit/`, `test/integration/` | Suítes `node:test` + `tsx` |
| `manager/dist/` | Bundle compilado do painel + site + assets (sem fonte no repo) |
| `manager/patches/` | Patches determinísticos do painel/site |
| `readmes/` | Resumos comercial/técnico e este guia (viram recursos MCP) |
| `docs/` | Arquitetura de banco por instância, docs espelhados de Render/Neon/Vercel e imagens |
| `scripts/` | Onboarding de cliente e atualização dos docs de fornecedores |
| `prompts/` | Prompts base dos bots |
| `.github/workflows/` | CI, deploy do painel, release e security scan |

---

## 6. Banco e multi-tenancy

### 6.1 Schemas

- `prisma/postgresql-schema.prisma` — produção.
- `prisma/mysql-schema.prisma` — suportado, mas sem suíte de integração própria.
- `prisma/psql_bouncer-schema.prisma` — mesmo conjunto de modelos do PostgreSQL, para conexão via bouncer.

`DATABASE_PROVIDER` escolhe o schema e a pasta de migrations. `db:deploy` apaga `prisma/migrations`, copia a pasta
do provider e roda `prisma migrate deploy`. O container executa isso no start, antes de subir a aplicação; falha de
migration aborta o boot.

### 6.2 Roteamento por instância

```mermaid
flowchart TD
  Q["Consulta Prisma"] --> E{"instanceId/sessionId nos argumentos<br/>ou no contexto AsyncLocalStorage?"}
  E -- "não" --> MAIN[("Banco principal")]
  E -- "sim" --> C{"É modelo de controle?"}
  C -- "sim" --> MAIN
  C -- "não" --> D{"A instância tem banco próprio ready?"}
  D -- "sim" --> OWN[("Banco da instância")]
  D -- "não" --> MAIN
```

- `CONTROL_MODELS` (sempre no banco principal): `instance`, `instanceDatabase`, `isOnWhatsapp`, `clientAccess`,
  `globalSetting`. `SESSION_KEY_MODELS`: `session`, `authStateKey`.
- `Instance` vem sempre do principal; quando a instância tem banco próprio, as relações pedidas em
  `include`/`select`/`_count` são buscadas no banco da instância e mescladas.
- O contexto é aberto pelo `instanceExistsGuard` (rotas de instância), pelo handler de eventos do Baileys e pela
  conexão da instância. Consulta sem `instanceId` e sem contexto cai no principal e gera warning.
- **Isolamento:** no banco compartilhado é lógico (por `instanceId`/`sessionId`); físico só com banco próprio.

### 6.3 “Banco próprio” (Neon por instância)

- Ligado por `DB_PER_INSTANCE_ENABLED=true` + `NEON_API_KEY`; **somente PostgreSQL**.
- Provisiona um projeto Neon por instância, cifra a URL com AES-256-GCM em `InstanceDatabase`, espera as
  operações, roda as migrations até 3 vezes, espelha a linha `Instance` e marca `ready`. Em falha, apaga o projeto
  e a linha criada.
- Cota padrão de **100 projetos** (`NEON_PROJECT_LIMIT`); região padrão `aws-us-east-2`; Postgres 16; teto de
  0,25 CU. `GET /admin/database-quota` mostra a cota (só chave global).
- Remoção apaga os dados da instância, mas **mantém o projeto Neon** por padrão; só apaga com
  `DB_PER_INSTANCE_DELETE_ON_REMOVE=true`.
- O boot carrega os bancos `ready` e aplica migrations **antes** de carregar as instâncias.

### 6.4 Migrations

- Sempre **aditivas**, em `prisma/postgresql-migrations` **e** `prisma/mysql-migrations`, com o modelo nos três
  schemas.
- Exceções históricas existem: há 71 migrations no PostgreSQL e 31 no MySQL; a migration
  `20261103120000_message_key_id_index` é só PostgreSQL porque o MySQL já tem `Message.keyId`.
- Tabela global (procurada antes de saber a instância) entra em `CONTROL_MODELS` em
  `src/api/repository/instance-db/routing.ts`.
- Antes do merge que altera schema, crie um snapshot/branch no Neon.

---

## 7. Funcionalidades por área

### 7.1 Instância e conexão

- `POST /instance/create` valida a integração, gera `instanceId` (UUID v4) e token, grava `Instance`, provisiona o
  Neon próprio (se ligado) **antes** de liberar a instância e só então registra o canal e os eventos.
- **Baileys:** `makeWASocket`; credenciais e chaves Signal ficam em `Session`/`AuthStateKey` no Postgres, com
  Redis/arquivos como camada rápida e write-through. QR/pairing emitem `qrcode.updated` e `connection.update`.
- **Reconexão:** imediata em `connection.close`, exceto `loggedOut`, `forbidden`, 402/406; tratamento especial
  para 401 após `stream:error 515` e reconexão de socket “zumbi” no máximo 1 vez/min. **Não há backoff exponencial
  no Baileys** (ele existe no webhook de saída e nos clientes DataJud/DJEN).
- **Cloud API:** `GET /webhook/meta` valida `hub.verify_token`; `POST /webhook/meta` trata mensagens, statuses e
  ecos de coexistência (como `fromMe`, pausando a IA).
- **Estado esperado em produção:** a instância do cliente precisa ficar `open`. Depois de todo deploy que reinicia
  a API, confira o deploy `live` no Render e o `connectionState` da instância (GET).

### 7.2 Conversas e chat

- O painel mostra conversas e mensagens; sem WebSocket em produção, o `chat-live.py` faz **polling**: lista a cada
  20 s, conversa aberta a cada 8 s, e para após 10 min sem interação para o Neon dormir. Abas ocultas não pollam.
- `Message` guarda o histórico; status e mídia caem por cascade quando a retenção apaga.
- Envio de texto, mídia, áudio e localização usam as rotas `/message/*`; o `splitMessages` divide respostas longas.

### 7.3 Bot OpenAI

- Configuração por instância/bot: credencial, prompt, mensagens fixas, `triggerType`, `expire`, `keywordFinish`,
  `delayMessage`, `stopBotFromMe`, `keepOpen`, `debounceTime`, `ignoreJids`, `historyMessages`, mídia,
  `tokenParam`, `humanResumeMinutes` e `ethicsProfile`.
- `tokenParam` (`auto`/`max_tokens`/`max_completion_tokens`) tem precedência bot > settings > auto, com retry
  para o erro “Unsupported parameter”.
- O modo Assistant legado foi descontinuado pela OpenAI; o caminho é **Chat Completions**.
- A pausa humana e o limite de 100 respostas/contato/dia são as duas proteções mais importantes contra loops e
  custo.
- Saúde das chaves: `GET /openai-health/:instance` mostra situação, modelo e último erro sem entrar na conta do
  cliente; a Observabilidade testa chaves sem sinal há 6 h.

### 7.4 Plano, limites e uso

- `InstanceLimits` é opcional; sem linha, nada é limitado, mas as respostas continuam sendo contadas.
- `UsageCounter` tem PK `(instanceId, type, period, remoteJid)` e tipos mês/dia/contato.
- Ordem: horário → contato/dia → diário → franquia mensal. Ações da franquia: `continue` (conta excedente),
  `pause` (para até virar o mês) e `message` (para e avisa uma vez por dia/contato).
- Contagem: 3 upserts atômicos por resposta; limpeza de contatos >7 dias e dias >90 dias na primeira resposta do
  dia; linhas mensais ficam. Cache de limites por 30 s; falha de banco é **fail-open**.
- **Não há billing automático**; `estimatedBRL` é estimativa.

### 7.5 Agenda

- Desligada por padrão; provedor interno (`Appointment`) com interface para outro provedor.
- A IA agenda por ferramentas, só com a Agenda ligada e ao menos um tipo ativo. Permissões no servidor:
  `allowBook`, `allowReschedule`, `allowCancel`, `requireTeamApproval`, `showOtherEventDetails`;
  `onlyOwnAppointments` é sempre `true`. Máximo de 2 agendamentos futuros por contato.
- O horário é revalidado no servidor em transação que trava `AgendaSettings` (`bookingSeq++`), impedindo reserva
  dupla.
- Tipos por instância em JSON: `active`, `maxPerDay` (1–100), `minNoticeHours` (0–720).
- Lembretes: ticker de 60 s, single-flight, só consulta quando há lembrete devido; `POST /agenda/tick` para cron
  externo; silêncio 21h–8h; resposta “1” confirma e “2” vai para a IA; Cloud API fora da janela de 24 h não envia
  template.
- ICS público por token de 48 caracteres, somente leitura, 30 dias para trás e 180 para frente, sem observações
  internas.
- Google Agenda opcional: OAuth `calendar.events`; refresh token cifrado em `GlobalSetting` (`gcal:<instanceId>`);
  eventos ocupados bloqueiam horários; falha do Google é fail-open.

### 7.6 Leads

- Análise em background depois da resposta do bot, com 3+ mensagens do cliente e (primeira vez, 3 novas mensagens
  ou “novo” após 24 h); lê as últimas 30 mensagens; uma chamada com structured output, timeout de 30 s, sem
  baixar mídia. Não conta como resposta e é pulada quando os limites bloqueiam a IA.
- Prioridade e status são **regras do servidor**, não nota da IA. Campos editados pela equipe ficam em
  `manualFields` e são travados contra a IA.
- Aviso à equipe é opcional e uma vez por lead. Exportação em xlsx/csv. Tabelas `Lead`/`LeadSettings`.

### 7.7 Processos

- DataJud (CNJ) + DJEN por OAB; só itens novos geram aviso; horário de silêncio; ao cliente vai só a frase neutra.
- Ticker de 5 min que só consulta o banco quando vence; `POST /processos/tick` para cron externo.
- Tabelas `Process`, `ProcessMovement`, `OabWatch`, `Publication`, `ProcessSettings`.

### 7.8 Portal do cliente

- Código `wac_` + 32 bytes aleatórios; só o **hash SHA-256** é gravado em `ClientAccess` (banco principal); a
  chave aparece uma única vez.
- Módulos: `conversas`, `leads`, `agenda`, `processos`, `plano`, `conexao`; padrão
  `conversas + leads + conexao`.
- A autorização é **server-side em cada requisição** (`clientRouteAllowed`); esconder menus em
  `client-portal.js` é só conforto.
- `GET /instance/fetchInstances` com `wac_` devolve só a instância do código, sem o token da instância nem
  segredos (o campo `token` é o próprio código do cliente).
- Cache de 30 s; `lastUsedAt` no máximo a cada 10 min; novo código invalida o anterior.
- O cliente usa o mesmo painel em `/acesso` (PWA), com polling e checagem de versão a cada 5 min.

### 7.9 Observabilidade e alertas

- `GET /observability` (chave global) com cache de 60 s (`?refresh=1`/`?force=1`): cartões Sistema, WhatsApp,
  Plano e uso, OpenAI, Neon, Render, Vercel e GitHub.
- O cartão **Sistema**, o **Plano e uso** e a **saúde OpenAI** leem o Postgres (contagens, credenciais e bots); o
  **WhatsApp** lê o estado em memória; **Neon, Render, Vercel e GitHub** consultam APIs externas.
- Saúde OpenAI em memória por credencial; teste ativo no máximo a cada 30 s por chave; a Observabilidade testa
  sozinha chaves sem sinal há 6 h. Não há saldo em dólares.
- Avisos ao administrador por WhatsApp (`ADMIN_ALERT_NUMBERS` + `ADMIN_ALERT_INSTANCE`): OpenAI sem crédito,
  instância desconectada >10 min e retorno; repetição no máximo a cada 6 h; timer de 60 s só em memória.
- `GET /admin/db-activity` e a ferramenta MCP `get_database_info` mostram o que acordou o banco (só verbo/tabela,
  sem valores) e não gravam nada.

### 7.10 Retenção (LGPD)

- `GlobalSetting` `retention` no banco principal prevalece sobre `MESSAGE_RETENTION_DAYS`; `0` desliga; mínimo 7,
  máximo 3.650 dias.
- Executa na primeira resposta da IA de cada dia, em lotes de 1.000, no máximo 20 lotes/dia por instância. O
  “Apagar agora” faz até 200 lotes por instância.
- Apaga só `Message` (status e mídia por cascade): **não** apaga WhatsApp, contatos, leads, agenda, processos ou
  contadores.
- Ligar a retenção é ação destrutiva: exige OK explícito do dono e backup.

### 7.11 Chaves e credenciais

- A página “Chaves e credenciais” mostra chaves mascaradas e revela uma por vez após confirmar a chave global
  (limite de 5/min; 5 falhas/15 min bloqueiam).
- Com **banco compartilhado**, a mesma chave OpenAI não pode ser cadastrada em duas instâncias; com **banco
  próprio**, cada instância tem sua própria tabela e a chave pode ser reutilizada. Recomende uma project key por
  instância com limite de gasto de qualquer forma.

---

## 8. MCP do WhatsAI (e MCPs de operação)

### 8.1 O servidor embutido

O WhatsAI tem um **servidor MCP próprio**, não um cliente: `src/api/integrations/mcp/`, montado em `POST /mcp`.

- **Transporte:** Streamable HTTP, stateless, resposta JSON (sem SSE/sessão). `GET`/`DELETE` em `/mcp` → 405.
- **Auth:** `Authorization: Bearer <chave>` ou `apikey: <chave>`.
  - Chave global (`AUTHENTICATION_API_KEY`): vê todas as instâncias.
  - Token de instância: vê só aquela instância.
  - **Modo URL:** `POST /mcp/<MCP_PATH_TOKEN>` sem header, só se `MCP_PATH_TOKEN` tiver 32+ caracteres.
  - Falhas: 10 em 15 min por IP bloqueiam por até 15 min.
- **Ferramentas:** 42, agrupadas em agenda (7), bot (5), chat (5), credenciais (1), banco (1), instância (4),
  leads (9), saúde OpenAI (1), processos (7) e uso (2). As anotações MCP distinguem leitura de escrita
  destrutiva (`destructiveHint: true`).
- **Prompts:** `resumo_do_dia` e `revisar_atendimento`.
- **Recursos:** `whatsai://docs/<nome>` — `README-WHATSAI.md` e os arquivos de `readmes/` (incluindo este guia).
  Teto de 512 KB por documento.
- **O que não existe de propósito:** apagar/desconectar instância, reiniciar, apagar mensagens, SQL livre,
  variáveis de ambiente e criar/ver chaves de API.

Conectar no Claude Code:

```bash
claude mcp add --transport http whatsai https://<url-da-api>/mcp --header "apikey: SUA_CHAVE"
```

No ChatGPT (modo desenvolvedor/conector) e em clientes sem header, use o modo URL com um `MCP_PATH_TOKEN` longo,
configurado só no Render — nunca no `render.yaml` ou Git.

### 8.2 MCPs dos provedores (operação)

Para operar a infraestrutura, os MCPs oficiais dos fornecedores são a melhor porta:

| Provedor | MCP | Auth | Como conectar no Claude Code |
|---|---|---|---|
| Render | `https://mcp.render.com/mcp` | OAuth (plugin oficial) ou API key | `/plugin install render@claude-plugins-official` + `/reload-plugins`, depois `/mcp` |
| Neon | `https://mcp.neon.tech/mcp` | OAuth ou API key | `claude mcp add --transport http neon https://mcp.neon.tech/mcp` + `/mcp` |
| Vercel | `https://mcp.vercel.com` | OAuth | `claude mcp add --transport http vercel https://mcp.vercel.com` + `/mcp` |

- No Claude Code, o Render não aceita registro dinâmico de cliente OAuth; por isso o plugin oficial (que já traz o
  client id) é o caminho sem API key.
- Neon aceita `?readonly=true`, `?projectId=<id>`, `?category=...` e `?roleName=...` na URL do MCP.
- O Vercel MCP é OAuth; para CLI/REST use um token com escopo de time/projeto.
- CLIs úteis: `render` (serviços, deploys, logs), `neon`/`neonctl` (projetos, branches, SQL) e `vercel`
  (deploy, list, inspect, logs).

---

## 9. Painel (`manager/dist`)

### 9.1 Como ele é feito

- **Não há código-fonte do painel no repositório.** O que existe é o bundle compilado do Evolution Manager
  (`manager/dist/assets/index-b29a5d7a.js`) já customizado. O submódulo `evolution-manager-v2` está vazio.
- Toda mudança é um **patch determinístico** em `manager/patches/*.py` (38 patches Python) ou nos scripts
  `landing-css.mjs`, `pwa-icons.mjs` e `render-style-observability.js`.
- Cada patch troca strings exatas (a âncora precisa aparecer **uma vez**), confere SHA-256 de trechos grandes
  quando necessário, grava um marcador `/*whatsai-patch:<patch>:<grupo>*/` e é idempotente (se o marcador existe,
  pula). `--check` não altera nada e falha se faltar marcador/CSS/versão.
- `CACHE_VERSION` sobe o `?v=` do bundle no `index.html` e **só aumenta**. Hoje o bundle está em `?v=48`.
- O layout é um só: `app-shell.py` (sidebar estilo shadcn) e `instance-shell.py` + `instance-shell.css` para as
  páginas da instância. Ao mexer no layout `un`, na barra `zM` ou no menu `j5`, rode o patch de novo e confira
  390/768/1024/1440 px, claro e escuro.

### 9.2 Páginas

| Rota | Página |
|---|---|
| `/manager/` | Instâncias |
| `/manager/observability` | Observabilidade |
| `/manager/chaves` | Chaves e credenciais |
| `/manager/retencao` | Retenção (LGPD) |
| `/manager/login` | Entrada |
| `/manager/instance/:instanceId/dashboard` | Visão Geral |
| `.../chat` e `.../chat/:remoteJid` | Conversas |
| `.../contatos-ia` | Contatos da IA |
| `.../leads` | Leads |
| `.../agenda` | Agenda |
| `.../processos` | Processos |
| `.../usage` | Plano e limites |
| `.../settings` | Comportamento/Configurações |
| `.../openai` e `.../openai/:botId` | OpenAI |
| `.../webhook`, `.../websocket`, `.../rabbitmq`, `.../sqs` | Integrações de eventos |
| `.../chatwoot`, `.../typebot`, `.../dify`, `.../n8n`, `.../evoai`, `.../evolutionBot`, `.../flowise` | Integrações |
| `.../proxy` | Proxy |
| `.../observability` | Observabilidade da instância |
| `.../conexao` | Conexão (cliente) |
| `.../acesso-cliente` | Acesso do cliente (administrador) |
| `/manager/embed-chat` | Chat embutido |

### 9.3 Comandos obrigatórios após mudar o painel

```bash
# favicon-wa.py exige fontTools e brotli (pip install fonttools brotli)
for f in manager/patches/*.py; do python3 -I "$f" --check; done
npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
```

Se mudar CSS/JS próprio, suba o `?v=` correspondente no `index.html`. Se mudar um `<script>` inline em qualquer
HTML de `manager/dist`, atualize o hash SHA-256 em `manager/dist/vercel.json` (o teste
`test/unit/security.test.ts` aponta o hash certo).

---

## 10. Site

- O site é estático em `manager/dist/landing/` e é servido em `/` pela Vercel. Páginas: `/`, `/seguranca`,
  `/privacidade`, `/termos`, além de `/acesso` (portal), `/observability` e os arquivos para agentes
  (`llms.txt`, `agents/whatsai.md`, `ard.json`, `security.txt`).
- Os valores-núcleo do site precisam ser iguais aos de `llms.txt`, `agents/whatsai.md`, `readmes/RESUMO.md`,
  `readmes/README-COMERCIAL.md` e à seção 6 do manual.
- **Segurança:** em `/seguranca` só entra o que está implementado e pode ser conferido. Nunca exiba selos que o
  WhatsAI não tem (SOC 2, ISO 27001 etc.). A licença do Evolution API (condição 1b) exige o aviso de uso no
  rodapé do manual e no README — não remova.
- **CSP:** `manager/dist/vercel.json` tem três hashes SHA-256 de scripts inline (painel, `/acesso` e
  `/observability`). `style-src` permite inline; scripts, não. O teste de segurança recalcula os hashes.
- **CSS do site:** edite as fontes e rode `node manager/patches/landing-css.mjs`; o `--check` falha se o bundle
  estiver velho.
- **Meta:** Lighthouse 100 nas quatro notas e “Navegação agêntica” 4/4 em `/` e `/seguranca`, celular e computador.

---

## 11. Deploy e operação

### 11.1 Render (API e Redis)

- Blueprint `render.yaml`: web service `evolution-api` (Docker, Free, Ohio, health check `/`, auto deploy a cada
  commit) e Key Value `evolution-redis` (Free, `allkeys-lru`). Sem disco, sem autoscaling, sem previews.
- O `Dockerfile` instala dependências, gera o Prisma Client, roda o build e, no `ENTRYPOINT`, executa
  `Docker/scripts/deploy_database.sh` (migrations) antes de `npm run start:prod`.
- O plano Free dorme após ~15 min sem tráfego; um job no cron-job.org faz `GET /` a cada 5 min. A primeira
  chamada após dormir pode levar ~50 s.
- **Mudanças em `src/`, `prisma/`, `Dockerfile` ou `render.yaml` reiniciam a API (~4 min).** Em horário comercial
  (9h–19h, Brasília), só faça o merge com OK do dono; fora disso, pode.
- Mudanças só estáticas (`manager/dist`, docs, `scripts/`) terminam o título do squash com `[skip render]`.

### 11.2 Vercel (site e painel)

- O `vercel.json` da raiz desliga o deploy automático da integração Git. Quem publica é o workflow
  `Deploy Manager`, em push no `main` que altere `manager/dist/**`, rodando
  `npx vercel@65.2.0 deploy --prod --yes --archive=tgz` dentro de `manager/dist`.
- O projeto publica o conteúdo de `manager/dist`: site, painel, `/acesso`, `/observability`, páginas legais,
  assets e arquivos de descoberta.
- `[skip render]` **não** pula a Vercel; se `manager/dist/**` mudou, o painel é publicado.
- Plano Hobby é para uso não comercial; o manual já registra a intenção de migrar quando houver cliente pagante.

### 11.3 Neon (banco)

- Projeto principal `spring-boat-14626479` (controle) + um projeto por instância com “Banco próprio”.
- Cota Free: 100 projetos, 100 CU-h por projeto, 1 GB de storage, 5 GB de egress e 10 branches.
- **Não acorde o banco:** nada de timer que consulte o banco; caches em memória; limpeza e retenção pegam carona
  na primeira resposta da IA do dia.
- Backup: snapshots do Neon + `pg_dump` mensal do principal e de cada projeto de instância.
- Ação destrutiva (apagar projeto/branch, apagar dados, ligar retenção) exige OK explícito.

### 11.4 Variáveis de ambiente (nomes; nunca valores)

| Grupo | Nomes | Sensível? |
|---|---|---|
| App | `SERVER_PORT`, `SERVER_URL`, `DATABASE_PROVIDER`, `LANGUAGE`, `LOG_LEVEL`, `LOG_BAILEYS`, `DEL_INSTANCE` | Não |
| Banco | `DATABASE_CONNECTION_URI`, `DATABASE_CONNECTION_CLIENT_NAME`, `DATABASE_SAVE_*`, `DATABASE_BOUNCER_CONNECTION_URI` | URI é segredo |
| Cache | `CACHE_REDIS_ENABLED`, `CACHE_REDIS_URI`, `CACHE_REDIS_PREFIX_KEY`, `CACHE_REDIS_SAVE_INSTANCES`, `CACHE_LOCAL_ENABLED` | URI é segredo |
| Auth | `AUTHENTICATION_API_KEY`, `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES` | Chave é segredo |
| MCP | `MCP_PATH_TOKEN` | Segredo (32+ chars) |
| Banco por instância | `DB_PER_INSTANCE_ENABLED`, `DB_PER_INSTANCE_SECRET`, `DB_PER_INSTANCE_DELETE_ON_REMOVE`, `DB_PER_INSTANCE_MIGRATE_ON_BOOT`, `DB_PER_INSTANCE_CONNECTION_LIMIT` | Secret é segredo |
| Neon | `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_ORG_ID`, `NEON_REGION_ID`, `NEON_PG_VERSION`, `NEON_MAX_CU`, `NEON_PROJECT_LIMIT` | API key é segredo |
| Render | `RENDER_API_KEY`, `RENDER_OWNER_ID`, `RENDER_SERVICE_IDS` | API key é segredo |
| Vercel | `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` | Token é segredo |
| GitHub | `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` | Token é segredo |
| OpenAI | `OPENAI_ENABLED`, `OPENAI_API_KEY_GLOBAL` | Chave é segredo |
| Alertas | `ADMIN_ALERT_NUMBERS`, `ADMIN_ALERT_INSTANCE` | PII/segredo |
| Retenção | `MESSAGE_RETENTION_DAYS` | Não (mas ligar apaga dados) |

No `render.yaml`, os segredos usam `sync: false` e são preenchidos no painel do Render. Nunca imprima, commite ou
publique valores. Se um token vazar, rotacione no provedor e no Render.

### 11.5 Fluxo de branch, PR e deploy

1. Uma branch por tarefa a partir de `origin/main`.
2. PR no formato de `.github/pull_request_template.md`.
3. CI verde (`Check Code Quality`).
4. Squash merge com `commit_message` explícita (Conventional Commits, cabeçalho ≤100 chars).
5. Push com `NODE_OPTIONS=--max-old-space-size=6144 git push -u origin <branch>` (o hook roda eslint + tsc).
6. `[skip render]` no título do squash quando a mudança é só estática.
7. Depois de deploy que reinicia a API, confira o deploy `live` no Render e o estado da instância (`open`).

### 11.6 Conferências somente-leitura (produção)

Contra produção, só **GET**. Nunca chame `POST /v1/services/{id}/deploys` nem rode `scripts/novo-cliente.sh`
para “conferir”.

```bash
# Render: último deploy e serviço
curl -sS -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/<service-id>/deploys?limit=1"
curl -sS -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/<service-id>"

# WhatsApp: estado da instância
curl -sS -H "apikey: $AUTHENTICATION_API_KEY" \
  "https://evolution-api-x93o.onrender.com/instance/connectionState/<instancia>"

# Neon: projeto, branches e endpoints
curl -sS -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/<project-id>"
curl -sS -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/<project-id>/branches"

# Vercel: último deploy do projeto
curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=<project-id>&teamId=<team-id>&limit=1"
```

### 11.7 Rollback e troubleshooting

- **Rollback:** reverta o merge e deixe o Render redeployar. Colunas extras permanecem no banco e são ignoradas
  pelo código antigo.
- **Instância desconectada:** confira `connectionState` (GET), logs do Render e se houve deploy recente. Nunca
  deslogue/pareie de novo um WhatsApp de produção.
- **IA não responde:** confira `GET /openai-health/:instancia`, limites/horário, pausa humana da sessão e se o bot
  está `enabled`. Erros da OpenAI viram `unknownMessage`, não vão crus ao cliente.
- **Banco acordando demais:** `GET /admin/db-activity?limit=50` mostra o que consultou o principal (só verbo/tabela,
  sem valores). Não crie timer para “monitorar”.
- **Painel estranho após deploy:** confira o `?v=` do bundle, o `CACHE_VERSION` e os hashes da CSP.

---

## 12. Testes e qualidade

### 12.1 Comandos

```bash
# Unitários (node:test + tsx)
npx tsx --test "test/unit/**/*.test.ts"
npm run test:unit

# Tipos e lint
npm run test:types
npx tsc --noEmit -p .
npx eslint src test --ext .ts

# Integração (Postgres local descartável)
export TEST_PG_DIR=/tmp/evo-pg TEST_PG_PORT=55471
export TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55471/evolution_test?schema=public'
npm run test:db:start && npm run test:integration

# Tudo (unit + integration)
npm run test:run
```

### 12.2 O que as suítes cobrem

- **41 arquivos unitários** e **18 de integração**; o runner reporta **584 testes unitários em 132 suítes** (todos
  passam) e o código tem ~708 chamadas `test(` (610 unit + 98 integração). Cobrem OpenAI (tokenParam, ética,
  erros, imagens, envio, presença), pausa humana, Cloud API, Baileys (dedupe, edições, placeholder, getMessage,
  chamadas), usage, retenção/alertas, observabilidade, segurança/CSP, MCP, banco por instância, client access,
  leads, agenda e processos.
- Integração sobe os serviços reais contra um PostgreSQL descartável, com canal WhatsApp e OpenAI falsos; sem
  `TEST_DATABASE_URL` as suítes são puladas. `test/helpers/setup.ts` substitui `@api/server.module` por um Proxy
  e impede rede; para trocar um serviço, use `serverModuleOverrides`.
- **Lacunas conhecidas:** não há teste de conexão Baileys real/pareamento (manual), não há integração MySQL e o
  `npm test` (watch) cobre só um subconjunto de `test/all.test.ts`.
- **CI:** `Check Code Quality` roda lint, build, `test:types` e `test:run` com Postgres 16; `Security` roda
  Gitleaks + `npm audit` (não bloqueia); `Deploy Manager` publica o painel; `Release` cria releases por tag.

### 12.3 O que rodar antes de cada push

```bash
DATABASE_PROVIDER=postgresql npm run db:generate   # se mudou schema
npx tsx --test "test/unit/**/*.test.ts"
npm run test:types && npx tsc --noEmit -p . && npx eslint src test --ext .ts
# integração com o Postgres descartável (acima)
```

O hook de pre-push roda `npm run build` e `npm run lint:check`; o pre-commit roda `lint-staged`; o commit-msg roda
commitlint.

---

## 13. Regras para agentes de IA

Estas regras vêm do `CLAUDE.md` e valem para qualquer agente que trabalhe neste repositório.

### 13.1 Múltiplos agentes (preferência do dono)

- Para frentes **independentes**, dispare **vários subagentes ao mesmo tempo** (até ~20, menos quando não fizer
  sentido), cada um com escopo, arquivos e critério de entrega explícitos.
- Exemplos de frentes paralelizáveis: arquitetura, MCP/docs, deploy/ops, painel/site, capturas, testes, revisão.
- O thread principal revisa, consolida e fica com o que é **dependente ou sensível**: deploy, produção, WhatsApp
  do cliente e qualquer ação destrutiva.
- Registre as decisões e mudanças no PR, em PT-BR, com recomendações.

### 13.2 Nunca

- Imprimir, commitar ou publicar credenciais (chave global, chaves Neon/Render/OpenAI, tokens). Rotacione a chave
  global se houver suspeita.
- Deslogar ou parear de novo um WhatsApp em produção; atualizar o Baileys sem número de teste.
- Ação destrutiva sem OK explícito: apagar projeto/branch no Neon, apagar dados, ligar `MESSAGE_RETENTION_DAYS`.
- Requisição que altere produção a partir de teste/Playwright (contra produção, só GET).
- Dados reais de clientes em imagens, PRs, commits, artefatos ou arquivos publicados.
- Identificador de modelo de IA em commits, PRs ou código.
- Commitar o `.gitignore` local (um plugin do ambiente o altera; é sempre ` M .gitignore` e fica fora).
- Mandar `reasoning_effort` à OpenAI.

### 13.3 Antes de mexer

1. Leia `CLAUDE.md` (regras) e a seção relevante de `README-WHATSAI.md` (produto/runbook).
2. Identifique a frente e o banco: `src/`/`prisma/` reinicia a API; `manager/dist` publica na Vercel; docs/scripts
   são estáticos (`[skip render]`).
3. Se for mudar banco, planeje migration aditiva nos dois providers e nos três schemas; crie snapshot no Neon.
4. Se for mudar o painel, rode os `--check` dos patches e o esbuild; se mudar HTML inline, atualize a CSP.
5. Rode os testes e o lint antes do push; abra o PR no template; faça squash com mensagem explícita.

### 13.4 Onde olhar primeiro

| Dúvida | Onde |
|---|---|
| Regra de trabalho/produção | `CLAUDE.md` |
| Produto, planos, runbooks, decisões | `README-WHATSAI.md` |
| Como o código funciona | este guia + `src/api/` |
| Banco por instância | `docs/arquitetura/banco-por-instancia.md` |
| Painel/site | `manager/patches/` e `manager/dist/vercel.json` |
| MCP | `src/api/integrations/mcp/` e seção 14 do manual |
| Fornecedores (planos/limites/API) | `docs/vendors/<vendor>/llms*.txt` |
| Testes | `test/unit/`, `test/integration/`, `test/helpers/` |

---

## 14. Capturas de tela

> Todas as capturas usam **API simulada e dados fictícios** (“Escritório Exemplo Advogados”, contatos e conversas
> inventados). Nenhum dado de cliente real. As imagens ficam em `docs/images/projeto/`; ao ler este guia como
> recurso MCP (`whatsai://docs/GUIA-DO-PROJETO`), o texto é entregue sem as imagens — abra o arquivo no GitHub
> para vê-las.

### 14.1 Site

![Página inicial — tema claro, 1440 px](../docs/images/projeto/site-home-light-1440.png)

![Página inicial — tema escuro, 1440 px](../docs/images/projeto/site-home-dark-1440.png)

![Página inicial — celular, 390 px](../docs/images/projeto/site-home-light-390.png)

![Página /seguranca — tema claro, 1440 px](../docs/images/projeto/site-seguranca-light-1440.png)

![Página /seguranca — tema escuro, 1440 px](../docs/images/projeto/site-seguranca-dark-1440.png)

![Página /seguranca — celular, 390 px](../docs/images/projeto/site-seguranca-light-390.png)

![Página /privacidade — 1440 px](../docs/images/projeto/site-privacidade-light-1440.png)

![Página /termos — 1440 px](../docs/images/projeto/site-termos-light-1440.png)

![Portal do cliente (/acesso) — 1440 px](../docs/images/projeto/site-acesso-light-1440.png)

![Portal do cliente (/acesso) — celular, 390 px](../docs/images/projeto/site-acesso-light-390.png)

### 14.2 Painel

![Login do painel](../docs/images/projeto/painel-login-light-1440.png)

![Lista de instâncias](../docs/images/projeto/painel-instancias-light-1440.png)

![Visão geral da instância](../docs/images/projeto/painel-dashboard-light-1440.png)

![Conversas](../docs/images/projeto/painel-conversas-light-1440.png)

![Conversa aberta](../docs/images/projeto/painel-conversa-light-1440.png)

![Contatos da IA](../docs/images/projeto/painel-contatos-ia-light-1440.png)

![Leads](../docs/images/projeto/painel-leads-light-1440.png)

![Agenda](../docs/images/projeto/painel-agenda-light-1440.png)

![Processos](../docs/images/projeto/painel-processos-light-1440.png)

![Plano e limites](../docs/images/projeto/painel-plano-limites-light-1440.png)

![OpenAI](../docs/images/projeto/painel-openai-light-1440.png)

![Comportamento/Configurações](../docs/images/projeto/painel-configuracoes-light-1440.png)

![Observabilidade](../docs/images/projeto/painel-observabilidade-light-1440.png)

![Chaves e credenciais](../docs/images/projeto/painel-chaves-light-1440.png)

![Retenção (LGPD)](../docs/images/projeto/painel-retencao-light-1440.png)

![Acesso do cliente](../docs/images/projeto/painel-acesso-cliente-light-1440.png)

![Conexão](../docs/images/projeto/painel-conexao-light-1440.png)

### 14.3 Celular e tema escuro

![Instâncias no celular — 390 px](../docs/images/projeto/painel-instancias-light-390.png)

![Conversas no celular — 390 px](../docs/images/projeto/painel-conversas-light-390.png)

![Agenda no celular — 390 px](../docs/images/projeto/painel-agenda-light-390.png)

![Visão geral — tema escuro](../docs/images/projeto/painel-dashboard-dark-1440.png)

![Conversas — tema escuro](../docs/images/projeto/painel-conversas-dark-1440.png)

---

## 15. Recomendações priorizadas

> Junto com este guia foram corrigidos os desvios de documentação que mais afetavam agentes: o local do Manual (`/readme`),
> `?v=36` → `?v=48`, `agenda.css?v=2` → v3, o `RESUMO.md` apontando `/readme`, o `AGENTS.md` dizendo que não havia
> suíte, a pausa humana “sem gravar nada”, a Observabilidade “só APIs externas” e os avisos “sem WhatsApp”.
> O que segue é o que ainda vale fazer.

### P1 — evitar regressões

1. **Versionar o harness de capturas:** o mock de API + Playwright usado para gerar as imagens deste guia deveria
   virar `scripts/docs-screenshots/` (fixtures fictícias), permitindo regenerar as capturas e rodar um teste
   visual. Hoje ele é descartável.
2. **Consolidar a ordem dos patches:** não há script “apply all”. Criar um manifesto/`apply-all.sh` e rodar
   `--check` de todos no CI para impedir patch esquecido.
3. **Ampliar o `npm test`:** ele cobre um subconjunto; apontar para todos os arquivos (ou remover o watch
   enganoso) e incluir `security.test.ts`, `instance-db.test.ts`, `client-access.test.ts`,
   `retention-alerts.test.ts` e `openai-health.test.ts`.
4. **Integração MySQL:** o projeto suporta MySQL e mantém migrations separadas, mas a suíte de integração só roda
   PostgreSQL. Adicionar pelo menos um job com MySQL.
5. **Gerar a tabela de ferramentas MCP a partir do código** (ou validar no CI), para não divergir do manual.
6. **Documentar as variáveis manuais do Render:** `DB_PER_INSTANCE_*`, `MESSAGE_RETENTION_DAYS`,
   `ADMIN_ALERT_*`, `MCP_PATH_TOKEN` e `TRUSTED_CLIENT_IP_HEADER` não estão no `render.yaml` de propósito
   (segredo ou decisão humana). Deixar explícito o que é Blueprint e o que é painel.
7. **Link checker e guarda do Manual:** um check de links internos e um grep no CI que falhe se o bundle voltar a
   conter `/readme` ou “Manual”.
8. **Paridade de schemas e migrations no CI:** confirmar os 51 modelos idênticos nos três schemas e sinalizar a
   diferença 71 (PostgreSQL) × 31 (MySQL) migrations.

### P2 — melhorias

9. **Metadados:** `Dockerfile` tem `LABEL version="2.3.1"` e o `package.json` está em 2.3.7; o comentário de
   retenção em `server.module.ts` diz mínimo 30 e o código usa 7. Corrigir junto de outra mudança de código.
10. **Métrica histórica do manual:** o “testes (71)” da auditoria merece rótulo de histórico para não confundir
    verificadores automáticos.
11. **Atualizar o pin do Vercel** no workflow (`vercel@65.2.0` → versão atual) e revisar o plano Hobby
    (não comercial) quando houver cliente pagante.
12. **Documentar `OPENAI_API_KEY_GLOBAL`** (existe no código e em `env.example`, mas não no `render.yaml` nem no
    `.env.example` da raiz).
13. **Consistência de preços:** os valores-núcleo batem nos seis locais; `llms.txt` e `agents/whatsai.md` são
    resumos e omitem a implantação do número adicional, o piloto e a aprovação da Meta. Declarar isso
    explicitamente ou completar.
14. **Supply chain:** o Gitleaks roda com `--no-git` (não varre o histórico) e o `npm audit` é
    `continue-on-error`; avaliar tornar o audit bloqueante para vulnerabilidades altas.
15. **Registrar a regra de múltiplos agentes na seção 8 do manual** (o link para este guia já está no topo e no
    `CLAUDE.md`).

---

## 16. Referências

- Regras de trabalho: [`CLAUDE.md`](../CLAUDE.md)
- Manual do produto: [`README-WHATSAI.md`](../README-WHATSAI.md) — arquitetura (§1), segredos (§2), deploy (§3),
  painel/site (§4), onboarding (§5), planos (§6), LGPD/segurança (§7), manutenção (§8), troubleshooting (§9),
  observabilidade (§10), decisões (§11), bot OpenAI (§12), auditoria (§13), MCP (§14), limites (§15), leads (§16),
  Processos (§17), Agenda (§18) e Acesso do cliente (§19).
- Banco por instância: [`docs/arquitetura/banco-por-instancia.md`](../docs/arquitetura/banco-por-instancia.md)
- Docs espelhados: `docs/vendors/render/llms-full.txt`, `docs/vendors/neon/llms-full.txt`,
  `docs/vendors/vercel/llms-full.txt` (atualize com `bash scripts/update-vendor-docs.sh`)
- MCP: `src/api/integrations/mcp/` e `whatsai://docs/<nome>`
- Testes: `test/unit/`, `test/integration/`, `test/helpers/`
- Painel: `manager/patches/`, `manager/dist/vercel.json`, `test/unit/security.test.ts`
- CI: `.github/workflows/check_code_quality.yml`, `.github/workflows/deploy-manager.yml`,
  `.github/workflows/security-scan.yml`

---

## Apêndice A — ficha técnica

| Item | Valor |
|---|---|
| Versão do pacote | 2.3.7 |
| API em produção | `https://evolution-api-x93o.onrender.com` |
| Site/painel | `https://whatsaibr.vercel.app` |
| Serviço Render | `evolution-api` (`srv-dbd9qqi9lscs73aoe85g`), Free, Ohio |
| Redis | `evolution-redis`, Free, Ohio, `allkeys-lru` |
| Projeto Neon principal | `spring-boat-14626479` |
| Projeto Vercel | `whatsaibr` (Hobby) |
| Bundle do painel | `assets/index-b29a5d7a.js`, `?v=48` |
| Patches do painel | 38 Python + `landing-css.mjs` + `pwa-icons.mjs` + `render-style-observability.js` |
| MCP do projeto | `POST /mcp`, 42 ferramentas, 2 prompts, recursos `whatsai://docs/*` |
| Modelos Prisma | 51 por schema; os centrais são `Instance`, `Session`, `AuthStateKey`, `Chat`, `Contact`, `Message`, `Setting`, `OpenaiCreds`, `OpenaiBot`, `IntegrationSession`, `OpenaiSetting`, `InstanceLimits`, `UsageCounter`, `Process`, `ProcessMovement`, `OabWatch`, `Publication`, `ProcessSettings`, `Lead`, `LeadSettings`, `AgendaSettings`, `Appointment`, `InstanceDatabase`, `ClientAccess`, `GlobalSetting` |
| Migrations | 71 PostgreSQL, 31 MySQL |
| Testes | 41 arquivos unitários, 18 de integração; 584 testes unitários em 132 suítes (~708 chamadas `test(`) |
| CI | Check Code Quality, Deploy Manager, Release, Security |

## Apêndice B — comandos úteis

```bash
# Desenvolvimento
npm run dev:server
npm run build && npm run start:prod

# Banco
DATABASE_PROVIDER=postgresql npm run db:generate
DATABASE_PROVIDER=postgresql npm run db:deploy
DATABASE_PROVIDER=postgresql npm run db:migrate:dev

# Testes
npx tsx --test "test/unit/**/*.test.ts"
npm run test:types && npx tsc --noEmit -p . && npx eslint src test --ext .ts

# Painel
for f in manager/patches/*.py; do python3 -I "$f" --check; done
npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
node manager/patches/landing-css.mjs --check

# Push (hook roda eslint + tsc)
NODE_OPTIONS=--max-old-space-size=6144 git push -u origin <branch>
```

## Apêndice C — glossário

| Termo | Significado |
|---|---|
| Instância | Um número de WhatsApp com bot, configurações e dados próprios |
| Banco próprio | Projeto Neon dedicado a uma instância (opcional) |
| Banco de controle | Banco principal do Neon, com `Instance`, `ClientAccess`, `GlobalSetting` etc. |
| `wac_` | Código de acesso do portal do cliente (só o hash é gravado) |
| Pausa humana | Bot para de responder quando um humano assume; `humanResumeMinutes` define a volta |
| `tokenParam` | Qual parâmetro de limite de tokens usar na chamada à OpenAI |
| `ethicsProfile` | Perfil de ética da advocacia aplicado ao prompt |
| ICS | Calendário público somente leitura da Agenda |
| `[skip render]` | Marca no squash que evita o deploy/reinício da API no Render |
| MCP | Model Context Protocol: ferramentas/recursos para agentes de IA |
| `whatsai://docs` | Esquema dos recursos de documentação do MCP do WhatsAI |
