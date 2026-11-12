# UI/UX do painel: leitura contra Twenty CRM e ERPNext

> Análise de 11/11/2026, baseada no bundle patchado (`manager/dist`), nos 38 patches, nas 22 capturas de
> `docs/images/projeto/` e na documentação atual do Twenty e do ERPNext/Frappe. Capturas com dados fictícios.

## Veredito

- **Parece Twenty na superfície, não na arquitetura.** O painel apropria bem a view bar, a densidade de 36 px, o
  painel lateral, os breadcrumbs e o Ctrl K; não existe motor de views, metadata de objetos nem biblioteca
  compartilhada. A única view salva fica em `localStorage`.
- **Parece pouco ERPNext.** Há ecos de lista com filtros, abas e timeline (Processos), mas não há DocTypes,
  Report Builder, kanban/calendário genéricos nem permissão por documento. Para um SaaS vertical de atendimento
  jurídico, isso não é uma falha.
- **O que é só do WhatsAI é o melhor:** portal do cliente, retenção LGPD, cofre de credenciais, observabilidade
  por instância e agenda jurídica. A direção visual está certa; falta acabamento e consistência, não troca de rumo.

## O que o painel já tem

- Shell único com sidebar fixa, drawer abaixo de 1024 px e tema Sistema/Claro/Escuro com script pré-paint
  (`manager/patches/app-shell.py`, `theme.py`, `responsive.py`).
- Tokens `--m-*` com pares claro/escuro, fonte Geist, raios de 4/8 px e cor semântica (verde ok, âmbar atenção,
  vermelho erro). É o ponto mais sólido.
- Padrão Twenty-like: view bar com contagem, filtro, ordenação e chips; tabela densa; painel lateral de registro;
  abas navegáveis por teclado; breadcrumbs; command menu Ctrl K.
- Formulários com boa validação em Agenda, Plano e limites e cofre de credenciais (`role=alert`, `aria-invalid`,
  `aria-describedby`, erros inline). O padrão não é uniforme nas demais telas.
- Skeletons, estados vazios e erros existem, mas `aria-live` só aparece em dois pontos.
- Acessibilidade acima da média: `focus-visible`, foco devolvido em menus/diálogos, `aria-current`,
  `aria-expanded`, `aria-modal`, labels e tabelas com caption/scope. Faltam skip link, um `<main>` consistente e
  `document.title` por rota.

## Comparação

| Padrão | WhatsAI | Twenty CRM | ERPNext/Frappe |
|---|---|---|---|
| Shell/navegação | Sidebar fixa, drawer, tema, command menu nas páginas de instância | Sidebar com favoritos e busca; command menu global | Desk por módulos, busca e atalhos |
| Lista | Tabela densa de 36 px, seleção, colunas configuráveis | Views de objeto: tabela, kanban, calendário | List View com filtros, tags, paginação |
| Registro | Painel lateral; página de instância com abas | Side panel e página completa com abas/widgets | Form View com timeline, atribuição, anexos |
| Formulário | Feito à mão por página; validação desigual | Gerado por metadata, layout configurável | Gerado do DocType |
| Views/filtros | 4 views fixas, filtro/ordenação, 1 view salva em `localStorage` | Views ilimitadas, salvas, privadas ou compartilhadas | Filtros salvos; Report Builder |
| Command menu | Ctrl K só em instâncias; busca conversas e páginas fixas | Ctrl K global para busca e ações | Sem command palette equivalente |
| Metadata-driven | Não | Objetos/campos configuráveis | DocTypes dirigem listas, forms e relatórios |
| Relatórios | Observabilidade e uso, específicos do produto | Dashboards/widgets | Report Builder genérico |
| Mobile | Drawer, chat de um painel, sheets; tabelas problemáticas | Responsivo | Desk responsivo limitado |
| Acessibilidade | Forte em foco/ARIA; faltam skip link, títulos e motion em 5 CSS | Design system com primitives acessíveis | Razoável, com legado |
| Componentização | 38 patches, CSS por página, primitivas duplicadas | `twenty-ui` próprio + tokens CSS | Frappe UI (Vue 3 + Tailwind) + Desk legado |

Observação: o Twenty usa a biblioteca própria `twenty-ui`, não shadcn/Radix. O WhatsAI também não usa shadcn como
base; o bundle herdado do Evolution usa Tailwind/Radix e foi re-tematizado por cima.

## Recomendações

### P0 - corrigir agora (baixo custo)

1. Botão primário do login no escuro: trocar `color:#fff` por um token de contraste e remover o hover fixo
   (`manager/dist/assets/home.css`); validar com captura escura.
2. Ícone do estado vazio de Conversas no escuro: substituir `#8a9592` por `var(--m-text-3)`
   (`manager/dist/assets/chat-ui.css`).
3. Corte da última coluna em 1440 px em Instâncias ("Dono") e Leads; ajustar `min-width`/grid ou fixar a última
   coluna.
4. Navegação acessível: skip link, um único `<main>` e `document.title` por rota.
5. `prefers-reduced-motion` nos CSS de leads, processos, usage-limits, credentials-vault e dashboard.

### P1 - consistência e acabamento

6. Tabelas no celular: affordance de rolagem (sombra/fade ou dica "arraste") e primeira coluna fixa.
7. Estados padronizados: um vocabulário único de vazio/carregando/erro e `aria-live` em atualizações de tabela,
   salvamentos e toasts.
8. Auditoria de formulários: `aria-invalid`, erro inline e hint com `aria-describedby` em todas as telas, usando
   Agenda e Plano/limites como referência.
9. Command menu global no shell, com ações (novo lead, pausar IA, abrir configurações), não só conversas e páginas.
10. Observabilidade nos tokens `--m-*`, eliminando a camada `--obs-*`/HSL.
11. Consolidar CSS e patches: reduzir as 21 folhas e os aliases `--wo-*`/`--wa-*`/`--wc-*`, criar manifesto/apply-all
    e rodar `--check` de todos no CI. Custo médio-alto; exige rodada completa de capturas.

### P2 - maior investimento

12. Views salvas no servidor e compartilháveis: exige tabela nova e migration aditiva nos três schemas, além de API.
    Mudança em `prisma/`/`src/` reinicia a API (~4 min); em horário comercial, só com OK do dono.
13. Harness de regressão visual com Playwright, API simulada e dados fictícios em 390/768/1024/1440 px, claro e
    escuro, comparando o `dist` patchado.
14. Primitivas compartilhadas (`Table`, `ViewBar`, `SidePanel`, `Field`, `Dialog`, `EmptyState`, `Toast`) para
    eliminar a duplicação entre `WaUt`, `WaTw`, `WaLeads`, `WaProc` e `WaAgenda`. Fazer por etapas.

## O que não vale copiar

- O motor metadata-driven do Twenty (objetos, campos, permissões, views configuráveis): virar CRM genérico dilui o
  produto e multiplica a manutenção no bundle patchado.
- DocTypes, permlevel, User Permissions e Report Builder do ERPNext: conceitos de plataforma corporativa que os
  escritórios não precisam ver.
- Reescrever o painel em React/shadcn: o sistema de patches + tokens já entrega o visual; reescrever é o maior custo
  desnecessário e o maior risco para a produção.
- Densidade cega: 36 px funciona no desktop, mas no celular os alvos precisam de pelo menos 44 px.
- Kanban, calendário e relatórios genéricos "porque o concorrente tem": só adicionar se houver fluxo jurídico real.
- Paletas por página ou selos/certificações não implementados.
