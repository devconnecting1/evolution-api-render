# CLAUDE.md

This file provides comprehensive guidance to Claude AI when working with the Evolution API codebase.

## WhatsAI: regras de trabalho (leia antes de qualquer tarefa)

Este repositório é o **WhatsAI**, um fork do Evolution API vendido como atendimento com IA no WhatsApp. O manual completo
(fonte de verdade de arquitetura, planos, decisões e runbooks) é `README-WHATSAI.md`. Desde 11/11/2026 o Manual fica só
no GitHub (e nos recursos MCP `whatsai://docs`): o painel não tem mais Manual; `/readme` e `/readmes/*` redirecionam
(308) para `/manager/`. As seções abaixo são as regras fixas.

### Produção
- API no Render (`srv-dbd9qqi9lscs73aoe85g`, `https://evolution-api-x93o.onrender.com`), painel e site na
  Vercel (`https://whatsaibr.vercel.app`), banco no Neon (projeto principal `spring-boat-14626479`, mais um projeto por
  instância com "Banco próprio"). Push no `main` publica nos dois sozinho.
- Há cliente real em produção (escritório de advocacia, WhatsApp Web/Baileys). O WhatsApp dele precisa ficar `open`:
  depois de todo deploy que reinicia a API, confira o deploy `live` no Render e o estado da instância.

### Comunicação
- Sempre em **português (PT-BR)**, linguagem simples, com recomendações. O dono do projeto dá autonomia
  ("faça da melhor forma"): implementar, abrir PR e avisar o que mudou. Sobre o merge: o merge é do Claude Code do dono (o que tem os MCPs de Neon, Render, Vercel e WhatsAI): ele revisa e faz o
  squash assim que a suíte estiver verde, a qualquer hora (pedido do dono em 11/11/2026). Agentes que só desenvolvem
  (DeepSeek, Cursor e outros) abrem o PR e param.
- Pergunte só o que só ele pode decidir (números de telefone, apagar dados, gastos, mudar algo do cliente em produção).

### Múltiplos agentes
- O dono quer trabalho em paralelo: para frentes independentes, dispare vários subagentes ao mesmo tempo (até ~20,
  menos quando não fizer sentido), cada um com escopo e arquivos explícitos; revise e consolide no thread principal.
- Fique no thread principal para o que é dependente ou sensível (deploy, produção, WhatsApp do cliente).
- O guia completo do projeto, inclusive esta regra, fica em `readmes/GUIA-DO-PROJETO.md`.

### Nunca
- Imprimir, commitar ou publicar credenciais (chave global, chaves do Neon/Render/OpenAI, tokens). Rotacionar a chave
  global. Use a chave de organização do Neon que já está no Render.
- Deslogar ou parear de novo um WhatsApp em produção; atualizar o Baileys sem número de teste.
- Ação destrutiva sem OK explícito: apagar projeto/branch do Neon, apagar dados, ligar `MESSAGE_RETENTION_DAYS`.
- Requisições que alteram produção a partir de testes ou do Playwright (contra produção, só GET).
- Dados reais de clientes em imagens, PRs, commits, artefatos ou arquivos publicados: capturas e exemplos só com
  dados fictícios.
- Identificador de modelo de IA em commits, PRs ou código.
- Commitar o `.gitignore` local (um plugin do ambiente o altera; é sempre ` M .gitignore` e fica fora).
- Mandar `reasoning_effort` à OpenAI: os modelos usam o raciocínio padrão.
- Fazer merge de PR sendo um agente que só desenvolve (DeepSeek, Cursor e outros): só o Claude Code do dono faz.
- Fazer merge sem a suíte completa verde (unitários, tipos, lint e integração).
- Usar emojis em código, docs, commits, PRs ou respostas.

### Git, PR e deploy
- Uma branch por tarefa a partir de `origin/main`; PR no formato de `.github/pull_request_template.md`. O squash usa
  `commit_message` explícita e cabeçalho de até 100 caracteres (commitlint, Conventional Commits).
- Workflows sempre em `ubuntu-latest` (GitHub-hosted, gratuito); não use runner self-hosted ou pago.
- Push: `NODE_OPTIONS=--max-old-space-size=6144 git push -u origin <branch>` (o hook roda eslint + tsc).
- Mudança só estática (`manager/dist`, docs, `scripts/`): termine o título do squash com `[skip render]`.
- Mudança em `src/`, `prisma/`, `Dockerfile` ou `render.yaml` reinicia a API (~4 min); o dono autorizou o merge a
  qualquer hora com a suíte verde. Depois do deploy, confira o `live` no Render e a instância `open`. Mudança na
  conexão do WhatsApp (Baileys) só entra depois de testada com um número de teste.
- Migrations sempre aditivas, em `prisma/postgresql-migrations` **e** `prisma/mysql-migrations`, com o modelo nos três
  schemas (`postgresql`, `mysql`, `psql_bouncer`). Tabela global (procurada antes de saber a instância) entra em
  `CONTROL_MODELS` de `src/api/repository/instance-db/routing.ts`.

### Antes de cada push
```bash
DATABASE_PROVIDER=postgresql npm run db:generate          # depois de mudar schema
npx tsx --test "test/unit/**/*.test.ts"                   # unitários
npm run test:types && npx tsc --noEmit -p . && npx eslint src test --ext .ts
# integração (migrations reais) num Postgres local descartável:
export TEST_PG_DIR=/tmp/evo-pg TEST_PG_PORT=55471 TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55471/evolution_test?schema=public'
npm run test:db:start && npm run test:integration
```
Nos testes, `test/helpers/setup.ts` troca o `@api/server.module` por um proxy: para substituir um serviço dele, use
`serverModuleOverrides` (`test/helpers/chatbot-emit.ts`).

### Painel (`manager/dist`, sem código-fonte)
- Só existe o bundle compilado (`assets/index-b29a5d7a.js`). Toda mudança nele é um patch em `manager/patches/*.py`:
  trocas exatas (cada âncora 1 vez), marcador, `--check`, `CACHE_VERSION` do bundle (só sobe). Depois de qualquer
  mudança: `for f in manager/patches/*.py; do python3 -I $f --check; done` e
  `npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null`.
- Páginas novas preferem um script próprio (como `client-portal.js`) a JSX escrito no patch. O layout é um só
  (`app-shell.py`, estilo do bloco Sidebar do shadcn): sidebar em todas as páginas, altura da tela, só o conteúdo rola.
  As páginas da instância usam o mesmo layout (`instance-shell.py` + `instance-shell.css`, carregado por último):
  ao mexer no layout `un`, na barra `zM` ou no menu `j5`, rode esse patch de novo e confira 390/768/1024/1440 claro e escuro.
  Ao mudar um CSS/JS, suba o `?v=` dele no `index.html`.
- Visual: só os tokens `var(--m-*)`, tema padrão **Sistema** (claro e escuro mantidos), fonte Geist, cor só com
  significado (verde ok, âmbar atenção, vermelho erro). Confira com capturas a 390 e 1440 px, claro e escuro, com a
  API simulada e dados fictícios.

### Site (`manager/dist/landing/index.html` e `/seguranca`)
- Preços iguais no site, `llms.txt`, `agents/whatsai.md`, `readmes/RESUMO.md`, `readmes/README-COMERCIAL.md` e no
  manual (seção 6). Sem logos de terceiros, sem animação de rolagem, sem créditos de autor. A licença do Evolution API
  (condição 1b do `LICENSE`) exige o aviso de uso: ele fica no rodapé do Manual e no README, não remova.
- Segurança: nunca exiba selos/certificações que o WhatsAI não tem (SOC 2, ISO 27001...). Em `/seguranca` só entra o
  que está implementado. CSP em `manager/dist/vercel.json`: mudou um `<script>` inline, atualize o hash (o teste
  `test/unit/security.test.ts` aponta). Editou CSS do site: `node manager/patches/landing-css.mjs` (README 7.1).
- Meta do Lighthouse em `/` e `/seguranca`: 100 nas quatro notas e Navegação agêntica 4/4, celular e computador.

### Linguagem e ética (escritórios de advocacia)
- Diga "triagem" e "organizar os atendimentos", nunca "captação". Nada de nota numérica para pessoas.
- A IA não fala de gratuidade, preço, honorários ou autoelogio e não promete resultado: perfil `ethicsProfile:
  "advocacia"` (Código de Ética e Disciplina da OAB e Provimento 205/2021).

### Banco Neon gratuito
- Não acorde o banco: nada de timer que consulte o banco; caches em memória; rotinas diárias pegam carona no fluxo de
  escrita (ex.: limpeza dos contadores e retenção rodam na primeira resposta da IA do dia).
- "Banco próprio": cada instância nova pode ter o seu projeto Neon (cota separada); a Observabilidade mostra cada um.

## Project Overview

**Evolution API** is a powerful, production-ready REST API for WhatsApp communication that supports multiple WhatsApp providers:
- **Baileys** (WhatsApp Web) - Open-source WhatsApp Web client
- **Meta Business API** - Official WhatsApp Business API
- **Evolution API** - Custom WhatsApp integration

Built with **Node.js 20+**, **TypeScript 5+**, and **Express.js**, it provides extensive integrations with chatbots, CRM systems, and messaging platforms in a **multi-tenant architecture**.

## Common Development Commands

### Build and Run
```bash
# Development
npm run dev:server    # Run in development with hot reload (tsx watch)

# Production
npm run build        # TypeScript check + tsup build
npm run start:prod   # Run production build

# Direct execution
npm start           # Run with tsx
```

### Code Quality
```bash
npm run lint        # ESLint with auto-fix
npm run lint:check  # ESLint check only
npm run commit      # Interactive commit with commitizen
```

### Database Management
```bash
# Set database provider first
export DATABASE_PROVIDER=postgresql  # or mysql

# Generate Prisma client (automatically uses DATABASE_PROVIDER env)
npm run db:generate

# Deploy migrations (production)
npm run db:deploy      # Unix/Mac
npm run db:deploy:win  # Windows

# Development migrations (with sync to provider folder)
npm run db:migrate:dev      # Unix/Mac
npm run db:migrate:dev:win  # Windows

# Open Prisma Studio
npm run db:studio

# Development migrations
npm run db:migrate:dev      # Unix/Mac
npm run db:migrate:dev:win  # Windows
```

### Testing
```bash
npm run test:unit         # unit tests (node:test + tsx)
npm run test:integration  # integration tests (local Postgres, see "Antes de cada push")
npm test                  # watch mode
```

## Architecture Overview

### Core Structure
- **Multi-tenant SaaS**: Complete instance isolation with per-tenant authentication
- **Multi-provider database**: PostgreSQL and MySQL via Prisma ORM with provider-specific schemas and migrations
- **WhatsApp integrations**: Baileys, Meta Business API, and Evolution API with unified interface
- **Event-driven architecture**: EventEmitter2 for internal events + WebSocket, RabbitMQ, SQS, NATS, Pusher for external events
- **Microservices pattern**: Modular integrations for chatbots, storage, and external services

### Directory Layout
```
src/
├── api/
│   ├── controllers/     # HTTP route handlers (thin layer)
│   ├── services/        # Business logic (core functionality)
│   ├── repository/      # Data access layer (Prisma)
│   ├── dto/            # Data Transfer Objects (simple classes)
│   ├── guards/         # Authentication/authorization middleware
│   ├── integrations/   # External service integrations
│   │   ├── channel/    # WhatsApp providers (Baileys, Business API, Evolution)
│   │   ├── chatbot/    # AI/Bot integrations (OpenAI, Dify, Typebot, Chatwoot)
│   │   ├── event/      # Event systems (WebSocket, RabbitMQ, SQS, NATS, Pusher)
│   │   └── storage/    # File storage (S3, MinIO)
│   ├── routes/         # Express route definitions (RouterBroker pattern)
│   └── types/          # TypeScript type definitions
├── config/             # Environment and app configuration
├── cache/             # Redis and local cache implementations
├── exceptions/        # Custom HTTP exception classes
├── utils/            # Shared utilities and helpers
└── validate/         # JSONSchema7 validation schemas
```

### Key Integration Points

**Channel Integrations** (`src/api/integrations/channel/`):
- **Baileys**: WhatsApp Web client with QR code authentication
- **Business API**: Official Meta WhatsApp Business API
- **Evolution API**: Custom WhatsApp integration
- Connection lifecycle management per instance with automatic reconnection

**Chatbot Integrations** (`src/api/integrations/chatbot/`):
- **EvolutionBot**: Native chatbot with trigger system
- **Chatwoot**: Customer service platform integration
- **Typebot**: Visual chatbot flow builder
- **OpenAI**: AI capabilities including GPT and Whisper (audio transcription)
- **Dify**: AI agent workflow platform
- **Flowise**: LangChain visual builder
- **N8N**: Workflow automation platform
- **EvoAI**: Custom AI integration

**Event Integrations** (`src/api/integrations/event/`):
- **WebSocket**: Real-time Socket.io connections
- **RabbitMQ**: Message queue for async processing
- **Amazon SQS**: Cloud-based message queuing
- **NATS**: High-performance messaging system
- **Pusher**: Real-time push notifications

**Storage Integrations** (`src/api/integrations/storage/`):
- **AWS S3**: Cloud object storage
- **MinIO**: Self-hosted S3-compatible storage
- Media file management and URL generation

### Database Schema Management
- Separate schema files: `postgresql-schema.prisma` and `mysql-schema.prisma`
- Environment variable `DATABASE_PROVIDER` determines active database
- Migration folders are provider-specific and auto-selected during deployment

### Authentication & Security
- **API key-based authentication** via `apikey` header (global or per-instance)
- **Instance-specific tokens** for WhatsApp connection authentication
- **Guards system** for route protection and authorization
- **Input validation** using JSONSchema7 with RouterBroker `dataValidate`
- **Rate limiting** and security middleware
- **Webhook signature validation** for external integrations

## Important Implementation Details

### WhatsApp Instance Management
- Each WhatsApp connection is an "instance" with unique name
- Instance data stored in database with connection state
- Session persistence in database or file system (configurable)
- Automatic reconnection handling with exponential backoff

### Message Queue Architecture
- Supports RabbitMQ, Amazon SQS, and WebSocket for events
- Event types: message.received, message.sent, connection.update, etc.
- Configurable per instance which events to send

### Media Handling
- Local storage or S3/Minio for media files
- Automatic media download from WhatsApp
- Media URL generation for external access
- Support for audio transcription via OpenAI

### Multi-tenancy Support
- Instance isolation at database level
- Separate webhook configurations per instance
- Independent integration settings per instance

## Environment Configuration

Key environment variables are defined in `.env.example`. The system uses a strongly-typed configuration system via `src/config/env.config.ts`.

Critical configurations:
- `DATABASE_PROVIDER`: postgresql or mysql
- `DATABASE_CONNECTION_URI`: Database connection string
- `AUTHENTICATION_API_KEY`: Global API authentication
- `REDIS_ENABLED`: Enable Redis cache
- `RABBITMQ_ENABLED`/`SQS_ENABLED`: Message queue options

## Development Guidelines

The project follows comprehensive development standards defined in `.cursor/rules/`:

### Core Principles
- **Always respond in Portuguese (PT-BR)** for user communication
- **Follow established architecture patterns** (Service Layer, RouterBroker, etc.)
- **Robust error handling** with retry logic and graceful degradation
- **Multi-database compatibility** (PostgreSQL and MySQL)
- **Security-first approach** with input validation and rate limiting
- **Performance optimizations** with Redis caching and connection pooling

### Code Standards
- **TypeScript strict mode** with full type coverage
- **JSONSchema7** for input validation (not class-validator)
- **Conventional Commits** enforced by commitlint
- **ESLint + Prettier** for code formatting
- **Service Object pattern** for business logic
- **RouterBroker pattern** for route handling with `dataValidate`

### Architecture Patterns
- **Multi-tenant isolation** at database and instance level
- **Event-driven communication** with EventEmitter2
- **Microservices integration** pattern for external services
- **Connection pooling** and lifecycle management
- **Caching strategy** with Redis primary and Node-cache fallback

## Testing Approach

The project has a `node:test` suite (run with `tsx`), executed by CI (`Check Code Quality`):
- **Unit tests** in `test/unit/**/*.test.ts`: `npm run test:unit`
- **Integration tests** in `test/integration/**/*.test.ts` against a local Postgres: `npm run test:db:start`, then `npm run test:integration`
- **Type-check of the tests**: `npm run test:types` (CI runs it; fakes must implement every method the code calls)
- `npm run test:run` runs unit + integration; `npm test` is the watch mode
- WhatsApp connection flows are still tested manually (never re-pair or log out a production number)

### Recommended Testing Strategy
- Focus on **critical business logic** in services
- **Mock external dependencies** (WhatsApp APIs, databases)
- **Integration tests** for API endpoints
- **Manual testing** for WhatsApp connection flows

## Deployment Considerations

- Docker support with `Dockerfile` and `docker-compose.yaml`
- Graceful shutdown handling for connections
- Health check endpoints for monitoring
- Sentry integration for error tracking
- Telemetry for usage analytics (non-sensitive data only)
## Vendor Documentation (local copy)

Official docs for **Neon**, **Render** and **Vercel** are mirrored in `docs/vendors/<vendor>/llms.txt`
(index) and `llms-full.txt` (full text). Grep them before answering questions about plans, limits or
APIs of these platforms. Refresh with `bash scripts/update-vendor-docs.sh`.
