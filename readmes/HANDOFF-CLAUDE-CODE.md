# Handoff para o Claude Code do dono (Render, Neon, Vercel e WhatsAI)

Atualizado em 12/11/2026.

Este repositório é o WhatsAI. Os agentes que trabalham aqui nem sempre têm os MCPs autenticados. As conferências
que dependem de Render, Neon, Vercel ou WhatsAI ficam com o Claude Code do dono, que tem os MCPs. Este documento é
o roteiro para ele concluir e repetir a verificação.

## Estado em 12/11/2026

- 27/27 propostas do Artefato do Projeto mescladas (PRs #83 a #108).
- Documentação final no #109, comparação antes x depois no #111 e remoção do chip de limite no mobile no #110.
- O CI do GitHub é a porta de merge: `check-lint-and-build`, `unit-tests`, `integration-tests`, `manager-patches` e `Security`.
- Produção: painel na Vercel em `?v=70`; API 200; `/auth/google/status` 200 com `{"enabled":false}`.
- Artefato: `Artefato do Projeto/WhatsAI frente a Twenty e Frappe.md`.
- Comparação: `readmes/ARTEFATO-COMPARACAO.md`.

## Regras que não mudam

- Nunca imprimir, commitar ou publicar credenciais.
- Contra produção, só GET.
- Não deslogar nem parear o WhatsApp do cliente; não ligar `MESSAGE_RETENTION_DAYS`; não apagar dados.
- Merge só com as checagens do GitHub verdes; squash com mensagem explícita; `[skip render]` em mudança estática.
- Não rodar a suíte local antes do push; o GitHub Actions roda.
- A IA não fala de gratuidade, preço, honorários ou autoelogio (perfil `ethicsProfile: "advocacia"`).

## Como usar os MCPs

- No seu Claude Code, rode `/mcp` e autentique Render, Neon, Vercel e WhatsAI.
- Se o OAuth do Render pedir retorno em `localhost` e a página falhar, copie a URL completa da barra de endereços
  (`http://localhost:<porta>/callback?code=...&state=...`) e conclua com `complete_authentication`.
- Não cole tokens no chat; use o OAuth do MCP.
- Se um MCP não estiver disponível, registre a pendência no PR e siga com as conferências públicas por GET.

## Conferências pós-merge

### Render

- Serviço: `srv-dbd9qqi9lscs73aoe85g` (`https://evolution-api-x93o.onrender.com`).
- Confirmar o deploy `live` do último commit que mexeu em `src/`, `prisma/`, `Dockerfile` ou `render.yaml`.
- `GET /` deve responder 200 e `GET /auth/google/status` deve responder 200 com `{"enabled":false}`.
- `GET /instance/fetchInstances` com a chave global no header `apikey` (sem imprimir) e conferir a instância do
  cliente em `open`.
- Se o deploy falhar, ver os logs no Render, corrigir e repetir; nunca deslogar nem parear.

### Neon

- Projeto principal `spring-boat-14626479`; projetos por instância quando `DB_PER_INSTANCE` estiver ligado.
- Confirmar as migrations do V (tabelas `User` e `UserSession`) e que nada foi apagado.
- Não acordar o banco sem necessidade; sem timers.

### Vercel

- `https://whatsaibr.vercel.app`; projeto `prj_1qlhQq1PuLn20KRs2FK0fsD0GIvU`.
- Confirmar o deploy do último commit em `manager/dist`.
- `GET /`, `/manager/`, `/novidades` e `/seguranca` devem responder 200.
- `/manager/` deve estar em `?v=70`; `/assets/mobile-header-limite.css?v=1` deve responder 200; `design-system.css`
  deve ser o último stylesheet.
- Fallback manual: `README-WHATSAI.md`, seção 3.

## Artefato e recomendações

- Use `readmes/ARTEFATO-COMPARACAO.md` como checklist visual.
- Lacunas já registradas: V em etapas (2 e 3); X sem fonte real de cobrança; C com visões só no navegador; Y com
  estado em memória; S com bundle único; L sem capturas; M, N e AA sem PR dedicado; P, Q, R, T, U, Z e O sem
  capturas versionadas.
- Se encontrar divergência, abra issue ou PR com captura antes/depois e a recomendação.

## Checklist rápido

- [ ] Render `live` do último commit
- [ ] Instância do WhatsApp `open`
- [ ] Neon com `User` e `UserSession`
- [ ] Vercel em `?v=70` e CSS do mobile
- [ ] `/`, `/manager/`, `/novidades` e `/seguranca` em 200
- [ ] CI da `main` verde
