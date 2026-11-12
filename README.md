# WhatsAI

Atendimento com IA no WhatsApp para escritórios de advocacia. A IA faz a triagem e organiza os atendimentos, a equipe
assume quando precisa, e o escritório acompanha tudo em um painel próprio.

- Site: [whatsaibr.vercel.app](https://whatsaibr.vercel.app/)
- Painel: [whatsaibr.vercel.app/manager](https://whatsaibr.vercel.app/manager)
- Manual completo: [README-WHATSAI.md](README-WHATSAI.md)

## O que é

O WhatsAI é uma plataforma própria de atendimento automatizado. Cada número de WhatsApp é uma instância com o seu
próprio agente de IA, o seu banco e os seus limites. A base é o [Evolution API](https://github.com/EvolutionAPI/evolution-api)
(WhatsApp Web via Baileys ou Cloud API oficial da Meta), com o painel, a operação e as integrações do WhatsAI por cima.

O foco é escritório de advocacia: a IA recebe o primeiro contato, entende o assunto com cuidado, organiza o atendimento
e passa para a equipe quando o caso pede uma pessoa. Nada de promessa de resultado, honorários, preço ou autoelogio na
conversa com o cliente (perfil `ethicsProfile: "advocacia"`, Código de Ética e Disciplina da OAB e Provimento 205/2021).

## O que tem

- **WhatsApp**: WhatsApp Web com QR code (Baileys) ou Cloud API oficial da Meta.
- **Agente de IA por instância**: instruções do escritório, memória da conversa, áudio, foto e PDF.
- **Triagem de atendimentos**: leads com prioridade, próximo passo, tempo de espera e organização por status.
- **Agenda**: horários de atendimento, marcação, lembretes, bloqueios e integração com o Google Agenda.
- **Processos**: andamentos e publicações (DataJud/DJEN), quando ligados para a instância.
- **Pausa humana**: quando a equipe responde, a IA para naquele contato e retoma depois do tempo combinado.
- **Plano e limites**: franquia mensal, limites diários, horário de atendimento, aviso de excedente e bloqueio.
- **Painel**: visão geral, conversas, leads, agenda, processos, integrações, observabilidade, chaves, retenção e
  notificações.
- **Acesso do cliente**: código `wac_` com os módulos escolhidos, só para a instância dele, com regras no servidor.
- **LGPD**: retenção configurável, exportação dos dados da instância e isolamento por cliente.
- **Multi-tenant**: banco principal para instâncias e acessos e, quando ligado, um banco Neon por instância.

## Como funciona

```
WhatsApp do cliente (Baileys ou Cloud API)
   |
   v
API WhatsAI (Node.js/TypeScript, Express, Prisma)
   |-- banco principal: instâncias, acessos, credenciais e configurações globais
   |-- banco de cada instância: mensagens, contatos, leads, agenda, processos
   |-- agente de IA (OpenAI) e integrações (webhook, n8n, Chatwoot, Typebot...)
   |
   v
Painel e site (manager/dist, servidos pela Vercel)
```

## Stack

- Node.js 24+, TypeScript e Express.
- Prisma com PostgreSQL (Neon) ou MySQL.
- Baileys, Cloud API da Meta e OpenAI.
- Redis/Key Value para cache.
- Painel compilado em `manager/dist` (Vite) e servido como estático.
- Deploy: Render (API), Neon (banco), Vercel (painel e site) e GitHub Actions (CI).

## Rodando localmente

```bash
npm install
cp .env.example .env          # preencha banco, chave global e OpenAI; nunca commite o .env
export DATABASE_PROVIDER=postgresql
npm run db:generate
npm run db:deploy
npm run dev:server
```

Build de produção:

```bash
npm run build
npm run start:prod
```

Testes (a suíte completa roda no GitHub Actions; localmente, use só para depurar):

```bash
npm run test:unit
npm run test:db:start
npm run test:integration
```

## Deploy

- **API**: Render, a partir de [render.yaml](render.yaml); o `main` publica sozinho.
- **Banco**: Neon; um projeto principal e, quando ligado, um projeto por instância.
- **Painel e site**: Vercel; o workflow `Deploy Manager` publica `manager/dist` a cada mudança no `main`.
- **Segredos**: variáveis sensíveis ficam no painel do provedor (`sync: false`), nunca no Git. Veja
  [.env.example](.env.example).

## Documentação

- [README-WHATSAI.md](README-WHATSAI.md): manual operacional completo.
- [readmes/GUIA-DO-PROJETO.md](readmes/GUIA-DO-PROJETO.md): arquitetura, painel, deploy, testes e capturas.
- [readmes/HANDOFF-CLAUDE-CODE.md](readmes/HANDOFF-CLAUDE-CODE.md): conferências pós-deploy com MCP.
- [readmes/REVISAO-ENTREGA.md](readmes/REVISAO-ENTREGA.md): roteiro de correções do painel.

## Segurança e dados

- Nunca commite chaves, tokens, `.env` ou dados de cliente.
- A chave global é o acesso de emergência do operador. Códigos de cliente são guardados só como hash SHA-256.
- Em issues e pull requests, use dados fictícios. Não abra issue com conversa, telefone ou documento de cliente.
- A IA não fala de preço, gratuidade, honorários ou resultado, e não promete êxito.

## Licença e origem

Este projeto é um fork do [Evolution API](https://github.com/EvolutionAPI/evolution-api), da Evolution Foundation,
licenciado sob a Apache License 2.0 com condições adicionais. Leia [LICENSE](LICENSE), [NOTICE](NOTICE) e
[TRADEMARKS.md](TRADEMARKS.md).

**Aviso de uso (condição 1b da licença do Evolution API):** este produto utiliza o Evolution API. O aviso exigido pela
licença fica visível para os administradores no rodapé do painel e neste README. O Evolution API, o Evolution
Foundation e as suas marcas pertencem à Evolution Foundation; o WhatsAI não é afiliado à Evolution Foundation.
