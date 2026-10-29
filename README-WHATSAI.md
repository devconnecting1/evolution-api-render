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

Dados necessários: nome da instância (slug, ex. `escritorio-silva`), número E.164 (`5521...`), plano, chave OpenAI **do cliente** (Base) ou project/key do add-on, informações do negócio para o prompt.

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

Valores em BRL. **Setup** = implantação; **mensal** = operação. Preço âncora: cobre valor (um atendente custa R$ 2.000+/mês), não hora.

### 6.1 Advocacia — API oficial (Cloud API)

Conexão oficial da Meta, **via token**. Exige Meta Business verificado (CNPJ), WABA, número dedicado, Phone Number ID, token permanente, webhook e cartão **do cliente** na Meta. **A Meta é sempre paga pelo cliente**, direto na WABA; não entra na mensalidade. A OpenAI pode ser do cliente (Base) ou add-on pago pela WhatsAI.

Premissas: 1.000 mensagens de serviço grátis por número/mês; excedente ~US$ 0,0068 (~R$ 0,037) no Brasil (out/2026); ~5 respostas do bot por conversa; OpenAI ~R$ 0,03/conversa (estimativa conservadora). A conta da Meta é do cliente; confirme o rate card antes de fechar.

| Plano | Setup | Mensal | Escopo e franquia |
|---|---|---|---|
| **Start Oficial** | R$ 1.997 | R$ 447 | 1 número; FAQ, qualificação básica e handoff; **1.000 conversas/mês** de escopo; Meta: cliente paga direto; OpenAI do cliente; 1 h de ajustes/mês; SLA 24 h úteis |
| **Pro Oficial** | R$ 2.997 | R$ 897 | Start + triagem estruturada, documentos por link, agendamento/lembrete, 1 integração; **3.000 conversas/mês**; Meta: cliente paga direto; OpenAI do cliente; 2 h/mês; relatório; SLA 8 h úteis |
| **Premium Oficial** | R$ 5.497 | R$ 1.597 | Pro + RAG/base de conhecimento, CRM/ERP via n8n, até 3 números; **8.000 conversas/mês**; Meta: cliente paga direto; OpenAI do cliente; 4 h/mês; reunião mensal; SLA 4 h úteis |

- **Add-on OpenAI incluída:** +R$ 50 (Start), +R$ 100 (Pro) e +R$ 200 (Premium) no mensal. A WhatsAI paga a OpenAI dentro de um budget de proteção (US$ 10/25/60); excedente acima do budget é cobrado à parte ou o bot pausa.

| Plano | Base (OpenAI do cliente) | + OpenAI incluída |
|---|---|---|
| Start Oficial | R$ 447 | R$ 497 |
| Pro Oficial | R$ 897 | R$ 997 |
| Premium Oficial | R$ 1.597 | R$ 1.797 |

- **Excedente de escopo:** R$ 297 por +1.000 conversas (serviço). A Meta cobra o uso diretamente do cliente; não há repasse.
- **Áudio:** transcrição incluída até 300 min/mês; excedente ~US$ 0,006/min (~R$ 0,033).
- **Templates fora da janela de 24 h:** pagos pelo cliente direto à Meta (marketing ~US$ 0,0625); 2 templates inclusos no setup, extra R$ 300 (serviço).
- **Cartão da Meta:** sempre do cliente, cadastrado na WABA; a WhatsAI não paga Meta e não repassa.
- **Setup oficial:** inclui Meta Business, WABA, número, token, webhook, templates e testes.

### 6.2 Outros segmentos

| Segmento | Start (setup/mês) | Pro (setup/mês) | Premium (setup/mês) |
|---|---|---|---|
| Clínicas e consultórios | 2.297 / 497 | 3.497 / 997 | 6.497 / 1.797 |
| Imobiliárias | 2.497 / 547 | 3.997 / 1.097 | 7.497 / 1.997 |
| E-commerce | 2.997 / 697 | 4.497 / 1.197 | 8.497 / 2.297 |
| Infoprodutos | 2.297 / 547 | 3.497 / 997 | 6.497 / 1.797 |
| Serviços locais | 1.797 / 397 | 2.497 / 697 | 4.497 / 1.297 |

**Plano padrão de venda:** Pro. Ofereça Start só para ticket baixo e Premium para quem tem volume/CRM.

Valores já incluem a API oficial. A Meta é paga pelo cliente; a OpenAI pode ser add-on de +R$ 50/100/200 (seção 6.1). Volumes maiores: cote à parte.

### 6.3 Add-ons

| Item | Preço |
|---|---|
| Integração extra (Chatwoot, n8n, Dify, Flowise, CRM) | R$ 897 setup + R$ 197/mês |
| +1.000 conversas/mês | R$ 297 |
| Instância/número extra (inclui 1.000 conversas de escopo) | R$ 497 setup + R$ 297/mês |
| Add-on OpenAI incluída | +R$ 50/100/200/mês (Start/Pro/Premium) |
| Template Meta (criação/submissão; custo da Meta à parte) | R$ 300 |
| Hora extra de ajuste | R$ 250 |
| Setup express (48 h) | +30% |
| Treinamento extra (1 sessão) | R$ 500 |
| Migração de histórico | R$ 500 |

### 6.4 Custos e margem

| Item | Custo |
|---|---|
| Render free (atual) | R$ 0 |
| Render Starter (recomendado a partir de ~3 clientes) | ~R$ 40/mês |
| Neon free → Launch (a partir de ~3 clientes) | ~R$ 100/mês |
| Vercel + cron-job.org | R$ 0 |
| Vercel Pro (uso comercial) | ~US$ 20/mês (~R$ 110) |
| Domínio | ~R$ 40–80/ano |
| Backup externo (B2/S3) | ~US$ 1–6/mês |
| OpenAI `gpt-4o-mini` | ~R$ 0,01–0,05 por conversa (≈ R$ 10–50/1.000) |
| OpenAI (add-on) | ~R$ 30 / 90 / 240 por cliente no uso típico |
| OpenAI (cliente) | R$ 0 para o operador |
| Meta (cliente) | R$ 0 para o operador; o cliente paga ~R$ 148 / 518 / 1.443 no limite da franquia |
| Impostos/IOF (cartão internacional) | conforme fatura |
| Meta Cloud API (oficial) | 1.000 mensagens de serviço grátis/número/mês; excedente ~R$ 0,037/msg (US$ 0,0068) no Brasil; template marketing ~R$ 0,34 |

Regra: no **Oficial Base**, Meta e OpenAI são pagos pelo cliente; a margem bruta é alta (> 85%) e o custo relevante é suporte/infra. No **add-on OpenAI**, desconte ~R$ 30/90/240 do mensal no uso típico; o budget de proteção é US$ 10/25/60. Exemplo (Start Oficial + OpenAI): R$ 497 - R$ 30 = R$ 467 antes de infra/suporte; a Meta (~R$ 148) é paga pelo cliente. Com 3 clientes Start Oficial Base, a receita é ~R$ 1.341/mês; com add-on, ~R$ 1.491/mês.

Custo fixo do operador: hoje ~R$ 0 (free/Hobby); com 3–5 clientes ~R$ 150–250/mês; com 8–12 ~R$ 400–600/mês. No Oficial, a Meta é sempre do cliente; a OpenAI só é custo do operador no add-on.

### 6.5 Custo de IA (tokens) e capacidade

Referência do **GPT-6 Luna**: US$ 0,10/1M tokens de entrada e US$ 0,50/1M de saída (contexto 1,05M; saída máx. 128k; corte de conhecimento 18/05/2026). Se o modelo estiver liberado na conta OpenAI (cliente no Base, WhatsAI no add-on), use `model: "gpt-6-luna"` — o script aceita `OPENAI_MODEL`.

Premissas: prompt de sistema ~600 tokens, resposta do bot ~140 tokens, ~170 tokens novos por troca; US$ 1 ≈ R$ 5,50. Cada pessoa = 1 conversa no mês (quem volta várias vezes divide o número).

| Conversa | Custo aprox. | Pessoas com R$ 5/mês | Pessoas com R$ 20/mês |
|---|---|---|---|
| 5 trocas | R$ 0,005 | ~1.000 | ~4.000 |
| 10 trocas | R$ 0,012 | ~400 | ~1.700 |
| 20 trocas | R$ 0,032 | ~150 | ~600 |

- Áudio transcrito (`speechToText`): +~US$ 0,006/min (Whisper).
- `gpt-4o-mini` (US$ 0,15/1M entrada e US$ 0,60/1M saída) sai ~50% mais caro que o Luna.
- No **Oficial Base**, quem paga é a conta OpenAI do cliente (chave própria); no **add-on OpenAI incluída**, o custo entra no budget e é coberto pelo add-on/mensalidade. Acompanhe em OpenAI > Usage. A Meta é sempre paga pelo cliente.

### 6.6 Política comercial

- Pagamento: 50% na assinatura + 50% na entrega; mensalidade todo dia 5.
- Fidelidade 6 meses; reajuste anual pelo IPCA; cancelamento com 30 dias de aviso + multa de 30% do saldo.
- Fair use: "conversa" = contato com inatividade > 24 h; mensagens ilimitadas dentro da franquia de conversas. Nos Oficiais, o excedente de conversas é cobrado como serviço; a Meta cobra o uso à parte, direto do cliente.
- **Oficial Base:** Meta e OpenAI pagos pelo cliente; add-on OpenAI disponível (+R$ 50/100/200); excedente de escopo R$ 297/+1.000 e templates fora da janela de 24 h pagos à Meta.
- Reajuste: nosso preço segue o IPCA; a Meta pode reajustar o que cobra do cliente diretamente, sem repasse nosso.
- Descontos: até 15% no plano anual; setup nunca gratuito (máx. 50% para os 2–3 primeiros cases).

### 6.7 Modelo Oficial — Meta sempre do cliente; OpenAI opcional

No modelo oficial, a Meta é **sempre paga pelo cliente**, direto na WABA. A OpenAI pode ser:
- **Base:** cliente usa a própria conta/project/key e paga a OpenAI direto.
- **Add-on OpenAI incluída:** a WhatsAI paga a OpenAI e cobra +R$ 50/100/200 no mensal.

**OpenAI — uma organização, um projeto por cliente:**
- **Base:** o cliente cria a organização/project/key e paga; você só configura a key na instância.
- **Add-on:** uma única conta/organização OpenAI com o cartão da WhatsAI (uma fatura só), **um project por cliente** e **uma project key por instância** (a Evolution recusa a mesma chave em duas instâncias).
- Budget mensal por project (add-on): Start US$ 10, Pro US$ 25, Premium US$ 60 (~R$ 55/140/330); alerta em 80% e hard cap. O hard cap é proteção: se estourar, o bot para — dimensione com folga e cobre excedente.
- O add-on cobre o uso típico; no limite superior, a margem do plano absorve a diferença e o budget é a proteção.
- Auto-recharge ligado (threshold US$ 20, recarga US$ 50) + cartão reserva.
- `maxTokens` por resposta, prompt enxuto e expiração de sessão para não estourar.
- Uso por projeto: OpenAI > Usage/Costs API (Admin key). Ideal: script que cria project, key e budget no onboarding do add-on.

**Nunca use uma única chave para todos:** perde rastreio por cliente, não revoga isolado, uma chave vazada compromete todos e a Evolution bloqueia chave repetida. A conta pode ser a mesma; a chave, não.

**Meta — uma WABA por cliente, cartão do cliente:**
- Uma WABA (e um número) por cliente; **não** uma WABA única para todos (qualidade, política, templates e identidade são por WABA; um cliente problemático derruba os demais).
- O cartão é **sempre do cliente**, cadastrado na WABA; a WhatsAI não paga Meta, não repassa e não usa o próprio cartão.
- Você configura a WABA, o número, o token, o webhook e os templates; o cliente aprova a verificação e o pagamento.
- Controle: billing threshold/alerta no WhatsApp Manager do cliente; franquia de escopo no contrato; conciliação mensal.
- Escala (10–20+): virar **Meta Tech Provider** e usar Embedded Signup para onboarding. Fatura consolidada via BSP só se o cliente quiser; o BSP adiciona taxa por mensagem e pode exigir outra integração.

| Provedor | Unidade de cobrança | Quem paga | Como limitar | Como monitorar |
|---|---|---|---|---|
| OpenAI Base | project/cliente | cliente | budget do cliente | Usage/Costs API |
| OpenAI add-on | project/cliente | WhatsAI | budget mensal + `maxTokens` | Usage/Costs API |
| Meta | WABA/número | cliente | billing threshold | WhatsApp Manager > Billing |
| Infra | conta única | WhatsAI | plano | Render/Neon/Vercel |

**Automação:** OpenAI Admin API (project/key/budget) só no add-on; Embedded Signup (Meta) para onboarding; Asaas/Stripe para a mensalidade. A cobrança da Meta é sempre no cartão do cliente.

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
| Bot parou de responder a um contato (Baileys) | Provável pausa humana: `GET /openai/fetchSessions/{openaiId}/{instancia}`, procurar `status: paused` (e `parameters.humanLastMessageAt`); reative com `POST /openai/changeStatus/{instancia}` (`opened`). Ver seção 12.2 |
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
