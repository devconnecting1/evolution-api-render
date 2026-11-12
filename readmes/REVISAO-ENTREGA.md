# Revisão da entrega do Artefato do Projeto (12/11/2026)

Roteiro para o agente de desenvolvimento (DeepSeek no Claude Code) corrigir o que a revisão encontrou nas 27
propostas. Feito pelo Claude Code do dono depois de comparar cada tela desenhada no artefato com a tela real.

## Onde ver

- Artefato atualizado: `Artefato do Projeto/index.html`, seção **"Entregue × proposto"** (âncora `#entrega`, logo
  no topo). Cada letra tem a proposta ao lado da tela de hoje, a nota de polimento e o que ajustar.
- Imagens da comparação: `Artefato do Projeto/entrega/prop-<letra>.jpg` (desenho) e `atual-<letra>.jpg` (tela real,
  dados fictícios).
- Resultado: 10 polidas (A, E, F, G, J, P, R, T, U, Z), 14 boas com ajustes (B, C, D, H, I, K, L, M, N, O, S, W, Y,
  AA) e 3 que divergem ou regrediram (Q, V, X).

## Regras para esta rodada

- Um PR por item abaixo, a partir de `origin/main`, no formato de `.github/pull_request_template.md`. Abra o PR e
  **pare**: o merge é do Claude Code do dono, depois da revisão (CLAUDE.md, "Fazer merge de PR sendo um agente que só
  desenvolve").
- Todo PR de painel leva captura antes/depois (1440 e 390 px, claro e escuro, dados fictícios) e o resultado do axe.
  Meta: **zero violações critical e serious** em todas as telas tocadas.
- Patches seguem o padrão de `manager/patches/*.py` (âncora exata, marcador, `--check`, `CACHE_VERSION` subindo o
  `?v=` do bundle). Depois de aplicar: `npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error
  --format=esm > /dev/null`.
- Nada de Baileys/conexão do WhatsApp. Nada de credenciais em código, commit ou PR. Contra produção, só GET.
- Linguagem: português simples, só a primeira letra maiúscula em rótulos, sem explicar a técnica para o cliente.

## 1. Acabamento do painel (baixo risco, só `manager/`)

Um PR, ou dois se ficar grande (acessibilidade separada do resto).

1. **Acessibilidade (Q regrediu de 0 para 4 problemas graves).** Medido com axe nas telas abaixo:
   - Instâncias no celular: botão `.wa-ut-new` ("+") sem nome acessível (critical). Dar `aria-label="Nova instância"`.
     Origem: `manager/patches/ui-tables.py`.
   - Menu de Ajuda `#wa-help-menu`: `ul`/`li` dentro de `role=menu` e links sem `role=menuitem` (critical).
     Origem: `manager/patches/help-menu.py` e `manager/dist/assets/help-shortcuts.js`. Usar `role=menu` com filhos
     `role=menuitem` diretos (ou `role=none` nos `li`), ou trocar por um popover sem papel de menu.
   - Botão "Buscar Ctrl K" `.wa-tw-kbd-btn`: o `aria-label` não contém o texto visível (serious). Remover o
     `aria-label` ou fazê-lo começar com "Buscar". Origem: `manager/patches/twenty-layout.py`. Já tinha sido
     corrigido no #84 e voltou.
   - "Desconectar" em Conexão, `.wa-portal-btn-danger`: contraste 4,42 (serious). Escurecer o vermelho no tema claro
     até 4,5 ou mais. Origem: `manager/dist/assets/client-portal.css`.
   - Moderados: Conversas no celular sem `h1`; Atendente IA com `h4` pulando nível.
2. **Uma central de notificações só (F + Y).** Hoje a página "Notificações" (leads aguardando, agendamentos
   pendentes, processos) e o sino (processos, uso do plano, agendamento) mostram coisas e números diferentes: 5 na
   lateral, 3 ou 4 no sino. Uma fonte só de itens, o mesmo número na lateral, no sino e na página. Tirar da página o
   texto técnico "ficam em memória por dois minutos; nada é consultado em segundo plano". Origem:
   `manager/patches/acabamento-listas.py`, `manager/patches/central-notificacoes.py` e `assets/central-notificacoes.js`.
3. **Rótulos com só a primeira maiúscula (L e N).** Ainda aparecem "Rejeitar Chamadas", "Ignorar Grupos", "Sempre
   Online", "Configurações Padrão", "Marcar Todos", "Desmarcar Todos" (e os demais de Comportamento). O próprio
   artefato riscou esses textos. Procurar a origem em `manager/patches/ptbr-only.py` e nas strings do bundle.
4. **Eventos (I).** "Enviar teste" só salva e valida a configuração. Renomear para "Salvar e validar" (e o texto ao
   lado), até existir um envio de teste real. Origem: `manager/patches/eventos-grupos.py`.
5. **Celular (K).** No cartão de lead, o chip de status cobre o "Aguardando há 1 h"; o "há 48 min" fica solto no meio
   em vez de alinhado à direita do nome. Na ficha do lead, os botões do topo têm alturas diferentes. Origem:
   `manager/patches/celular-listas.py` e `assets/celular-listas.css`, `assets/ficha-lead.css`.
6. **Visão Geral (D).** O quadro do topo gasta uma linha inteira só com o botão de atualizar e "Conexão": levar os dois
   para a linha do nome. Pôr "Hoje" (agenda e alertas) ao lado do gráfico no computador, como no desenho.
7. **Conversa (B).** "Assumir conversa" e "Pausar IA" no mesmo painel fazem quase a mesma coisa: deixar só "Assumir
   conversa" (que pausa a IA) e mostrar o estado da IA como texto.
8. **Cobrança (X, parte visual).** "Nenhuma cobrança registrada ainda" aparece duas vezes seguidas: título e texto
   diferentes, ou um só. (A parte de dados é o item 3.)
9. **Ajuda (W).** "Guia rápido" aponta para o repositório privado, que o cliente não abre: apontar para uma página
   pública (por exemplo `/novidades` ou uma página de ajuda no site) ou esconder para quem entra com código de cliente.

## 2. Segurança do login com Google (antes de ligar o recurso)

O recurso está desligado em produção (`/auth/google/status` responde `enabled:false`), então não há exposição hoje.
Corrigir antes de configurar o Google Cloud. Um PR, com testes.

1. **Alto.** `src/api/services/user-session.service.ts` (`resolve`, por volta das linhas 68-94) aceita a sessão só por
   existir, não estar revogada e não ter expirado. Tirar o e-mail de `GOOGLE_LOGIN_OWNER_EMAILS` ou desligar o
   recurso não derruba quem já entrou (até 30 dias). Recusar a sessão quando `!googleLogin.available()` ou quando o
   e-mail não está mais na lista; opcionalmente revogar essas sessões na subida.
2. **Médio.** Toda conta liberada vira dona de tudo (`src/api/guards/auth.guard.ts`, guard `apikey` e o de rotas só de
   administrador). Ligar ao papel da pessoa (item 4 abaixo) ou deixar explícito na tela e na doc que a lista é só de
   donos.
3. **Médio, funcional.** Com sessão do Google o painel não lista as instâncias: `fetchInstances`
   (`src/api/controllers/instance.controller.ts`, por volta da linha 418) compara o header cru com a chave global, e o
   WebSocket faz o mesmo (`src/api/integrations/event/websocket/websocket.controller.ts`, por volta da linha 58).
   Tratar `req.userSession` como a chave global nesses dois pontos.
4. **Baixo.** No guard de rotas só de administrador, checar `authThrottle.isBlocked(ip)` **antes** de consultar a
   sessão no banco (hoje um IP bloqueado ainda faz `userSession.findUnique`, o que pode acordar o Neon).
5. **Baixo.** `src/utils/google-login.ts` (por volta das linhas 161-162): exigir `aud === clientId`, `iss` permitido
   e checar `exp`.
6. **Baixo.** Erro no meio da exportação entrega um ZIP cortado com HTTP 200 (`src/api/routes/usage.router.ts`): com
   os cabeçalhos já enviados, chamar `res.destroy()`.
7. **Baixo.** O código de uso único volta na URL: `Referrer-Policy: no-referrer` na página de login e
   `history.replaceState` no painel depois de ler o código.
8. **Testes.** Cobrir a recusa de código de cliente (`wac_`) e de token de outra instância em `/usage/export`,
   `/overview` e `/team/*`.

## 3. X como o dono decidiu (cobrança manual e recibo de pessoa física)

O dono é desenvolvedor pessoa física. Decisão registrada: histórico de cobrança **manual** por instância e recibo
válido para o carnê-leão. Hoje `UsageController.getBilling` responde `source:"none"` e histórico vazio.

- Tabela `BillingEntry` (migration aditiva em `postgresql-migrations` **e** `mysql-migrations`, modelo nos três
  schemas, em `CONTROL_MODELS` para ficar no banco principal): `instanceId`, `period` (AAAA-MM), `amountCents`,
  `status` (`pago`, `pendente`, `atrasado`), `method` (`pix`, `boleto`, `transferencia`, `outro`), `paidAt`, `note`,
  `receiptNumber` (sequencial por prestador), `createdAt`, `updatedAt`.
- Rotas só de administrador para criar, editar e apagar lançamentos; `getBilling` passa a ler essa tabela
  (`source:"manual"`).
- Recibo imprimível (HTML com `@media print`) com nome, CPF e cidade do prestador vindos de `BILLING_PROVIDER_NAME`,
  `BILLING_PROVIDER_DOC` e `BILLING_PROVIDER_CITY` (variáveis do servidor, **nunca no código**; sem elas, a tela diz
  o que falta). Valor por extenso, período, data do pagamento e número do recibo.
- Painel: na aba Cobrança, lista de lançamentos, "Novo lançamento" para o administrador e "Recibo" em cada linha paga.
  No portal do cliente, só leitura e só quando o código tiver o módulo `plano`.
- Referência pronta para reaproveitar (não mesclar, foi feita sobre um main antigo):
  branch `wip/cobranca-manual-referencia` (`billing.service.ts`, `billing.router.ts`, migrations e a tela).

## 4. V como o dono decidiu (registro de ações e acesso por pessoa)

Decisão registrada: o Google fica para depois; agora, registro de ações e acesso por pessoa com papéis.

- **Etapa 1, registro de ações.** Tabela `AuditLog` (aditiva, dois bancos, três schemas): quando, quem (chave global,
  pessoa, código de cliente, token da instância), instância, ação, alvo e resultado. Middleware nas rotas que alteram
  dados. Página "Registro de ações" na área do administrador, com filtro por instância, pessoa e período, e exportação
  CSV. Sem gravar o conteúdo de mensagens nem segredos. Retenção configurável (padrão 180 dias).
- **Etapa 2, acesso por pessoa.** Chave por pessoa (prefixo próprio, guardada só como hash SHA-256), com papel
  **Dono** (igual à chave global), **Equipe** (atende, sem rotas de administrador: `/admin`, códigos de cliente,
  exportação, apagar ou desconectar instância) ou **Só leitura** (só GET). Regras no servidor, não só na tela.
  Revogar, último uso e página "Equipe". Aproveitar `User`/`UserSession` e dar papel a eles, para o Google entrar
  depois com os mesmos papéis.
- Referência (não mesclar): branch `wip/equipe-chaves-auditoria-referencia` (`audit-log.service.ts`,
  `audit.middleware.ts`, `team-access.service.ts`, migrations e a tela).

## 5. O, segunda etapa do site

O site está com 12 seções e 13.509 px no computador (20.182 px no celular). Meta do artefato: 6 seções e cerca de
8.500 px. Faltam o tour em abas (juntar Recursos e Como funciona) e o seletor de segmentos. Manter Geist, tema padrão
"Sistema", "triagem" em vez de "captação", sem depoimentos, números ou selos inventados e sem logos de terceiros.

## 6. Menores (podem ir junto de outro PR)

- H: seção "Horário de atendimento" no Atendente IA; com lista, seções e formulário, o notebook fica com três colunas
  apertadas.
- T: mostrar o código do erro e a hora, para mandar ao suporte, como no desenho.
- C: no celular, abrir Leads em Lista por padrão (o Quadro fica apertado).
- S: corte do bundle por página fica para quando mexer no build do fonte.

## Conferências depois de cada merge (Claude Code do dono)

Render `live` do último commit que mexeu em `src/`, `prisma/`, `Dockerfile` ou `render.yaml`; instância do WhatsApp
`open`; Vercel no `?v=` novo; axe sem critical e serious nas telas tocadas. Roteiro completo em
`readmes/HANDOFF-CLAUDE-CODE.md`.
