# Banco próprio por instância (um projeto Neon por instância)

## Por quê

No plano Free do Neon **cada projeto tem as próprias 100 CU-h/mês** e a conta pode ter até
100 projetos (ver `docs/vendors/neon/llms-full.txt`). Com todas as instâncias num banco só,
elas dividem as mesmas 100 CU-h: um cliente movimentado derruba o banco de todos quando a cota
acaba. Com um projeto por instância, a cota é de cada cliente e o problema fica isolado nele.

No **Render** isso não funciona: as 750 horas grátis são **por workspace**, não por serviço.
Um segundo serviço 24/7 no mesmo workspace dividiria as mesmas horas (e cada um ficaria sem
horas na metade do mês). Por isso a API continua sendo **um serviço só, multi-instância**.

## Como funciona

```
                ┌──────────────── Render (1 serviço) ────────────────┐
  WhatsApp ───▶ │ Evolution API / WhatsAI                            │
                │   prismaRepository = roteador                      │
                │     ├─ instanceId nos argumentos ─┐                │
                │     ├─ contexto da instância ─────┤                │
                │     └─ sem instância ─────────────┤                │
                └───────────────────────────────────┼────────────────┘
                                                    ▼
   Banco principal (projeto atual)        Projeto Neon da instância B, C…
   - Instance (todas)                      - Instance (espelho, p/ FKs)
   - InstanceDatabase (mapeamento)         - Message, Chat, Contact, chaves,
   - dados das instâncias antigas            bot, limites… só desta instância
```

- O banco de `DATABASE_CONNECTION_URI` vira o **plano de controle**: a lista de instâncias
  (`Instance`) e o mapeamento `InstanceDatabase` (URL **criptografada** com AES-256-GCM).
- Ao criar uma instância com `DB_PER_INSTANCE_ENABLED=true`, a API cria o projeto Neon
  (região/versão iguais ao principal, teto 0,25 CU), aplica as migrations, espelha a linha
  `Instance` e só então libera a instância. Se algo falhar, desfaz tudo (apaga o projeto meio
  criado e a instância) e mostra o erro — nunca mistura dados no banco principal.
- O roteador (`src/api/repository/instance-db/routing.ts`) escolhe o banco por consulta:
  1. `instanceId` / `sessionId` nos argumentos; 2. contexto da instância (rotas da instância,
  eventos do WhatsApp, conexão); 3. banco principal. `Instance`, `InstanceDatabase` e
  `IsOnWhatsapp` ficam sempre no principal; a listagem traz contagens e configurações do banco
  de cada instância.
- **Instâncias antigas não mudam** (seguem no banco principal). Enquanto nenhuma instância tiver
  banco próprio, o roteador devolve o cliente original sem nenhuma diferença.
- Ao iniciar, a API aplica as migrations em cada banco de instância (`DB_PER_INSTANCE_MIGRATE_ON_BOOT`).
- Ao remover a instância, os dados dela são apagados (como hoje). O projeto Neon vazio é mantido,
  a menos que `DB_PER_INSTANCE_DELETE_ON_REMOVE=true`.

## Como ligar

1. Neon Console → Account/Organization settings → **API keys** → criar chave.
2. Render → serviço da API → Environment: `DB_PER_INSTANCE_ENABLED=true`, `NEON_API_KEY`,
   `NEON_ORG_ID` (org dona do projeto atual), `DB_PER_INSTANCE_SECRET` (texto longo aleatório,
   **não trocar depois**). Opcional: `NEON_REGION_ID` (padrão `aws-us-east-2`), `NEON_PG_VERSION` (16).
3. Criar a próxima instância pelo painel. O diálogo "Nova instância" mostra **Banco de dados**:
   - **Banco próprio (recomendado)**, marcado por padrão, com "Restam N de 100 projetos" (API do Neon,
     cache de 1 min; com o Neon fora vira "estimativa");
   - **Compartilhado**, para testes ou quando o limite acaba (aí vira o padrão e "Banco próprio" fica
     desabilitado).
   A escolha vai como `dbMode: "own" | "shared"` no `POST /instance/create`; sem o campo, vale "own".
   A coluna "Banco" da lista mostra "Próprio" ou "Compartilhado".

## Rotas e ferramentas do admin (só chave global, nunca consultam o banco)

- `GET /admin/database-quota` → `{ enabled, defaultMode, limit, used, remaining, ownInstances, source }`.
- `GET /admin/db-activity?limit=50` → as últimas "acordadas" do banco principal: primeira consulta
  depois de 5 min parado e as consultas da mesma rajada (só tabela e tipo de SQL, nunca valores).
  Serve para achar o que mantém o Neon ligado de madrugada.
- MCP `get_database_info`: as duas coisas acima numa ferramenta.

## Limites e cuidados

- Cada instância continua precisando caber em **100 CU-h/mês** (≈ 400 h ativas a 0,25 CU,
  ≈ 13 h/dia). Isolar não reduz o consumo de uma instância muito movimentada.
- Quando a cota de um projeto acaba, só aquela instância fica sem banco até o mês virar.
- Limite de projetos: `NEON_PROJECT_LIMIT` (padrão 100, o do Free). No limite, a criação com banco
  próprio é recusada com mensagem clara, sem criar nada.
- O Free do Neon é para protótipos; cliente pagante deve ir para plano pago (Launch é por uso).
- Render Free continua com 0,1 vCPU e dorme após 15 min sem tráfego; várias instâncias no mesmo
  serviço disputam a mesma CPU.
