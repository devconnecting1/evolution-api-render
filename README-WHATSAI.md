# WhatsAI — Atendimento com IA no WhatsApp

> **Atribuição:** projeto inspirado no Evolution Foundation/Evolution API. Base licenciada sob Apache 2.0, com condições adicionais.

Plataforma própria de atendimento automatizado: Evolution API (WhatsApp Web via Baileys ou Cloud API oficial da Meta) + agente OpenAI por instância + painel WhatsAI. Cada número = 1 instância com seu próprio agente.

> Este README é o manual operacional do projeto. Atualizado em 10/11/2026 (revisão geral contra o código).
>
> **Canais:** os planos Essencial e Profissional usam **WhatsApp Web** (`WHATSAPP-BAILEYS`, QR code); o Premium usa a **Cloud API** (`WHATSAPP-BUSINESS`). O escritório de advocacia em produção usa Baileys. A **pausa humana** está validada em produção no Baileys. Na Cloud API ela funciona pelos ecos da **Coexistence** (`smb_message_echoes`), já tratados no código, mas **ainda não validados com um número real** (seção 12.7).

## 1. Arquitetura

```
WhatsApp do cliente (WhatsApp Web via Baileys, ou Cloud API oficial da Meta)
   │
   ▼
API WhatsAI (Evolution API 2.3.7) — Render, Ohio, 1 serviço para todas as instâncias
   ├── Neon (principal): lista de instâncias, mapeamento dos bancos e dados das instâncias antigas
   ├── Neon (1 projeto por instância nova): mensagens, contatos, bot, Leads, Agenda, Processos daquela instância
   ├── Redis (cache) — Render Key Value Free, sem persistência (chaves do WhatsApp também ficam no Postgres)
   ├── OpenAI: chave de cada cliente, um bot por instância
   └── MCP em /mcp: operar o projeto por assistentes de IA (seção 14)

Site, painel e manual — Vercel (arquivos estáticos de manager/dist)
cron-job.org — GET / a cada 5 min (keep-alive) e, opcionais, POST /agenda/tick e /processos/tick
```

| Recurso | Endereço |
|---|---|
| API | URL do serviço web, configurada no painel do Render |
| Site | `https://whatsaibr.vercel.app/` (+ `/advocacia` e `/instagram`) |
| Painel | `https://whatsaibr.vercel.app/manager` (login com a chave global) |
| Manual | `https://whatsaibr.vercel.app/readme` (também no item **Manual** do painel) |
| Banco | Neon: projeto principal + um projeto por instância com banco próprio (`docs/arquitetura/banco-por-instancia.md`) |
| Keep-alive | job no cron-job.org (GET `/` a cada 5 min), configurado no painel do provedor |
| Repo | repositório privado do projeto no GitHub (`origin`); o `main` publica no Render e na Vercel (seção 3) |

## 2. Segredos e acessos

- **API key global** (`AUTHENTICATION_API_KEY`): definida somente no painel do Render (`sync: false`), fora do Git. É super-admin — **nunca** compartilhar com cliente. Se houver suspeita de exposição, rotacione-a.
- **Banco**: URI de conexão configurada no painel do Render (`DATABASE_CONNECTION_URI`, `sync: false`). Não commitar.
- **Tokens de deploy** (Vercel, cron-job.org): guardados fora do repositório, com o operador. Se sumirem, gerar novos no painel do provedor. No GitHub, o secret `VERCEL_TOKEN` alimenta o workflow de deploy do manager.
- **Banco por instância:** `NEON_API_KEY` (chave da organização, cria os projetos) e `DB_PER_INSTANCE_SECRET` (criptografa a URL de cada banco; **nunca trocar**, senão os bancos ficam ilegíveis), só no painel do Render.
- **Chaves dos clientes:** a página **Chaves e credenciais** do painel (só chave global) lista as chaves de cada instância mascaradas e mostra uma por vez depois de digitar a chave global de novo; o MCP só devolve versões mascaradas (`list_credentials`).
- **Painel**: acesso somente do operador (você), com a chave global. Hoje o cliente usa apenas o WhatsApp: pausar uma conversa, ver Leads, Agenda ou Processos é feito pela nossa equipe a pedido dele (ou pelo próprio WhatsApp, respondendo o contato, o que pausa a IA).

## 3. Deploy

O repositório no GitHub (`origin`) é a fonte de tudo, e o `main` publica sozinho:

| O que muda | Para onde vai | Como |
|---|---|---|
| API (`src/`, `prisma/`, `Dockerfile`, `render.yaml`) | Render | Deploy automático a cada commit no `main` (`autoDeployTrigger: commit`). A API fica ~4 min fora e reconecta as instâncias: faça fora do horário comercial dos clientes |
| Site, painel e manual (`manager/dist/**`) | Vercel | Workflow **Deploy Manager** (GitHub Actions, secret `VERCEL_TOKEN`) a cada push no `main` que muda `manager/dist/**` |

- **Fluxo:** branch → PR → CI verde → squash no `main`. Quando o PR só mexe em `manager/dist`, documentação ou READMEs, ponha `[skip render]` no título do commit de merge: o Render não reinicia a API à toa.
- **Manuais:** depois de editar `README-WHATSAI.md` ou `readmes/*.md`, rode `./scripts/sync-readmes.sh` (copia para `manager/dist/readmes/` e gera o índice) e commite as cópias junto.
- **Fallback manual do painel:**

```bash
./scripts/sync-readmes.sh
cd manager/dist
VERCEL_TOKEN="<token da Vercel>" npx -y vercel@65.2.0 deploy --prod --yes --archive=tgz
```

- Mudanças de env no `render.yaml` são aplicadas no deploy seguinte (Blueprint auto-sync). Se não aplicar: Render > Blueprint > **Sync**.
- **CI:** `Check Code Quality` roda lint, build, `npm run test:types` e os testes unitários e de integração (Postgres local); `Security` roda Gitleaks + `npm audit` (só relatório); Dependabot abre atualizações semanais.
- **Testes locais:** `npm run test:unit`; integração com `npm run test:db:start` e depois `npm run test:integration` (veja `test/scripts/local-postgres.sh`).
- **Build:** o `tsup` empacota cada arquivo de `src` com sourcemap e já passa do heap padrão do Node (~2 GB). O `Dockerfile` (estágio de build) e o CI usam `NODE_OPTIONS=--max-old-space-size=4096`; localmente rode `NODE_OPTIONS=--max-old-space-size=4096 npm run build`. Para `git push` com o hook de pre-push (que faz o build), use `NODE_OPTIONS=--max-old-space-size=6144 git push`.

## 4. Painel, site e manual (build sem fonte)

Só existe `manager/dist` (bundle Vite do evolution-manager-v2 2.3.5, `assets/index-b29a5d7a.js`). Toda mudança no painel é um **patch determinístico** em `manager/patches/*.py`: troca de trechos exatos do bundle, com marcador (rodar de novo não duplica), `--check` (sai com erro se algo não foi aplicado) e cache bust do bundle no `index.html` (hoje `?v=33`). Depois de qualquer patch: `python3 -I manager/patches/<nome>.py --check` em todos e `node --check` numa cópia `.mjs` do bundle. Se o manager for reconstruído do zero, reaplique todos.

| Área | Patch / arquivos | O que faz |
|---|---|---|
| Idioma e marca | `ptbr-only.py`, `login-clean.py`, `favicon-wa.py`, `render-style.py`, `home-redesign.py` | Painel só em PT-BR, login limpo, wordmark em texto, fonte Geist, telas de entrada |
| Cores e tema | `theme.py` + `assets/theme.css?v=3` | Paleta "Meu Tema Global" (monocromática, raio 4 px, sem sombras), tema **Claro / Escuro / Sistema** (padrão Sistema, guardado em `localStorage` `wa-theme`). Cor só com significado: verde ok, âmbar atenção, vermelho erro |
| Layout | `minimal.py`, `twenty-layout.py`, `ui-tables.py`, `dashboard-ui.py`, `responsive.py`, `panel-polish.py` | Barra de visão, painel lateral do contato, menu de comandos (Ctrl K), tabelas, "Primeiros passos", celular/tablet. Na lista de instâncias, a lateral mostra só Instâncias, Observabilidade, Chaves e credenciais, Manual e Sair |
| Conversas | `chat-ui.py`, `chat-guards.py` | Lista, balões, mídia sob demanda, páginas antigas; correção de dois travamentos |
| Bot OpenAI | `openai-fields.py`, `openai-media.py` | `tokenParam`, pausa humana, estado da pausa por contato, mídia e memória (seções 12.1, 12.2, 12.9, 12.10) |
| Nova instância | `db-mode.py` + `db-mode.css` | Escolha **Banco próprio / Compartilhado** com "Restam N de 100 projetos" |
| Plano e limites | `usage-limits.py` + `usage-limits.css` | Página da instância e barra de uso na Visão Geral (seção 15) |
| Leads | `leads.py` + `leads.css`, `leads-xlsx.py` | Página de triagem, linha Lead no painel do contato e "Exportar planilha" em Excel (seção 16) |
| Processos | `processos.py` + `processos.css` | Página com abas Processos, Publicações e Configurações (seção 17) |
| Agenda | `agenda.py` + `agenda.css` | Semana/lista, novo agendamento, configurações, próximo agendamento no contato (seção 18) |
| Observabilidade | `observability-ui.py`, `observability-grid.py`, `observability-alerts.py` | Página nativa com cartões por provedor e alertas (seção 10) |
| Chaves e credenciais | `credentials-vault.py` + `credentials-vault.css` | Só chave global: chaves de cada instância mascaradas e "mostrar" uma por vez (seção 2) |
| Rotas | `root-redirect.py`, `manager/dist/vercel.json` | A home antiga nunca aparece; rotas SPA e `/observability` com rewrites antes do catch-all |
| Manual | `assets/readme-tab.js`, `readme-tab.css`, `marked.min.js`, `readmes/` | Item **Manual** da lateral e `/readme`: resumo operacional (`readmes/RESUMO.md`) com links para o guia comercial e este manual |

**Site** (`manager/dist/landing/`: `index.html`, `advocacia.html`, `instagram.html`): HTML e CSS escritos à mão (`landing.css`, `segment.css`, `landing-theme.css`, `landing-plus.css`) e `landing.js` / `landing-pixels.js` (fundo de pixels do plano Premium, parado com "reduzir movimento"). Sem logos ou nomes de terceiros, fonte Geist, sem animação de rolagem, dados de exemplo fictícios. Preços iguais aos da seção 6 (inclusive no JSON-LD); ao mudar um preço, mude as três páginas, a seção 6, o guia comercial e o resumo. Em `/advocacia`, a linguagem segue a seção 16.7 (triagem, nunca captação; sem nota numérica para pessoas).

## 5. Onboarding de cliente (runbook)

Dados necessários: nome da instância (slug, ex. `escritorio-silva`), número E.164 (`5521...`), plano, chave OpenAI (um *project key* por instância, sua, embutida no preço, ou do cliente), informações do negócio para o prompt.

Ordem recomendada:

1. **Prompt** a partir de `prompts/exemplo-advocacia.md` (abaixo).
2. **Instância:** painel > **Nova instância**, com **Banco próprio** (padrão; cada cliente com a sua cota no Neon) ou **Compartilhado** (testes, ou quando acabar a cota de projetos). WhatsApp Web: leia o QR code. Cloud API: payload abaixo.
3. **OpenAI:** credencial, settings e bot (seção 12.4, ou `scripts/novo-cliente.sh`). Depois teste a chave: `POST /openai-health/<instância>/test` (ou o cartão OpenAI da Observabilidade) — mostra se a chave é válida, se o modelo está liberado e se há crédito.
4. **Plano e limites:** plano, horário de atendimento e mensagens (seção 15).
5. **Opcional, conforme o plano:** Leads (seção 16), Agenda (seção 18), Processos (seção 17).
6. **Checklist de entrega** (abaixo).

Atalho para WhatsApp Web: `EVOLUTION_API_KEY=<chave global> ./scripts/novo-cliente.sh <instância> <número> <essencial|profissional|premium> <prompt.md> [openai-key]` cria a instância, espera a conexão pelo QR code, cadastra a credencial, o bot (`gpt-6-luna`, `maxTokens` 2000, pausa humana de 60 min, memória de 30 mensagens, grupos ignorados), as settings e o plano.

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

Com o banco por instância ligado, `POST /instance/create` aceita `"dbMode": "own"` (padrão) ou `"shared"`; sem cota de projetos, `own` é recusado com mensagem clara e nada é criado (`GET /admin/database-quota` mostra quantos restam).

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
| Saúde da chave OpenAI / testar agora | `GET /openai-health/{instancia}` / `POST /openai-health/{instancia}/test` |
| Plano e limites | `POST /usage/limits/{instancia}` (seção 15.3) |
| Cota de bancos próprios (só chave global) | `GET /admin/database-quota` |

Header de autenticação: `apikey: <chave>`.

### Checklist de entrega

- [ ] Instância `open`, perfil correto e banco (Próprio/Compartilhado) conferido na lista
- [ ] Chave OpenAI testada: "Funcionando" e modelo liberado (`/openai-health`)
- [ ] (Oficial) Meta Business verificado, WABA, Phone Number ID, token permanente e cartão cadastrados
- [ ] (Oficial) Webhook `/webhook/meta` ativo com os campos `messages` e `smb_message_echoes` (Coexistence) e templates aprovados (se houver envio fora da janela de 24 h)
- [ ] Agente responde "oi" com o tom do cliente
- [ ] Perguntas de preço/horário/endereço corretas
- [ ] Pedido de pessoa: a IA avisa que a equipe vai continuar (é só instrução do prompt; não há aviso automático à equipe). A equipe responde e a IA pausa
- [ ] Pausa e retomada testadas (teste com `humanResumeMinutes` = 2 e depois volte ao combinado)
- [ ] Áudio transcrito (`transcribeAudio`), foto e PDF lidos com o modelo do bot (PDF no gpt-6-luna ainda não validado: se o modelo recusar, a IA recebe só a descrição do arquivo)
- [ ] Plano e limites configurados (franquia do plano, horário de atendimento, `outsideHoursMessage`)
- [ ] `unknownMessage` em PT-BR e grupos ignorados (`ignoreJids: ["@g.us"]`)
- [ ] Cliente avisado sobre políticas/limites da Meta e fair use
- [ ] Termo de serviço e de tratamento de dados aceitos + cobrança da implantação

## 6. Planos e preços

Preços de 10/11/2026: **sem fidelidade** (mensalidade mês a mês), uma implantação por plano e **1 número por plano**; cada número adicional é outra instância, com mensalidade própria. Propostas enviadas antes mantêm os preços durante a validade. A versão para o cliente (com o que inclui, adicionais e condições) está no **Guia comercial** (`readmes/README-COMERCIAL.md`). Custos internos, margens e roteiro de vendas ficam no Guia de Vendas interno, fora do repositório: este manual é público em `/readme`.

| | Essencial | Profissional | Premium (API oficial) |
|---|---:|---:|---:|
| Mensalidade | R$ 437 | R$ 767 | R$ 1.427 |
| Implantação, cobrada uma vez | R$ 1.640 | R$ 3.180 | a partir de R$ 5.820 |
| Respostas da IA incluídas por mês | 2.000 | 5.000 | 10.000 |
| Números incluídos | 1 | 1 | 1 |
| Número adicional (outra instância, mesmos recursos e franquia) | R$ 287/mês + R$ 540 | R$ 497/mês + R$ 980 | R$ 927/mês + a partir de R$ 1.640 + aprovação da Meta |
| Ajustes nas instruções por mês | 2 | 4 | 8 |
| Integrações sob medida incluídas | – | 1 | 2 |
| Áudio, foto e PDF | Sim | Sim | Sim |
| Leads (seção 16) | Sim | Sim | Sim |
| Agenda com lembretes (seção 18) | – | Sim | Sim, só na janela de 24 h |
| Processos (seção 17) e assistente de IA (MCP, seção 14) | – | Sim | Sim |

- **Sem fidelidade:** mensalidade mês a mês; cancelamento com 30 dias de aviso, sem multa. A implantação não é devolvida. Pagamento anual antecipado: 10% de desconto na mensalidade.
- **Número adicional:** cada número é uma instância própria (IA, instruções, banco por instância e espaço no servidor) com **os mesmos recursos e a mesma franquia de respostas do plano**, por isso o preço acompanha o plano: cerca de 65% da mensalidade (treinamento, suporte e integrações são da empresa e não se repetem). Cobre a OpenAI da franquia, a parte do Render e o projeto Neon da instância; revise se o custo por instância mudar (por exemplo, Neon pago acima de 100 projetos).
- **Excedente:** R$ 49 por bloco de 1.000 respostas. **Piloto assistido de 14 dias:** R$ 690, abatido da implantação.
- **Franquia:** medida automaticamente por instância e visível no painel em **Plano e limites** (seção 15). Configure o plano de cada cliente na implantação.

### Cuidados que entram nos termos
1. **WhatsApp Web (Baileys) não é oficial.** O número pode ser bloqueado, principalmente com disparos em massa. Aviso de risco por escrito; a API oficial é a alternativa.
2. **Regras da Meta para IA mudaram em 2026** e podem mudar de novo: mantenha a cláusula de revisão de preço.
3. **LGPD:** termo de tratamento de dados, aviso de que o contato fala com uma IA e retenção combinada (padrão 90 dias; a exclusão hoje é manual, seção 7).
4. **Advocacia:** o Provimento 205/2021 da OAB limita a publicidade. A IA não promete resultado nem capta clientes ativamente; só faz triagem e agendamento.
5. **Nada prometido que não exista** (seção 13): relatório automático e aviso à equipe quando o cliente pede uma pessoa **não** são recursos atuais. Lembretes de consulta só existem com a **Agenda** ligada (seção 18), no WhatsApp Web; na Cloud API só dentro da janela de 24 h.

## 7. LGPD, segurança e riscos

- Termo de tratamento de dados (operador); retenção padrão de 90 dias (configurável no termo). **Não existe expurgo automático no código**: as mensagens ficam no banco até alguém apagar. Enquanto não houver rotina automática, faça a exclusão manualmente (mensal) e registre. Backup: snapshots do banco + `pg_dump` mensal (seção 8).
- Advocacia: sigilo profissional — não solicitar documentos sensíveis pelo chat; usar link seguro.
- **Cloud API oficial**: conexão via token permanente, WABA e Phone Number ID. A Meta pode limitar por qualidade/política, exige templates fora da janela de 24 h e cartão do cliente cadastrado; não prometa isenção de bloqueio por violação de política.
- Manager e chave global são do operador. Cliente nunca recebe a chave global.
- Uma credencial OpenAI não pode ser cadastrada em duas instâncias (a API recusa chave repetida). Para cliente com número adicional, gere um project key por instância, com limite de gasto no projeto da OpenAI; não compartilhe a mesma key entre clientes.
- O log de boot **não** mostra mais a `DATABASE_URL` (o script de migration imprime só host e banco). Logs antigos do Render podem ter a URL completa: se alguém de fora viu esses logs, troque a senha do banco no Neon.

## 8. Manutenção

- **Keep-alive**: job no cron-job.org, configurado no painel do provedor (5 min). Sem ele, o free dorme em 15 min.
- **Atualizações**: `git push render main` (revisar changelog do upstream antes).
- **Backup**: snapshots do Neon + `pg_dump` mensal para storage externo, **do projeto principal e de cada projeto de instância** (cada banco próprio é um projeto separado).
- **Monitorar** (diário, pela Observabilidade): cartão **OpenAI** (chave sem crédito, inválida ou modelo indisponível vira alerta crítico), **Plano e uso** (franquia acima do alerta), instâncias `close`, sessões travadas, erros no log do Render; no oficial, qualidade/limites e billing da Meta.
- **Neon acordando de madrugada:** `GET /admin/db-activity` (ou MCP `get_database_info`) mostra cada "acordada" do banco principal e as consultas que a causaram (só tabela e tipo de SQL). Use antes de mexer em consultas para economizar CU-h.
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
| IA parou de responder em todos os contatos de uma instância | Veja o cartão **OpenAI** da Observabilidade ou `GET /openai-health/{instancia}`: "Sem crédito na conta OpenAI" (adicionar crédito em Billing), "Chave inválida ou revogada" (gerar outra), "Modelo do bot indisponível" (liberar o modelo no projeto). Depois, `POST .../test` confirma. Se estiver ok, confira o **Plano e limites** (franquia com `pause`, limite diário, horário) |
| "Banco próprio" desabilitado na Nova instância | Cota de projetos do Neon no fim (`NEON_PROJECT_LIMIT`, padrão 100) ou `DB_PER_INSTANCE_ENABLED` desligado. Crie como Compartilhado ou libere projetos |
| Instância com banco próprio sem dados / erro de conexão | O projeto Neon da instância pode ter esgotado as 100 CU-h do mês (só ela fica sem banco até o mês virar). Veja o consumo no Neon Console |
| DJEN com erro "HTTP 403" em Processos | Bloqueio geográfico (Render em Ohio); configure `DJEN_BASE_URL` com um repasse no Brasil (seção 17.1) |

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
- **Cartões próprios:** **OpenAI** (seção 12.11: chaves funcionando, alerta crítico para sem crédito/inválida/modelo indisponível; testa sozinho a chave que ficou 6 h sem sinal), **Plano e uso** (seção 15.4, com a linha de Leads da seção 16.5) e **WhatsApp** (última mensagem recebida por instância).
- Segurança: os tokens ficam somente no backend; o browser usa apenas a chave global já existente no login. Se um token vazar, rotacione no provedor e no Render.

## 11. Registro de decisões

- Plano Render free por opção de custo; upgrade para Starter quando houver clientes pagantes.
- Manager sem fonte: patches aplicados direto no bundle (seção 4).
- Integrações habilitadas em `render.yaml`.
- Marca WhatsAI aplicada ao manager (título, logos, textos).
- ~~Conexão oficial (Cloud API) é a única oferta a clientes.~~ Substituído em 02/11/2026: Essencial e Profissional usam WhatsApp Web (Baileys), com aviso de risco nos termos; o Premium usa a Cloud API.
- 29/10/2026: bot OpenAI ganhou `tokenParam` (compatibilidade com modelos de raciocínio) e `humanResumeMinutes` (pausa/retomada quando o dono escreve). `expire` continua sem efeito no OpenAI. Detalhes, curls, limitações e deploy na seção 12.
- Cloud API: a pausa humana passou a funcionar pelos ecos da Coexistence (`smb_message_echoes`, PR #2). Falta validar com um número real.
- 02/11/2026: preços fixos aprovados (seção 6) e auditoria do que a landing promete contra o código (seção 13).
- 03/11/2026: servidor MCP embutido em `/mcp` para operar o projeto por assistentes de IA (seção 14).
- 03/11/2026: reajuste da implantação e dos adicionais (seção 6); mensalidades e excedente mantidos.
- 03/11/2026: chaves Signal do WhatsApp gravadas também no Postgres (tabela `AuthStateKey`, migration `20261103120000_add_auth_state_key`), com backfill do Redis no start: o Redis grátis não tem persistência.
- 03/11/2026: correções de robustez vindas das issues do upstream (branch `fix/upstream-hardening`): o bot responde uma vez por mensagem mesmo quando o WhatsApp reentrega o mesmo id (cache de 24 h); mensagens temporárias, de visualização única e documentos com legenda são lidos pelo conteúdo real; uma mensagem com erro não derruba as outras do lote; edições, exclusões e o aviso de "mensagens temporárias" não viram mensagem nova para a IA; `msgCall` só sai com `rejectCall` ligado; o token de uma instância não acessa outra pela query (`?instanceName=`); com o banco fora do ar a mensagem ainda vai para o bot e a falha aparece na Observabilidade; o card WhatsApp mostra a última mensagem recebida por instância. Paliativo da CVE do Baileys (GHSA-qvv5-jq5g-4cgg) até o upgrade: respostas de "placeholder resend" só são aceitas para ids que a própria API pediu. Nova migration `20261103120000_message_key_id_index` (só um índice, aplicada no start do container). O upgrade do Baileys continua pendente: testar antes num número descartável.
- 03/11/2026: **Plano e limites** (seção 15): contagem automática das respostas da IA, franquia, limites diários e horário de atendimento por instância. Sem plano configurado, nada muda no atendimento.
- 04/11/2026: **Leads** (seção 16): ficha de triagem por conversa, sem nota numérica; aviso opcional à equipe.
- 09/11/2026: **Processos** (seção 17): andamentos do DataJud e intimações do DJEN por OAB, avisos à equipe, aviso neutro opcional ao cliente e contexto opcional (só datas) para a IA. Migration aditiva `20261109120000_add_processos`.
- 09/11/2026: **Agenda** própria (seção 18): a IA consulta horários, agenda, remarca e cancela pelo WhatsApp (ferramentas do Chat Completions), lembretes com confirmação, página no painel, feed ICS e ferramentas MCP. Desligada por padrão. Sem Google Calendar.
- 09/11/2026: **banco próprio por instância** (um projeto Neon por instância nova, `docs/arquitetura/banco-por-instancia.md`): a cota de 100 CU-h do Free passa a ser de cada cliente. O Render continua um serviço só (as 750 h grátis são por workspace).
- 10/11/2026: "Nova instância" com escolha **Banco próprio / Compartilhado** e contador de projetos do Neon; registro das "acordadas" do banco (`GET /admin/db-activity`, MCP `get_database_info`); chaves do WhatsApp que não existem deixam de ser procuradas no banco a cada pedido; MCP ganhou `update_appointment`, `get_agenda_settings`, `get_process_settings` e `update_process_settings`.
- 10/11/2026: **Saúde das chaves OpenAI** sem entrar na conta de cada cliente (seção 12.11); cartão **OpenAI** na Observabilidade com alerta; MCP `get_openai_health`. O saldo em dólares não é exposto pela OpenAI para chaves comuns.
- 10/11/2026: tema **"Meu Tema Global"** no painel e no site (claro, escuro e Sistema, padrão Sistema; lateral escura na mesma paleta), lateral da lista de instâncias só com os itens globais, cabeçalho do celular sem estourar a tela; site com módulos, assistente de IA, números com mini-gráficos e barra fixa de contato no celular.
- 10/11/2026: **planos sem fidelidade** (mensalidade mês a mês), implantação única pelo valor antigo de 12 meses, todos os planos com 1 número e número adicional com os recursos e a franquia do plano: R$ 247 / R$ 447 / R$ 847 por mês, implantação R$ 490 / R$ 890 / a partir de R$ 1.490. Propostas enviadas antes mantêm os preços durante a validade.
- 10/11/2026: **reajuste de 10%** em mensalidades, implantações e número adicional (seção 6): R$ 437 / R$ 767 / R$ 1.427 por mês, implantação R$ 1.640 / R$ 3.180 / a partir de R$ 5.820, número adicional R$ 287 / R$ 497 / R$ 927 (cerca de 65% da mensalidade) com implantação R$ 540 / R$ 980 / a partir de R$ 1.640. Excedente (R$ 49 por 1.000 respostas) e piloto (R$ 690) mantidos: o piloto é a porta de entrada e o excedente já cobre a OpenAI com folga.
- 10/11/2026: o script de migration deixou de imprimir a `DATABASE_URL` no log de boot (só host e banco).
- 10/11/2026: **Leads em planilha Excel** (abas Leads e Resumo, gerada pela própria API sem biblioteca nova) e análise automática mais precisa: área classificada pelo assunto, cidade padronizada, prioridade com a data do fato (contagem, prazo vencido, audiência passada, data distante e problema já resolvido).
- Avaliado e adiado: Neon Free → Supabase Free. O banco por instância no Neon já isola a cota de cada cliente; reavaliar se o limite de 100 projetos ou o custo do Neon pago pesar.
- Planejado: Render Free → Starter (US$ 7/mês) ao ter cliente pagante; site e painel fora do Vercel Hobby (os termos proíbem uso comercial) → Cloudflare Pages (gratuito) ou Vercel Pro.

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

- **Painel:** `tokenParam`, `humanResumeMinutes` e os campos de mídia e memória aparecem no formulário do bot e nas Configurações Padrão (patches `openai-fields.py` e `openai-media.py`). Como na API, um campo do bot não volta a "herdar das settings" depois de definido.
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
- **Modo `assistant` indisponível:** a OpenAI desligou a Assistants API em 26/08/2026. Bots com `botType: "assistant"` (e o `functionUrl`, que só existia nesse modo) não respondem mais; use `chatCompletion`. A **Agenda** própria usa ferramentas do Chat Completions (seção 18); planilha ou CRM continuam como serviço sob medida (webhook/n8n).

### 12.8 Deploy e atualização

1. **Antes do merge:** crie um snapshot/branch do projeto no Neon.
2. A migration `20261029120000_add_openai_token_param_human_resume` é **aditiva** (colunas novas nullable ou com default) e roda no start do container (`Docker/scripts/deploy_database.sh` > `prisma migrate deploy`). O default `auto` preserva o comportamento do gpt-4o. **Atenção:** com `humanResumeMinutes = 0` (default) uma sessão pausada não reabre mais sozinha na mensagem seguinte do cliente (antes reabria, engolindo essa mensagem); logo após o deploy defina `humanResumeMinutes` pela API (settings e/ou bot) com o valor combinado com o escritório.
3. O merge na `main` dispara deploy automático no Render; a API fica ~4 min fora. Faça fora do horário comercial do escritório.
4. **Rollback:** reverter o merge e deixar o Render redeployar. As colunas extras permanecem no banco e são ignoradas pelo código antigo.
5. O script de migration imprime só o host e o banco no log de boot (a URL completa, com senha, deixou de aparecer em 10/11/2026).

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

### 12.11 Saúde das chaves OpenAI (sem entrar na conta do cliente)

Cada resposta do bot registra, em memória, se a chave funcionou; o teste ativo confirma na hora. Nada é gravado no banco.

| Situação | Quando aparece | O que fazer |
|---|---|---|
| Funcionando | Última resposta ou teste deu certo | Nada |
| Sem crédito na conta OpenAI | OpenAI respondeu `insufficient_quota` | Adicionar crédito em Billing da conta do cliente |
| Chave inválida ou revogada | 401 `invalid_api_key` | Gerar outra chave (API keys) e atualizar a credencial |
| Modelo do bot indisponível para esta chave | 404 `model_not_found` ou o modelo do bot fora da lista da chave | Liberar o modelo no projeto da OpenAI ou trocar o modelo do bot |
| Limite de uso por minuto atingido | 429 `rate_limit_exceeded` | Passa sozinho; se repetir, subir o tier da conta |
| Chave sem permissão / OpenAI instável / Sem resposta da OpenAI | 403, 5xx, rede ou tempo esgotado | Conferir o projeto da chave; erros 5xx e de rede costumam passar |
| Ainda sem uso nem teste | Nenhuma resposta nem teste desde o último restart | Rodar o teste |

- **Teste ativo** (`POST /openai-health/{instancia}/test`, botão no cartão ou MCP `get_openai_health` com `test=true`): `GET /v1/models` (de graça; diz se a chave vale e se o modelo do bot está liberado) e um embedding de 1 token (`text-embedding-3-small`, ~US$ 0,00000002; diz se há crédito). Se o projeto bloquear embeddings, confirma com uma resposta mínima do modelo do bot. No máximo 1 teste a cada 30 s por chave. Também devolve os limites por minuto do tier da conta.
- `GET /openai-health/{instancia}`: situação de cada credencial da instância, chave mascarada (`sk-…WXYZ`), modelo do bot, último erro e último teste. Aceita chave global ou token da instância.
- A Observabilidade testa sozinha as chaves sem sinal há 6 h (no máximo 6 em paralelo).
- **Limite:** a OpenAI não informa o saldo em dólares para chaves comuns; "sem crédito" só aparece quando acaba. Recomende ao cliente ligar a recarga automática ou um alerta de gasto na conta.
- O estado fica em memória: zera no restart (vira "Ainda sem uso nem teste" até a próxima resposta ou teste).

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
| Pausa e reativação manual | Serviço | Pelo painel ou `changeStatus`. **O cliente não acessa o painel** (seção 2): é feito pela nossa equipe. A equipe do cliente pausa a IA respondendo pelo WhatsApp |
| Ignorar grupos | Configuração | `groupsIgnore` da instância e/ou `ignoreJids: ["@g.us"]` |
| Falha técnica | Automático | Erro cru nunca vai ao cliente; ele recebe o `unknownMessage` (configure em PT-BR) ou nada |
| "Passa para uma pessoa quando o cliente pede" | **Só instrução do prompt** | Não há aviso para a equipe nem pausa automática no pedido. `#sair` (`keywordFinish`) com `keepOpen=false` apaga a sessão e a próxima mensagem abre outra, ou seja, a IA volta a responder |
| "Não inventa preços" | **Orientação** | O prompt instrui; não é garantia técnica |
| Se apresentar como assistente e não pedir dados sensíveis | **Orientação** | Depende do prompt de cada cliente |
| Vários números, cada um com sua IA | Automático | 1 instância por número, bot e credencial próprios. A visão de todos num painel é do operador |
| Agenda (consultar, marcar, remarcar, cancelar) | Automático com a Agenda ligada | Ferramentas do Chat Completions só na instância com a Agenda ligada (seção 18). Ainda **não validado com um número real** |
| Integrações (planilha, CRM, Google Calendar) | **Serviço sob medida** | Via webhook (`MESSAGES_UPSERT`, `OPENAI_CHANGE_STATUS`) e n8n. O `functionUrl` e o modo Assistants **não estão disponíveis**: a OpenAI desligou a Assistants API em 26/08/2026. A Agenda exporta um feed ICS (somente leitura) para assinar no Google/Apple |
| Relatório mensal | **Serviço manual** | Não existe relatório automático. Fonte: uso do project key na OpenAI, sessões e Observabilidade |
| Contagem da franquia de respostas | Automático (desde 03/11/2026) | Contador por instância, dia e contato (seção 15). As mensagens em si continuam sem marcação de origem no banco |
| Monitoramento e alertas | Painel do operador | A Observabilidade mostra limites e alertas na tela (inclusive chave OpenAI sem crédito); não envia aviso por e-mail ou WhatsApp |
| Saúde da chave OpenAI do cliente | Automático (desde 10/11/2026) | Situação pela última resposta + teste ativo; sem saldo em dólares (seção 12.11) |
| Lembretes de consulta | Automático com a Agenda ligada | WhatsApp Web (Baileys). Na Cloud API só funcionam dentro da janela de 24 h (fora dela exigiriam template pago, não implementado) |
| Retenção de 90 dias | **Processo manual** | Não há expurgo automático (seção 7) |
| Acompanhamento de processos (DataJud/DJEN) | Automático, opcional (desde 09/11/2026) | Aviso à equipe por WhatsApp; ao cliente só a frase neutra, se ligado. Não é tempo real e não substitui os canais oficiais de intimação (seção 17) |
| Triagem de leads (ficha por conversa) | Automático (desde 04/11/2026) | Uma análise em segundo plano a partir da 3ª mensagem do cliente, com a chave OpenAI da instância; uso interno da equipe, nada vai ao cliente (seção 16) |
| Aviso de lead para a equipe | Configuração (desligado por padrão) | Uma mensagem de WhatsApp para os números da equipe, uma vez por lead (seção 16) |

Recomendações de produto, em ordem: (1) marcar no banco quais mensagens foram da IA e quais da equipe (contagem de franquia, relatório e auditoria); (2) quando o cliente pedir uma pessoa, pausar a sessão e avisar a equipe (mensagem para um número interno ou webhook); (3) relatório mensal gerado a partir dessa marcação; (4) expurgo automático pela retenção combinada no termo de tratamento de dados; (5) validar PDF e foto no gpt-6-luna e a pausa da Cloud API com um número em Coexistence; (6) acesso do cliente ao painel com o token da instância (Leads, Agenda e pausa por contato, sem as páginas globais), que o site já sugere como "um painel só"; (7) aviso por WhatsApp ao operador quando um alerta crítico aparece (chave sem crédito, franquia esgotada, instância desconectada).

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
| `get_usage` | leitura | Uso do plano: respostas do mês e de hoje, franquia, excedente em blocos de 1.000, últimos 30 dias, contatos mascarados e limites (seção 15) |
| `update_limits` | escrita | Altera plano e limites (campos ausentes não mudam; `null` remove o limite). Marcada como destrutiva; devolve os valores anteriores |
| `list_processes` | leitura | Processos monitorados (DataJud): situação, última movimentação, novidades (seção 17) |
| `get_process` | leitura | Um processo com a capa, os avisos ligados e as últimas movimentações |
| `add_process` | escrita | Adiciona um processo pelo número CNJ (valida o dígito); não envia nada |
| `list_publications` | leitura | Intimações/publicações do DJEN das OABs acompanhadas |
| `sync_process` | escrita | Consulta o DataJud agora para um processo (1 por minuto) |
| `get_process_settings` | leitura | Configurações de Processos (ligado, intervalo, dias do DJEN, números da equipe) e as OABs acompanhadas |
| `update_process_settings` | escrita | Altera essas configurações (lista de números substitui a atual) e pode adicionar uma OAB. Devolve os valores anteriores |
| `list_leads` | leitura | Leads da instância (triagem): filtros por status (ou `aguardando`), área, prioridade, texto e data; ordem padrão prioridade alta e depois a maior espera; contagem por visão (seção 16) |
| `get_lead` | leitura | Ficha completa de um lead: resumo, prioridade e motivo, o que falta saber, próximo passo, parte contrária, documentos citados, origem, datas |
| `update_lead` | escrita | Altera status, prioridade, nome, área, cidade, próximo passo, resumo, parte contrária, advogado, o que falta saber. Cada campo alterado fica travado contra a IA. Marcada como destrutiva; devolve os valores anteriores |
| `get_lead_settings` | leitura | Configurações da triagem: análise ligada, áreas, modelo, avisos para a equipe |
| `update_lead_settings` | escrita | Altera essas configurações (campos ausentes não mudam). Marcada como destrutiva |
| `list_appointments` | leitura | Agendamentos da Agenda (padrão: hoje + 14 dias), filtro por contato |
| `get_free_slots` | leitura | Horários livres por tipo de atendimento |
| `create_appointment` | **envio** | Cria agendamento (só horário livre, salvo `outside_availability`) e envia a confirmação ao cliente (`notify_client`, padrão sim) |
| `update_appointment` | **envio** | Remarca (checa conflito e disponibilidade), confirma ou muda status, tipo e observação; avisa o cliente da remarcação (`notify_client`, padrão sim) |
| `cancel_appointment` | escrita | Cancela (status `cancelado`) e avisa o cliente (`notify_client`, padrão sim). Marcada como destrutiva |
| `get_agenda_settings` | leitura | Configurações da Agenda: horários, tipos, lembretes, permissões da IA, números da equipe |
| `update_agenda_settings` | escrita | Liga/desliga e altera a Agenda (listas substituem as atuais). Marcada como destrutiva; devolve os valores anteriores |
| `get_openai_health` | leitura | Chaves OpenAI de cada cliente: funcionando, sem crédito, inválida ou modelo indisponível, com o que fazer. `test=true` testa agora (custo ~US$ 0,00000002; 1 vez a cada 30 s por chave) |
| `get_database_info` | leitura | Cota de projetos do Neon (banco próprio por instância) e as últimas "acordadas" do banco com as consultas que as causaram. Responde da memória, sem consultar o banco (só chave global) |
| `list_credentials` | leitura | Chaves guardadas de cada instância (OpenAI, token, webhook, Dify, Chatwoot etc.) **sempre mascaradas** e se a instância usa a chave OpenAI global. Para ver um valor, use a página Chaves e credenciais (só chave global) |

Na coluna de remetente, `bot` só é identificado nos últimos 10 minutos (o banco não marca a origem das mensagens, seção 13); depois aparece como `me` (número da instância).

**Recursos:** os manuais (`README-WHATSAI.md` e `readmes/*.md`) como `whatsai://docs/<nome>`. **Prompts:** `resumo_do_dia` (resume as conversas de um dia) e `revisar_atendimento` (revisa a conversa de um contato e sugere uma resposta **sem enviar**).

### 14.3 Segurança e custo

- **Não existe no MCP:** apagar ou desconectar instância, reiniciar, apagar mensagens, SQL livre, variáveis de ambiente, criar ou ver chaves de API.
- **Envio e alterações:** as ferramentas de escrita vêm marcadas para o cliente pedir confirmação; `send_text_message` sai para o cliente de verdade e `update_bot_settings` substitui valores. Confirme sempre antes de aprovar. Enviar pelo MCP não marca a mensagem como da IA: para assumir a conversa, pause o bot do contato antes.
- **Chaves:** comparadas em tempo constante, nunca registradas em log nem devolvidas; a chave OpenAI, tokens, headers de webhook e senhas aparecem mascarados (`****1234`). Erros voltam como mensagem curta, sem detalhes internos.
- **Tentativas erradas:** 10 falhas de autenticação em 15 min pelo mesmo IP bloqueiam esse IP por até 15 min (429), em memória.
- **Custo zero de infraestrutura:** o MCP não cria tabela nem migração própria, nenhum cache de mídia ou mensagem em banco ou disco, nenhum job, timer ou ping (o Neon continua suspendendo sozinho). Cada chamada faz poucas consultas limitadas; resultados têm teto de tamanho; mídias acima do limite nem são baixadas. O SDK do MCP só é carregado na primeira chamada.

## 15. Plano e limites

A franquia de cada plano (Essencial 2.000, Profissional 5.000, Premium 10.000 respostas por mês; excedente R$ 49 por bloco de 1.000) agora é **medida automaticamente** e pode ser **aplicada** por instância. Painel: instância > **Plano e limites** (e a barra no fim da **Visão Geral**).

### 15.1 O que conta como uma resposta

- **Uma resposta** = cada vez que a IA responde uma mensagem (ou uma sequência de mensagens juntadas pelo `debounceTime`) do cliente. Uma resposta dividida em várias partes (`splitMessages`) conta **uma** vez.
- Conta só depois que a resposta saiu para o WhatsApp. Se a equipe assumiu antes de a primeira parte sair, não conta.
- **Não contam:** mensagens da equipe (celular, WhatsApp Web, Chatwoot), ecos do próprio bot e da Coexistence, envios pela API REST/MCP, o `unknownMessage` de falha da OpenAI e os avisos desta seção (fora do horário e limite).
- Os períodos seguem o fuso do horário de atendimento (padrão `America/Sao_Paulo`): "hoje" e "este mês" são os do relógio do cliente.
- Só o bot OpenAI é contado (é o único que os planos usam).

### 15.2 Limites e o que acontece

Sem plano configurado (nenhuma linha em `InstanceLimits`) **nada muda**: a IA responde como antes, e as respostas são contadas mesmo assim. A verificação acontece antes de qualquer chamada à OpenAI (inclusive transcrição), nesta ordem:

| Regra | Ao bater |
|---|---|
| Horário de atendimento: `always` (sempre), `inside` (IA só no horário), `outside` (IA só fora do horário; no horário a equipe atende) | A IA não responde. No modo `inside`, se houver **mensagem fora do horário**, ela vai **uma vez por dia por contato** |
| Limite por contato por dia | A IA não responde naquele contato até o dia seguinte |
| Limite por dia | A IA não responde ninguém até o dia seguinte |
| Franquia do mês, com a ação escolhida | `continue` (padrão, como no plano): responde e conta **excedente**; `pause`: para de responder até o mês virar; `message`: para e envia a **mensagem de limite** uma vez por dia por contato |

- Com a ação `message`, a mesma mensagem também é usada quando bate um limite diário.
- Faixa com fim antes do início passa da meia-noite (`["22:00","06:00"]` na segunda = segunda 22h até terça 6h). `24:00` só como fim. Até 4 faixas por dia pela API; o painel edita uma por dia (as extras são mantidas).
- A palavra de encerramento (`#sair`) continua funcionando com a IA bloqueada. Contato com pausa humana nunca recebe aviso.
- Avisos (fora do horário e limite) saem marcados como mensagem de bot (o eco não pausa a IA) e não contam como resposta.
- Excedente = respostas do mês acima da franquia **atual** (se a franquia mudar no meio do mês, o excedente é recalculado). Blocos = arredondado para cima em blocos de 1.000.
- **Falha segura:** se o banco não responder, a IA responde normalmente (a contagem daquela resposta pode se perder, com erro no log).

### 15.3 API

Mesmas guardas das outras rotas: chave global ou token da instância (header `apikey`).

```bash
# Ver os limites (defaults quando não configurado: tudo sem limite, continue, alerta 80%)
curl "$SERVER_URL/usage/limits/$INSTANCE" -H "apikey: $APIKEY"

# Salvar (campos ausentes não mudam; null remove o limite; um plano padrão sem monthlyResponses usa a franquia dele)
curl -X POST "$SERVER_URL/usage/limits/$INSTANCE" \
  -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{
    "planName": "Essencial",
    "dailyResponses": null,
    "perContactDailyResponses": 40,
    "overLimitAction": "continue",
    "alertPercent": 80,
    "businessHours": {
      "enabled": true, "mode": "inside", "timezone": "America/Sao_Paulo",
      "week": { "mon": [["09:00","18:00"]], "tue": [["09:00","18:00"]], "wed": [["09:00","18:00"]],
                "thu": [["09:00","18:00"]], "fri": [["09:00","18:00"]], "sat": [], "sun": [] }
    },
    "outsideHoursMessage": "Olá! Atendemos de segunda a sexta, das 9h às 18h. Respondemos assim que abrirmos."
  }'
# Resposta: { "limits": {...}, "previous": {... ou null} }. Erros de validação: 400 com as mensagens em português.

# Uso: mês (period, responses, limit, percent, excedente, blocks1000, estimatedBRL, status), hoje,
# last30Days [{day, responses}], topContactsToday (números mascarados, 5521•••••9723) e os limites
curl "$SERVER_URL/usage/summary/$INSTANCE" -H "apikey: $APIKEY"
```

| Campo | Valores |
|---|---|
| `planName` | `Essencial`, `Profissional`, `Premium`, `Personalizado` ou `null` |
| `monthlyResponses`, `dailyResponses`, `perContactDailyResponses` | inteiro >= 1 ou `null` (sem limite). Por contato não pode passar do diário |
| `overLimitAction` | `continue` (padrão), `pause`, `message` (exige `overLimitMessage`) |
| `overLimitMessage`, `outsideHoursMessage` | texto até 1.000 caracteres ou `null` |
| `alertPercent` | 1 a 100 (padrão 80) |
| `businessHours` | `{ enabled, mode: always\|inside\|outside, timezone (IANA), week: { sun..sat: [["HH:MM","HH:MM"]] } }` |

MCP: `get_usage` e `update_limits` (seção 14.2).

### 15.4 Observabilidade

Card **Plano e uso** na página Observabilidade: uma linha por instância com plano ou com respostas no mês. Entra nos **alertas** quando o mês passa do `alertPercent` da instância e fica crítico em 100% ("franquia esgotada", com o excedente nas notas). Não envia e-mail nem WhatsApp.

### 15.5 Armazenamento, custo e deploy

- Duas tabelas pequenas: `InstanceLimits` (uma linha opcional por instância) e `UsageCounter` (chave primária `instanceId + type + period + remoteJid`): uma linha por mês, uma por dia e uma por contato por dia. Cada resposta faz 3 upserts atômicos (`INSERT ... ON CONFLICT DO UPDATE SET responses = responses + 1`).
- Limpeza no próprio fluxo de escrita, no máximo uma vez por dia por instância: linhas por contato com mais de 7 dias e linhas por dia com mais de 90 dias. Linhas por mês ficam (12 por ano). Sem job, timer ou cron.
- Antes de cada resposta: limites em cache de memória por 30 s (salvar pelo painel/API vale na hora); sem limites de quantidade, nenhuma consulta aos contadores; com limites, uma consulta pela chave primária.
- Migration `20261103120000_add_usage_limits` (postgresql e mysql), **aditiva** (só cria tabelas); roda no start do container como as outras. Rollback: reverter o merge; as tabelas ficam e são ignoradas.
- O cache de limites e o controle da limpeza são por processo (vale para 1 réplica, como o resto do bot). Com mais réplicas, uma alteração pode levar até 30 s para valer nas outras.


## 16. Leads (triagem)

Cada conversa privada vira uma **ficha de triagem** para a equipe organizar os atendimentos: nome, área, cidade, resumo, prioridade (com o motivo), o que ainda falta saber, próximo passo, parte contrária, se já tem advogado, documentos citados e origem. Painel: instância > **Leads** (entre Conversas e Plano e limites); na Conversas, o painel do contato mostra a linha **Lead** (status e área, com link para a ficha).

**Uso interno.** Nada da ficha é enviado ao cliente. A única mensagem que a função envia é o aviso opcional para os números da equipe (desligado por padrão).

### 16.1 Como a ficha é preenchida

- **Quando:** depois que a IA responde (a resposta sai primeiro; a análise roda em segundo plano), se o contato mandou **3 ou mais mensagens** e: nunca foi analisado, ou chegaram **3 mensagens novas** do cliente desde a última análise, ou a ficha continua "novo" (pela IA) 24 h depois e há mensagem nova. Grupos e os números da equipe nunca viram lead.
- **O que é lido:** as últimas **30 mensagens** salvas da conversa (texto, legendas e transcrições já salvas; mídia nunca é baixada). Áudio que o bot transcreveu não fica salvo na mensagem: quando houver áudio sem transcrição, entram também as falas do cliente que estão no histórico da sessão do bot.
- **Uma chamada** Chat Completions com *structured output* (JSON schema) e a credencial OpenAI da própria instância; modelo = o do bot, ou o definido nas configurações. Tempo máximo 30 s, teto de tokens (600; 2.500 em modelos de raciocínio como gpt-6-luna). Se o modelo recusar o JSON schema, tenta uma vez no modo JSON.
- **Regras do prompt (PT-BR, triagem de escritório):** só o que o cliente disse ou confirmou, nunca dedução; **nunca** CPF, RG, CNH, CNPJ, PIS/NIT, número de benefício, de processo, dados bancários, cartão ou senha (e o servidor ainda apaga qualquer número com cara de documento que escape: 7+ dígitos, CPF, CNPJ, número CNJ; datas são mantidas); saúde só o mínimo para a área.
- **Não conta como resposta** do Plano e limites. É pulada quando os limites bloqueiam a IA (limites diários e franquia com `pause`/`message`); o horário de atendimento não bloqueia (a análise não fala com o cliente).
- **Falhas** só vão para o log; a mesma conversa não é tentada de novo por 10 minutos. O bot nunca é afetado.

### 16.2 Prioridade, status e "aguardando equipe" (regras, não nota da IA)

Não existe nota numérica de lead. A IA só relata fatos; o servidor aplica regras fixas:

| Campo | Regra |
|---|---|
| `priority` = `alta` | Só com fato explícito citado pelo cliente: prazo correndo, audiência marcada, intimação/citação, prisão, despejo/reintegração, corte ou suspensão de benefício/salário/serviço, liminar. `priorityReason` traz o fato e, quando o cliente disse a data, a contagem: "audiência em 13/11 (em 3 dias)", "(amanhã)", "Venceu há 5 dia(s): prazo de defesa" |
| `priority` = `normal` com fato | O fato urgente **já resolvido** segundo o cliente ("Já resolvido: energia cortada"), a **audiência que já passou** e a data a mais de 30 dias ("audiência em 26/02/2027 (daqui a 108 dias)"): fica visível, mas não ocupa o topo da fila |
| `priority` = `baixa` | Sem demanda jurídica (engano, propaganda, spam) ou área fora da lista do escritório (`Outro`) |
| `priority` = `normal` | O resto ("Sem prazo ou fato urgente informado") |
| `area` e `city` | A área é **classificada pelo assunto** descrito (conta de luz, banco, loja = Consumidor; demissão = Trabalhista; INSS/BPC = Previdenciário); null só quando o cliente ainda não disse o assunto. A cidade é gravada de um jeito só: município sem bairro, com erro de digitação corrigido pelos municípios do RJ ("Novo Iguaçu" e "Cabuçu, Nova Iguaçu" → "Nova Iguaçu"); fora do RJ fica com a UF ("Juiz de Fora - MG") |
| `status` | A IA só muda de `novo` para `qualificado`, quando há nome + área do escritório + (cidade ou necessidade jurídica clara). Nunca rebaixa e **nunca altera um status definido pela equipe** (`statusSource: manual`) |
| `missingInfo` | Primeiro o que falta entre nome, área e cidade; depois o que o modelo listou (ex.: "data da demissão", "tem contrato assinado?") |
| `awaitingHumanSince` | Lead aberto (`novo`/`qualificado`) e acionável (qualificado ou prioridade alta) sem resposta de uma pessoa da equipe depois da última mensagem do cliente. Termina quando alguém da equipe escreve na conversa ou quando o status muda para em atendimento, cliente ou descartado |

**Limitação do "aguardando equipe":** o banco não marca quem enviou cada mensagem (seção 13). A resposta da equipe é detectada pela **pausa humana do bot OpenAI** (mensagem `fromMe` que não é do bot, com `stopBotFromMe` ligado), o que inclui o celular, o WhatsApp Web e envios pela API/MCP. Respostas que não passam por esse caminho (Chatwoot, `stopBotFromMe` desligado, Cloud API sem Coexistence) não encerram a espera: mude o status para "Em atendimento". Depois de uma resposta da equipe, a espera só recomeça quando o bot voltar a responder (fim da pausa humana).

Campos editados pela equipe (painel, API ou MCP) ficam em `manualFields` e a IA não os altera mais.

### 16.3 Painel

- **Visões:** Todos · Aguardando equipe · Novos · Qualificados · Em atendimento · Clientes · Descartados, com contagem. **Filtro** (área, prioridade, período da última mensagem), **Ordenar** (padrão: prioridade alta primeiro e depois quem espera há mais tempo), busca por nome, cidade, resumo, parte contrária ou número.
- **Tabela:** Nome, Telefone (mascarado), Área, Cidade, Prioridade, Status (muda na própria linha), Aguardando ("Aguardando há 3 h") e Última mensagem.
- **Ficha (clique na linha):** resumo, falta saber, próximo passo, campos editáveis, documentos citados e quantidade de arquivos enviados, origem, datas, **"Abrir conversa"** e **"Abrir no WhatsApp"**. Com parte contrária informada aparece **"Verificar conflito de interesses"**.
- **Exportar planilha** (Excel, `.xlsx`): segue as visões, filtros e ordem da tela, até 5.000 linhas.
  - Aba **Leads**: nome limpo (sem emoji e sem CAIXA ALTA; contato sem número aparece como "Sem número (contato oculto)"), prioridade em vermelho quando alta, **"Aguardando equipe há"** ("4 d 7 h": âmbar acima de 24 h, vermelho acima de 3 dias), telefone que abre a conversa no WhatsApp, cidade padronizada, textos com quebra de linha, datas de verdade, filtros, cabeçalho e nome fixos, "Dias sem mensagem do cliente" (âmbar acima de 7 dias em aberto), "Falta saber" com "confirmar o nome" quando só há o nome do perfil, "Já tem advogado" com Sim/Não/Não informado. A coluna Origem só aparece quando algum contato tem origem.
  - Aba **Resumo** (abre primeiro, no formato de relatório: faixas por seção com "Indicador · Quantidade · O que fazer" e, no fim, os principais achados com recomendações calculados pelos números): o que precisa de atenção agora (aguardando a equipe, há mais de 24 h, há mais de 3 dias, alta em aberto, sem mensagem há mais de 7 dias), contagens por status, prioridade, área e cidade, **casos parecidos** (mesma parte contrária, ex.: várias reclamações contra a mesma concessionária) e a qualidade da ficha (sem área, sem cidade, nome não confirmado, sem próximo passo, sem número).
  - O CSV continua na API (`export.csv`) para integrações.
- **Analisar conversas anteriores:** conta antes (diálogo com a estimativa), depois analisa em segundo plano, 2 por vez, só conversas dos últimos 7/30/60 dias com 3+ mensagens do cliente e ainda sem análise (até 200 por vez). Uma execução por instância de cada vez.
- **Configurações:** análise automática, áreas do escritório (padrão: Trabalhista, Previdenciário (BPC/INSS), Família, Consumidor, Cível, Criminal, Outro), modelo e aviso para a equipe.

### 16.4 Aviso para a equipe (desligado por padrão)

Ligado nas configurações, com 1 a 5 números (DDI + DDD) e quando avisar (`qualificado`, `urgente` = prioridade alta, ou `ambos`). Vai **uma vez por lead** (`notifiedAt`), da própria instância, marcado como mensagem do bot (não pausa a IA daquela conversa):

```
Novo lead qualificado — Nome · Área · Cidade · prioridade alta (audiência em 12/11)
Resumo do caso.
Conversa: https://wa.me/55DDDNUMERO
```

Um número da equipe nunca vira lead, e o número do próprio cliente nunca recebe o aviso.

### 16.5 API

Mesmas guardas das outras rotas (chave global ou token da instância).

```bash
# Lista: status (novo|qualificado|em_atendimento|cliente|descartado|aguardando), area, priority (alta|normal|baixa),
# search, since (ISO), remoteJid, sort (priority|waiting|recent|created|name), page, pageSize (até 100)
curl "$SERVER_URL/leads/$INSTANCE?status=aguardando&sort=priority" -H "apikey: $APIKEY"
# Resposta: { total, page, pageSize, pages, sort, counts: { todos, aguardando, novo, ... }, leads: [...] }

curl "$SERVER_URL/leads/$INSTANCE/$LEAD_ID" -H "apikey: $APIKEY"

# Edição pela equipe (cada campo enviado fica travado contra a IA; status vira manual). Devolve { previous, lead }
curl -X PATCH "$SERVER_URL/leads/$INSTANCE/$LEAD_ID" -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{"status":"em_atendimento","nextStep":"Ligar na terça à tarde"}'
# Campos: status, priority, priorityReason, name, area, city, nextStep, summary, opposingParty, hasLawyer, missingInfo

curl "$SERVER_URL/leads/$INSTANCE/export.xlsx?status=aguardando" -H "apikey: $APIKEY" -o leads.xlsx   # planilha formatada
curl "$SERVER_URL/leads/$INSTANCE/export.csv?status=qualificado" -H "apikey: $APIKEY" -o leads.csv     # CSV para integrações

curl "$SERVER_URL/leads/settings/$INSTANCE" -H "apikey: $APIKEY"
curl -X POST "$SERVER_URL/leads/settings/$INSTANCE" -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{"enabled":true,"areas":["Trabalhista","Previdenciário (BPC/INSS)","Família","Consumidor","Cível"],
       "extractionModel":null,"notify":{"enabled":true,"numbers":["55DDDNUMERO"],"on":"ambos"}}'

# Conversas anteriores: dryRun só conta; sem dryRun inicia (201) e o GET mostra o progresso. 409 se já estiver rodando
curl -X POST "$SERVER_URL/leads/backfill/$INSTANCE" -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{"days":30,"max":50,"dryRun":true}'
curl "$SERVER_URL/leads/backfill/$INSTANCE" -H "apikey: $APIKEY"
```

MCP: `list_leads`, `get_lead`, `update_lead`, `get_lead_settings`, `update_lead_settings` (seção 14.2). Observabilidade: o card **Plano e uso** ganha uma linha por instância ("Leads · nome: X novos nas últimas 24 h, Y qualificados em 7 dias, Z aguardando equipe").

### 16.6 Custo e armazenamento

- **Por análise:** ~1,5 a 2,5 mil tokens de entrada (prompt ~900 + até 30 mensagens) e ~150 a 300 de saída (mais o raciocínio em modelos como gpt-6-luna). Em modelos do porte do gpt-4o-mini isso é menos de US$ 0,001 por análise; uma conversa típica tem 1 a 3 análises. O custo fica na conta OpenAI do cliente (a mesma chave do bot). Para baratear, defina nas configurações um modelo menor só para a triagem.
- **Banco:** `Lead` (uma linha por conversa, campos de tamanho fixo: resumo até 600 caracteres, listas até 8 itens) e `LeadSettings` (uma linha opcional por instância). Migration `20261104120000_add_leads` (postgresql e mysql), **aditiva**; roda no start do container. Rollback: reverter o merge; as tabelas ficam e são ignoradas.
- Cache de configurações (30 s), controle de análise em andamento, backoff de falhas e progresso da análise de conversas anteriores ficam em memória do processo (1 réplica, como o resto do bot).

### 16.7 LGPD e ética profissional (advocacia)

- **Base legal:** legítimo interesse do escritório em organizar o atendimento que o próprio titular iniciou e procedimentos preliminares a contrato a pedido do titular (LGPD art. 7º, V e IX). O escritório é o controlador; o WhatsAI é operador. Registre a finalidade no contrato e na política de privacidade do escritório.
- **Dados mínimos:** a ficha guarda só o necessário para a triagem; números de documento são proibidos no prompt e apagados no servidor; saúde só no nível da área do caso. A parte contrária é guardada para a **verificação de conflito de interesses** que o advogado deve fazer antes de aceitar o caso.
- **Retenção:** **não há expurgo automático** de leads (nem de mensagens, seção 7). A retenção configurável ainda não está implementada: exclua manualmente conforme o termo de tratamento de dados (os leads saem junto com a instância, `ON DELETE CASCADE`).
- **Linguagem para escritórios de advocacia:** apresente como **"organizar os atendimentos e a triagem"**, nunca como "captação de clientes". O Código de Ética e Disciplina da OAB (art. 7º) veda o oferecimento de serviços para captação de clientela, e o Provimento 205/2021 só admite publicidade informativa. O aviso para a equipe é interno; nada é enviado ao cliente automaticamente, e a análise não responde nem oferece serviço a ninguém.

## 17. Processos (DataJud e DJEN)

Acompanhamento dos processos do escritório: o sistema consulta os andamentos públicos no **DataJud** (CNJ) e as intimações/publicações no **DJEN** (Comunica PJe) pelo número da OAB, guarda o histórico e avisa a equipe pelo WhatsApp. Painel: instância > **Processos** (abas Processos, Publicações (DJEN) e Configurações). Vem **desligado** por instância.

### 17.1 Fontes e limites

| Fonte | O que traz | Acesso |
|---|---|---|
| DataJud (CNJ), API Pública | Capa (classe, assuntos, órgão julgador, ajuizamento) e movimentações (código, nome, data, complementos) | `POST https://api-publica.datajud.cnj.jus.br/api_publica_<tribunal>/_search`, header `Authorization: APIKey <chave pública>`. Chave vigente na [wiki do DataJud](https://datajud-wiki.cnj.jus.br/api-publica/acesso); variável `DATAJUD_API_KEY` (opcional: o código já tem a chave publicada em 04/11/2026; se o CNJ trocar, defina a nova no Render, sem deploy de código) |
| DJEN / Comunica PJe | Intimações, citações e editais publicados no Diário de Justiça Eletrônico Nacional: tribunal, processo, tipo, data, texto, link | `GET https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroOab=&ufOab=&dataDisponibilizacaoInicio=&dataDisponibilizacaoFim=`, sem chave ([Swagger](https://comunicaapi.pje.jus.br/swagger/index.html)) |

- **Não é tempo real.** O DataJud reflete o que cada tribunal envia ao CNJ e pode atrasar dias (a Portaria CNJ 374/2026 passou o envio para diário, com prazo de adequação). Uma consulta leva ~30 s. O DJEN publica a comunicação a partir das 00h do dia de disponibilização.
- **Segredo de justiça** não aparece no DataJud (o processo fica com o erro "Não encontrado no DataJud"). Processos marcados como segredo (automático quando o DataJud indica sigilo, ou pelo painel) nunca geram aviso ao cliente nem resposta da IA.
- **Número CNJ** (NNNNNNN-DD.AAAA.J.TR.OOOO): o dígito verificador (módulo 97) é conferido no painel e na API; o tribunal sai de J.TR (8.19 → TJRJ, 5.01 → TRT1, 4.02 → TRF2, 3 → STJ...). STF não está na API pública. Processo que subiu de instância (ex.: STJ) pode ter o tribunal trocado no painel.
- **DJEN fora do Brasil:** a API costuma responder **403** a servidores fora do Brasil (o Render está em Ohio). Se a OAB ficar com o erro "DJEN recusou o acesso (HTTP 403)", é bloqueio geográfico: o DataJud continua funcionando; para o DJEN, configure `DJEN_BASE_URL` com um repasse hospedado no Brasil (mesmo caminho `/api/v1/comunicacao`).
- **Termos de uso do DataJud (v1.2):** no máximo 120 requisições por minuto (aqui: 1 por vez, com pausa, 5 processos por rodada) e uso "não comercial" (item 3.3/3.8). O uso previsto é o escritório acompanhar os próprios processos; a revenda dos dados não é permitida. Avalie com o cliente.
- **Não substitui** os sistemas oficiais de intimação (PJe, Domicílio Judicial Eletrônico, DJEN, e-mails dos tribunais). O advogado continua conferindo os canais oficiais e contando prazos pela publicação oficial.

### 17.2 Avisos

- Só para itens **novos**: a primeira importação de um processo ou de uma OAB nunca avisa ninguém (fica tudo como visto).
- **Equipe** (números em Configurações): detalhe completo. Ex.: `Nova movimentação — Silva x Banco (TJRJ)` / `03/11/2026 · Juntada de Petição` / complemento; para o DJEN: `Nova intimação/publicação no DJEN — TJRJ · <processo>` / primeiras linhas / link.
- **Cliente** (desligado por padrão, por processo; só para o contato que a equipe vinculou ao processo, nunca por nome): **só a frase neutra** `Olá, {nome}. Houve uma atualização no seu processo. O escritório vai analisar e entrar em contato.` Nunca vai o conteúdo, prazos, decisões, valores ou chances; o modelo aceita apenas o campo `{nome}`. No máximo 1 aviso a cada 20 h por processo. Nunca em segredo de justiça.
- **Horário de silêncio** (padrão 20:00–08:00, `America/Sao_Paulo`): os avisos ficam guardados e saem quando o horário acaba. Se o WhatsApp estiver desconectado, tentam de novo; depois de 3 dias são descartados.
- Os avisos saem marcados como mensagem do bot (não pausam a IA).

### 17.3 IA

Desligado por padrão (**IA pode responder**, por processo, exige contato vinculado). Quando esse contato pergunta sobre "processo/andamento/novidade", o bot recebe um bloco curto só com as **datas** das últimas atualizações dos processos **desse** contato e a instrução de responder de forma neutra, sem interpretar, e oferecer encaminhar ao advogado. O bloco não fica no histórico. Nunca entra processo de outro cliente nem em segredo de justiça.

### 17.4 Rotinas, custo e cron

- Um temporizador interno roda a cada 5 min e só consulta o banco quando algo está vencido (`lastCheckedAt` mais antigo que **Consultar a cada**, padrão 6 h) ou depois de uma alteração pela API: o Neon pode continuar suspendendo. Lote pequeno (5 processos + 2 OABs por rodada), uma consulta externa por vez, timeouts, espera crescente em 429/5xx e o erro gravado no item. `PROCESSOS_TICKER=false` desliga o temporizador.
- **cron-job.org** (recomendado, porque o Render free dorme): crie um job `POST https://<url-da-api>/processos/tick` a cada 15 min com o header `apikey: <chave global>`. Ele faz o mesmo que o temporizador (e não repete se já estiver rodando). `?force=1` ignora o horário calculado.
- Migration `20261109120000_add_processos` (postgresql e mysql), **aditiva** (5 tabelas: `Process`, `ProcessMovement`, `OabWatch`, `Publication`, `ProcessSettings`).

### 17.5 LGPD

Os dados vêm de fontes públicas, mas são dados pessoais: o **escritório é o controlador** (decide quais processos acompanhar e quem é avisado); o WhatsAI é operador. Cadastre só processos de clientes do escritório, vincule o contato só com autorização do cliente e remova os processos encerrados (remover apaga as movimentações e desvincula as publicações).

### 17.6 API

Mesmas guardas das outras rotas (chave global ou token da instância). Erros em português.

| Ação | Rota |
|---|---|
| Listar (`view=all\|news\|archived`, `tribunal`, `from`, `to`, `q`) | `GET /processos/{instancia}` |
| Adicionar um (`numero`, `apelido`, `clientName`, `remoteJid`, `tribunalAlias`) | `POST /processos/{instancia}` |
| Adicionar vários (`lista`: texto colado, até 200) | `POST /processos/{instancia}/bulk` |
| Detalhe com movimentações / alterar / remover | `GET` / `PUT` / `DELETE /processos/{instancia}/{id}` |
| Sincronizar agora (1 por minuto por processo, 30 por hora) / marcar como visto | `POST /processos/{instancia}/{id}/sync` / `.../{id}/seen` |
| OABs | `GET` / `POST /processos/{instancia}/oab`, `PUT` / `DELETE .../oab/{oabId}` |
| Publicações (`unseen`, `tribunal`, `from`, `to`, `page`) / marcar vistas (`ids` ou `all`) | `GET /processos/{instancia}/publicacoes` / `POST .../publicacoes/seen` |
| Configurações | `GET` / `POST /processos/{instancia}/settings` |
| Contadores (badge) / CSV | `GET /processos/{instancia}/badge` / `GET .../export.csv` |
| Rodada (cron) | `POST /processos/tick` (só chave global) |

```bash
curl -X POST "$SERVER_URL/processos/$INSTANCE/settings" -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{ "enabled": true, "checkEveryHours": 6, "notifyNumbers": ["5521999990000"],
        "quietHours": { "enabled": true, "start": "20:00", "end": "08:00", "timezone": "America/Sao_Paulo" } }'
curl -X POST "$SERVER_URL/processos/$INSTANCE/oab" -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{ "numeroOab": "123456", "ufOab": "RJ", "label": "Dra. Fulana" }'
```

MCP: `list_processes`, `get_process`, `add_process`, `list_publications`, `sync_process`, `get_process_settings`, `update_process_settings`.

**O escritório precisa informar:** número(s) e UF da OAB de cada advogado (e as variações com letra, se houver), a lista de processos (pode colar como vier), os números da equipe que recebem avisos, e, para cada processo em que o cliente deve ser avisado ou a IA pode responder, o WhatsApp do cliente (com a autorização dele).

## 18. Agenda

Agenda própria do WhatsAI, por instância: a IA consulta horários e agenda pelo WhatsApp, a equipe opera pelo painel (instância > **Agenda**) e o escritório pode assinar um calendário somente leitura. **Desligada por padrão**: sem ligar, nada muda (sem ferramentas na IA, sem lembretes, sem tratamento de "1"/"2"). Não usa Google Calendar.

### 18.1 Como a IA agenda

- Com a Agenda ligada, cada resposta do bot OpenAI (`chatCompletion`) recebe uma nota curta de sistema (data e hora atuais no fuso da agenda, tipos de atendimento, regras) e as ferramentas: `consultar_horarios(data_inicio?, dias?, tipo?)` (até 6 horários, ex. "qui, 07/11 às 14:00"), `meus_agendamentos()`, `agendar(inicio_iso, tipo, nome?)`, `remarcar(agendamento, novo_inicio_iso)` e `cancelar(agendamento)` (`agendamento` = id ou `proximo`). Agendar, remarcar e cancelar só aparecem se permitidos nas configurações.
- **Permissões (no servidor, não só no prompt)**, em `aiPermissions`: `allowBook`, `allowReschedule`, `allowCancel` (padrão ligados; desligado = a ferramenta nem é oferecida e, se o modelo tentar mesmo assim, o servidor recusa com `sem_permissao` e a IA diz que a equipe vai cuidar disso); `onlyOwnAppointments` (sempre ligado, não configurável: o contato só vê e altera agendamentos do próprio número); `requireTeamApproval` (padrão desligado; ligado = o pedido da IA vira `pendente`, segura o horário, não recebe lembrete, a equipe aprova no painel e só então o cliente recebe a confirmação); `showOtherEventDetails` (padrão desligado = a IA só vê horários livres; ligado = também horário e tipo dos outros agendamentos, nunca nome, número ou observações).
- **Provedor:** `provider` = `internal` (a agenda do WhatsAI, único hoje). Todo acesso aos agendamentos passa pela interface `AgendaProvider` (`src/api/services/agenda.provider.ts`: `getBusy`, `createEvent`, `updateEvent`, `cancelEvent`, `listOwnEvents`), onde o Google Calendar vai entrar como outro provedor.
- Regras da nota: confirmar dia, hora e tipo com o cliente antes de agendar; nunca inventar horários; só ver os agendamentos do próprio contato; se nenhum horário servir, oferecer os próximos ou dizer que a equipe vai entrar em contato; sem valores, sem promessa de resultado, sem orientação jurídica.
- **Validação no servidor:** o horário pedido pelo modelo é conferido de novo na hora (disponibilidade, bloqueios, antecedência mínima, dias à frente, intervalo e outros agendamentos). Agendar é idempotente por contato + horário. A IA pode manter no máximo 2 agendamentos futuros por contato. As ferramentas só enxergam o contato da conversa (telefone ou LID).
- **Laço limitado:** no máximo 3 rodadas de ferramentas por resposta; a última chamada proíbe ferramentas e sempre devolve texto. Uma resposta com ferramentas conta **uma** resposta do plano (seção 15), como qualquer outra. Pausa humana e limites valem igual (a verificação acontece antes).
- **Modelo sem ferramentas:** se a OpenAI recusar `tools` (400), a resposta sai sem a Agenda e o modelo fica memorizado (por processo) para não tentar de novo.
- **Mensagens automáticas ao cliente** (política do dono): só a confirmação do agendamento feito pela equipe (dia, hora, tipo, endereço ou link), os lembretes, as respostas de confirmação/cancelamento/remarcação e o "o que levar" do tipo de atendimento. Nunca preços, nunca promessa, nunca para quem não agendou. A confirmação de um agendamento feito pela IA é a própria resposta da IA.

### 18.2 Lembretes e confirmação

- Padrão: 24 h e 2 h antes (até 3 lembretes, de 1 a 72 h), com "Responda 1 para confirmar ou 2 para remarcar/cancelar" (desligável). Agendamento já confirmado recebe só "Se precisar remarcar ou cancelar, responda 2".
- **Horário de silêncio:** nunca entre 21h e 8h (fuso da agenda). Se o lembrete cairia nesse intervalo e o atendimento é antes das 10h, ele vai na véspera às 20h; senão, às 8h. Lembretes a menos de 1 h um do outro saem uma vez; os que cairiam antes do agendamento ser feito não saem; com menos de 30 min para o início, não sai mais.
- **Resposta ao lembrete:** só a **primeira** mensagem do contato depois do lembrete (até 24 h) é tratada: "1", "confirmo", "sim" confirmam (status `confirmado`, resposta automática, sem chamar a OpenAI e sem contar resposta do plano); "2", "remarcar", "cancelar" vão para a IA com uma nota para ela perguntar e usar as ferramentas (sem permissão: resposta automática e aviso à equipe). Qualquer outra mensagem segue para a IA normalmente. Funciona só com o bot OpenAI respondendo o contato (contato em pausa humana não é tratado).
- **Motor:** um ticker no próprio processo (a cada 60 s, uma execução por vez) que só consulta o banco quando há lembrete devido; sem nada pendente consulta no máximo a cada 6 h, então o Neon continua dormindo. Idempotente por `remindersSent` (envio repetido não acontece). Instância desconectada: tenta de novo no minuto seguinte.
- **Render free dormindo:** crie um job no cron-job.org: `POST https://<url-da-api>/agenda/tick`, header `apikey: <chave global>`, a cada 5 min (pode ser o mesmo job do keep-alive se ele aceitar POST; senão um segundo job). Resposta: `{ checked, sent, skipped, failed, waiting, nextRunAt }`. Só a chave global é aceita.
- **Avisos à equipe:** novo, remarcado e cancelado pela IA ou pelo MCP, e pedido de remarcar/cancelar sem permissão da IA, vão para os números da equipe da Agenda; se a lista estiver vazia, usa os números dos avisos de Leads (quando esse recurso estiver instalado e ligado). Agendamentos feitos pelo painel não geram aviso.
- **Cloud API:** fora da janela de 24 h a Meta exige template pago (não implementado): o envio falha e fica registrado como `ok: false`.

### 18.3 Painel

Instância > **Agenda**: semana (segunda a domingo, horários livres, fora do expediente hachurado, bloqueios) e lista, navegação por semana (por dia no celular) e "Hoje". Clicar num horário vazio abre **Novo agendamento** (busca nas conversas ou número, tipo, data e hora no fuso da agenda, observações internas, enviar confirmação). Clicar num agendamento abre o painel lateral: status, remarcar (com aviso opcional ao cliente), observações, cancelar, **Abrir conversa** e **Abrir no WhatsApp**. **Configurações**: ligar, fuso, intervalo entre horários, pausa entre atendimentos, antecedência mínima, dias à frente, disponibilidade por dia (até 2 faixas, "Copiar para todos"), datas bloqueadas (dia inteiro ou faixa), tipos de atendimento (nome, duração, modo presencial/online/telefone, endereço ou link, o que levar), lembretes, pedido de confirmação, permissões da IA, números da equipe e link do calendário. A equipe pode marcar fora da disponibilidade, mas nunca sobrepor outro agendamento.

### 18.4 Calendário (ICS)

Em Configurações > Calendário, **Gerar link do calendário** cria `https://<url-da-api>/agenda/ics/<token>.ics` (token aleatório de 48 caracteres). Assine no Google Calendar (Outras agendas > Do URL), Apple Calendar (Arquivo > Nova assinatura) ou Outlook. Somente leitura, 30 dias para trás e 180 para frente; mostra tipo, nome curto, telefone, modo e local; **nunca as observações internas** (sigilo). O Google atualiza assinaturas em algumas horas (não é imediato). Quem tiver o link vê nomes e telefones: trate como senha; **Gerar link novo** invalida o anterior. Com a chave da instância: `GET /agenda/:instancia/export.ics`.

### 18.5 API

Mesmas guardas das outras rotas (chave global ou token da instância), exceto `POST /agenda/tick` (só chave global) e o ICS por token (público, o token é a credencial).

```bash
# Ligar e configurar (campos ausentes não mudam; listas substituem as atuais)
curl -X POST "$SERVER_URL/agenda/settings/$INSTANCE" -H "apikey: $APIKEY" -H "Content-Type: application/json" -d '{
  "enabled": true, "timezone": "America/Sao_Paulo", "slotMinutes": 30, "bufferMinutes": 0,
  "minNoticeHours": 2, "maxDaysAhead": 30,
  "availability": { "mon": [["09:00","12:00"],["14:00","18:00"]], "tue": [["09:00","12:00"],["14:00","18:00"]],
                    "wed": [["09:00","12:00"],["14:00","18:00"]], "thu": [["09:00","12:00"],["14:00","18:00"]],
                    "fri": [["09:00","12:00"],["14:00","18:00"]], "sat": [], "sun": [] },
  "blocks": [{ "start": "2026-12-24", "end": "2027-01-02", "reason": "Recesso" }],
  "appointmentTypes": [{ "name": "Atendimento inicial", "minutes": 30, "mode": "presencial",
                         "location": "Endereço do escritório", "instructions": "Documento com foto" }],
  "reminders": { "enabled": true, "hoursBefore": [24, 2] }, "confirmation": { "enabled": true },
  "aiPermissions": { "allowBook": true, "allowReschedule": true, "allowCancel": true,
                    "requireTeamApproval": false, "showOtherEventDetails": false },
  "notifyNumbers": ["5521999999999"] }'

curl "$SERVER_URL/agenda/$INSTANCE?from=2026-11-09&to=2026-11-16" -H "apikey: $APIKEY"          # lista (contact=, status=)
curl "$SERVER_URL/agenda/$INSTANCE/slots?from=2026-11-10&days=7&type=Atendimento%20inicial" -H "apikey: $APIKEY"
curl -X POST "$SERVER_URL/agenda/$INSTANCE" -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{"number":"5521999999999","contactName":"Maria","typeName":"Atendimento inicial","startsAt":"2026-11-12T14:00","notifyClient":true}'
curl -X PATCH "$SERVER_URL/agenda/$INSTANCE/<id>" -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{"status":"realizado"}'            # ou {"startsAt":"2026-11-13T10:00","notifyClient":true} / {"notes":"..."}
curl -X DELETE "$SERVER_URL/agenda/$INSTANCE/<id>?notifyClient=true" -H "apikey: $APIKEY"     # status cancelado
curl -X POST "$SERVER_URL/agenda/settings/$INSTANCE/ics-token" -H "apikey: $APIKEY"           # novo link ICS
curl -X POST "$SERVER_URL/agenda/tick" -H "apikey: $CHAVE_GLOBAL"
```

`startsAt` sem fuso é lido no fuso da agenda. Status: `pendente` (pedido da IA aguardando a equipe), `agendado`, `confirmado`, `cancelado`, `realizado`, `faltou`. Aprovar: `PATCH {"status":"agendado","notifyClient":true}`. Origem: `ia`, `manual`, `mcp`. MCP: seção 14.2.

### 18.6 Limites, segurança e deploy

- Sobreposição impedida numa transação: a linha de `AgendaSettings` da instância é travada (update) antes de conferir e gravar, então duas marcações simultâneas nunca pegam o mesmo horário (PostgreSQL e MySQL). Sem constraint de exclusão (exigiria a extensão `btree_gist`).
- Horários gravados em UTC (`timestamptz`); disponibilidade, bloqueios, silêncio e textos no fuso da agenda, com horário de verão (um horário que não existe no dia da mudança é pulado).
- Duas tabelas: `AgendaSettings` (uma linha opcional por instância) e `Appointment` (índices `instanceId+startsAt`, `instanceId+remoteJid+startsAt`, `status+startsAt`). Migration `20261104130000_add_agenda` (postgresql e mysql), **aditiva**; roda no start do container. Rollback: reverter o merge; as tabelas ficam e são ignoradas.
- O cache das configurações (30 s), o ticker e a memória de modelos sem ferramentas são por processo (1 réplica, como o resto do bot).
- **Banco próprio por instância** (`docs/arquitetura/banco-por-instancia.md`): as tabelas da Agenda ficam no banco da instância. O ticker consulta o banco principal e cada banco próprio com a Agenda ligada; um banco próprio com a Agenda desligada não é consultado de novo (pode dormir). Sem nada pendente, o ticker volta ao banco no máximo a cada 6 h.
- **A validar em produção** antes de vender como pronto: agendamento real pela IA com o modelo do bot (gpt-6-luna) e lembretes num número de teste.
