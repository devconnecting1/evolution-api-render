# Monitor externo do status (Cloudflare Worker)

Monitor independente da nossa infraestrutura para a página [/status](https://whatsaibr.vercel.app/status). Ele
roda na Cloudflare (plano **Workers Free**), fora do Render, do Neon e da Vercel: se a API cair, é ele quem registra
a queda, porque a própria API não consegue registrar o tempo em que está fora do ar.

## O que ele faz

A cada 5 minutos (Cron Trigger `*/5 * * * *`):

1. `GET https://evolution-api-x93o.onrender.com/status/ping`: resposta só da memória da API (versão, tempo no ar,
   estado dos componentes). **Não toca no banco e não grava no Redis**, então **não acorda o Neon**.
2. `HEAD https://whatsaibr.vercel.app/`: o site e o painel respondem?
3. A cada 15 minutos: as páginas de status públicas de Render, Neon (status.io), Vercel e OpenAI. A Meta
   (metastatus.com) não publica JSON e fica de fora.
4. Opcional, a cada 15 minutos, se você cadastrar tokens **somente leitura** (veja abaixo): último deploy do Render,
   estado do endpoint e cota de compute do Neon, último deploy de produção da Vercel.
5. Grava **uma** chave no Workers KV (`history:v1`) com: amostras dos últimos 7 dias, disponibilidade diária de 90
   dias e incidentes (`api_unreachable`, `site_down`, `upstream_incident`, `deploy_failed`, `db_quota_risk`,
   `db_suspended_quota`). Um incidente de API ou site só abre depois de 2 falhas seguidas (10 min).

`GET https://<seu-worker>.workers.dev/history` devolve esse histórico em JSON com CORS (`Access-Control-Allow-Origin:
*`, cache de 60 s). A página de status junta esse histórico ao da API quando o endereço está configurado.

## Limites do plano grátis (e quanto usamos)

| Recurso (Workers Free) | Limite | Uso deste monitor |
| --- | --- | --- |
| Requisições ao Worker | 100.000/dia | 288 execuções do cron + as visitas a `/history` |
| CPU por execução | 10 ms | quase tudo é espera de rede, que não conta como CPU |
| Cron Triggers | 5 por conta | 1 |
| Workers KV: leituras | 100.000/dia | 1 por execução + 1 por visita a `/history` (com cache de 60 s) |
| Workers KV: gravações | 1.000/dia | **288/dia** (uma por execução) |
| Workers KV: armazenamento | 1 GB | ~50 kB |

Não há cartão de crédito no plano Free: ao passar de um limite o Worker só deixa de responder até o dia seguinte.

### Efeito no Render e no Neon

- O ping a cada 5 minutos é tráfego de entrada, então **o serviço Free do Render deixa de dormir** (ele dorme após
  15 minutos sem tráfego). Um único serviço ligado o mês inteiro usa ~720 a 744 horas, dentro das **750 horas
  grátis por mês** do workspace. Atenção: um segundo serviço Free no mesmo workspace dividiria essas horas.
- O ping **não acorda o Neon**: `/status/ping` responde só com dados em memória. O Neon só liga quando a aplicação
  realmente consulta o banco (mensagens, painel...).

## Implantar (grátis)

Pré-requisitos: Node 20+, uma conta grátis em <https://dash.cloudflare.com/sign-up> (sem cartão).

```bash
cd ops/status-monitor

# 1) Entrar na conta (abre o navegador)
npx wrangler@4 login

# 2) Criar o namespace do KV e colar o id em wrangler.toml (campo id de [[kv_namespaces]])
npx wrangler@4 kv namespace create STATUS_KV

# 3) (Opcional) tokens SOMENTE LEITURA para incidentes de deploy e cota; sem eles, o monitor faz só ping e HEAD
npx wrangler@4 secret put RENDER_API_KEY      # Render > Account Settings > API Keys
npx wrangler@4 secret put RENDER_SERVICE_ID   # srv-... do serviço evolution-api
npx wrangler@4 secret put NEON_API_KEY        # Neon > Organization > API keys (chave com escopo do projeto)
npx wrangler@4 secret put NEON_PROJECT_ID     # spring-boat-...
npx wrangler@4 secret put VERCEL_TOKEN        # Vercel > Account Settings > Tokens (escopo do team)
npx wrangler@4 secret put VERCEL_PROJECT_ID   # prj_...
npx wrangler@4 secret put VERCEL_TEAM_ID      # team_... (se o projeto for de um team)

# 4) Publicar (o cron começa a rodar sozinho)
npx wrangler@4 deploy
```

O deploy imprime o endereço, por exemplo `https://whatsai-status-monitor.<sua-conta>.workers.dev`. Confira com:

```bash
curl -s https://whatsai-status-monitor.<sua-conta>.workers.dev/history | head -c 400
npx wrangler@4 tail   # logs ao vivo; o cron roda a cada 5 min
```

### Ligar o monitor na página de status

Em `manager/dist/status/index.html`, preencha a meta tag com o endereço do Worker (sem barra no fim):

```html
<meta name="whatsai-status-monitor" content="https://whatsai-status-monitor.<sua-conta>.workers.dev" />
```

A página passa a juntar as amostras do monitor ao histórico da API: períodos em que a API estava fora do ar (e não
pôde registrar nada) aparecem como "Indisponível", e a cobertura ("dados de X% do período") passa a contar as
verificações externas.

## Sobre os tokens

- Todos são **opcionais** e usados só para leitura. O Worker nunca grava nada no Render, no Neon ou na Vercel.
- O Neon tem chaves de organização com escopo de projeto; a chamada usada (`GET /projects/{id}` e
  `/projects/{id}/endpoints`) é da API de controle e **não liga o compute**.
- Os tokens ficam como segredos do Worker (`wrangler secret put`), nunca no `wrangler.toml` nem no repositório.
- A resposta de `/history` só tem agregados (estado, contagens, CU-h). Nada de chaves, nomes de instância, números
  de telefone ou mensagens de commit.

## Testes

A lógica do Worker é testada pela suíte do projeto (`npm run test:unit`, arquivo `test/unit/status-monitor.test.ts`)
com KV e `fetch` falsos.
