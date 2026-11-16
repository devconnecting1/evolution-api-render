# Decisões de design e arquitetura do status público

## 1. Por que uma página separada, e não a Observabilidade

A Observabilidade do manager foi feita para diagnosticar a operação: mostra tokens, planos, consumo, limites de Neon,
Render, Vercel e OpenAI. Ela exige a chave global e não pode ser pública. O status público precisa do contrário: ser
legível por qualquer pessoa, sem chave, e nunca expor detalhes de cliente ou de infraestrutura.

Por isso o PR separa as duas coisas:

- `/manager/observability` continua privada e completa;
- `/status` é a página pública, com um recorte agregado;
- `/observability` na raiz redireciona para `/status`, para não manter duas páginas públicas concorrentes.

A alternativa de simplesmente tornar a Observabilidade pública foi descartada: ela mostra nomes de instância, detalhes de
banco e consumo, e depende de chaves externas.

## 2. Estrutura da página

A ordem segue a leitura de quem chega com uma dúvida ("o WhatsApp está fora do ar?"):

1. **Estado geral** em uma frase, com um ponto semântico e o horário da última verificação.
2. **Atendimento**: WhatsApp Web e API oficial da Meta. É o que o cliente sente primeiro.
3. **Plataforma**: API, banco, site e painel. É o que a equipe precisa saber para diagnosticar.
4. **Legenda** do histórico: cada barra representa 3 horas e mostra o pior estado do período.
5. **Incidentes recentes**: data, componente, intervalo em UTC, duração ou "em andamento".
6. **Como medimos**: o que é monitorado, a cadência, o significado dos estados, as lacunas, o JSON público e o canal de
   aviso.
7. **Rodapé** com os mesmos links públicos do site e o atalho para o JSON.

A referência do OpenCode foi usada para essa composição. O conteúdo, os tokens, a tipografia e os componentes são do
WhatsAI.

## 3. Linguagem visual

- Tokens `--c-*` de `assets/tokens.css`: fundo, texto, bordas e cores semânticas iguais às do site e do painel.
- Geist para texto e Geist Mono para rótulos e horários, como no restante do produto.
- Tema claro e escuro pelo sistema (`prefers-color-scheme`), com `color-scheme` declarado.
- Verde só para operacional, âmbar para degradado, vermelho para indisponível. O ponto do estado geral usa a mesma regra.
- Sem logo, imagem, fonte ou CSS de terceiros. A página não carrega nada de fora do domínio.
- Sem emojis. O marcador de incidente é o caractere `!` dentro de um quadrado, não um ícone decorativo.

A página usa `max-width` de 1120 px, uma coluna no celular e três zonas na linha do componente (nome, barras, estado). As
barras encolhem com `flex`, sem `overflow` horizontal. Em 390 px, o nome e o estado continuam legíveis; as barras ficam
entre eles.

## 4. Estados

| Estado | Significado público | Cor |
|---|---|---|
| `operational` | Responde normalmente | Verde |
| `degraded` | Falha parcial ou lentidão | Âmbar |
| `outage` | Não responde | Vermelho |
| `no_data` | Ainda não há verificação ou o componente não existe na operação | Cinza tracejado |

A agregação usa a pior posição: `outage` > `degraded` > `operational` > `no_data`. O estado geral só é `no_data` quando
todos os componentes estão sem dados.

As frases do topo são fixas por estado, para não prometer causa ou prazo que o sistema não conhece:

- operacional: "Todos os sistemas operacionais";
- degradado: "Operação parcial";
- indisponível: "Serviço indisponível";
- sem dados: "Sem dados suficientes".

## 5. De onde vem cada componente

| Componente | Fonte | Regra |
|---|---|---|
| `whatsapp-web` | Recursos do tipo `WhatsApp Web` e `Evolution` na visão WhatsApp | Todas conectadas = operacional; nenhuma = indisponível; parte = degradado; sem números = sem dados |
| `whatsapp-cloud` | Recursos do tipo `Cloud API (Meta)` | Mesma regra |
| `api` | Visão Sistema, quando a leitura termina | Operacional se o endpoint conseguiu montar o retrato; detalhe com versão e uptime do processo |
| `database` | Recurso `database` e métrica `database_size` | `conectado` = operacional; `warning` de tamanho = degradado; `critical` = indisponível; `sem resposta` = indisponível |
| `site` | A própria página | Operacional quando a página carregou; no fallback, "Esta página carregou" |

O componente `api` não faz uma chamada a si mesmo. Se o endpoint público respondeu, a API está de pé; o detalhe vem do
uptime do processo. O `site` tem a mesma lógica: a página só é vista se a Vercel a entregou.

## 6. Histórico em faixas

- Constante `BUCKET_MS = 3 h`; `HISTORY_BUCKETS = 56`, o que cobre 7 dias.
- O início da faixa é alinhado ao epoch: `floor(now / 3 h) * 3 h`.
- Cada faixa guarda o pior estado observado no período. `no_data` não apaga um estado conhecido.
- A resposta sempre devolve 56 posições, inclusive as que nunca foram coletadas. O front desenha todas; as vazias ficam
  tracejadas.
- Faixas mais antigas que 7 dias são descartadas na gravação.

Essa escolha reduz o tamanho do JSON e do `GlobalSetting`: 56 objetos pequenos, não um evento por minuto.

## 7. Incidentes

- Um incidente abre quando o estado de um componente muda para `degraded` ou `outage`.
- Se já existe um incidente aberto para o componente e o estado muda entre degradado e indisponível, o anterior é fechado
  e um novo é aberto com o novo estado.
- O incidente fecha quando o componente volta a `operational`.
- O id é `componente-timestamp`, o que evita colisão sem precisar de uma tabela com sequência.
- A janela é de 90 dias; até 50 incidentes ficam guardados e os 20 mais recentes vão para a página.
- A duração é calculada no servidor a cada resposta; um incidente aberto mostra "em andamento".

Limitação conhecida: uma queda que passa por degradado e indisponível aparece como dois incidentes. Agrupar em um
incidente com atualizações exigiria um modelo de eventos e uma nota manual do operador; ficou fora deste PR.

## 8. Persistência sem migration

O formato é:

```json
{
  "states": { "api": "operational", "database": "operational" },
  "buckets": [{ "t": 1763294400000, "components": { "api": "operational" } }],
  "incidents": [
    {
      "id": "database-1763294400000",
      "component": "database",
      "name": "Banco de dados",
      "state": "outage",
      "start": 1763294400000,
      "end": 1763294820000
    }
  ]
}
```

A linha fica em `GlobalSetting`, chave `public-status:v1`, no banco de controle. Vantagens:

- funciona nos três schemas (`postgresql`, `mysql`, `psql_bouncer`);
- não exige migration nem tabela nova;
- `globalSetting` já está em `CONTROL_MODELS`, então a consulta nunca vai para o banco de uma instância.

O serviço normaliza o valor ao ler: estados inválidos, faixas sem timestamp e incidentes sem componente são descartados.
Assim, uma linha antiga ou corrompida não derruba a página.

## 9. Cache e o Neon gratuito

O serviço tem cache em memória de 5 minutos (`DEFAULT_CACHE_TTL_MS`) e uma única verificação em andamento por
processo: chamadas simultâneas compartilham a mesma promise, então uma rajada de acessos não multiplica as leituras do
banco. O endpoint responde com `Cache-Control: public, max-age=30, stale-while-revalidate=30`, mas quem controla a real
frequência de leitura do banco é o cache do processo.

Fluxo de uma consulta:

1. Se há resultado em cache com menos de 5 minutos, devolve sem tocar no banco.
2. Senão, monta as visões Sistema e WhatsApp.
3. Se a montagem inteira falhou (probe indisponível), devolve o fallback degradado e não grava nada.
4. Se funcionou, lê o `GlobalSetting`, atualiza a faixa atual e os incidentes, e grava somente se algo mudou.
5. Guarda o resultado em memória.

Não há timer, cron, worker ou `setInterval` no servidor. O navegador agenda a próxima consulta, mas só enquanto a aba está
visível; ao voltar, consulta se o último dado tem mais de 5 minutos.

O custo aceito: enquanto alguém mantém a página aberta, o cache expira e uma leitura do banco acontece a cada 5 minutos.
É um custo proporcional ao uso e limitado por processo, não um monitor rodando para sempre.

## 10. Falha

- **API de status fora do ar:** o `fetch` falha, a página mostra "Não foi possível consultar o status", um alerta com
  "Tentar de novo" e os componentes como **Sem dados**. O site continua operacional porque a página carregou. O histórico
  não é inventado.
- **Banco fora do ar:** o cartão do banco fica **Indisponível** quando a conexão é recusada e o estado geral acompanha; a
  API continua operacional porque o endpoint respondeu. Se a verificação inteira não puder ser montada (probe ausente), o
  serviço devolve o fallback degradado, com o banco em **Sem dados**.
- **Leitura do `GlobalSetting` falha:** o serviço usa um store vazio, não grava e continua servindo o estado atual. A
  próxima consulta tenta de novo.
- **Gravação falha:** o serviço marca o store como não gravável naquele ciclo e continua servindo; não entra em loop de
  erro.
- **Resposta inválida:** se o JSON não tiver `groups`, o front trata como falha e usa o fallback.

## 11. Segurança e privacidade

- O endpoint não usa `authGuard`; é público por desenho, mas só devolve o tipo `PublicStatus`.
- `buildGroups` só copia contagens, status e detalhes técnicos. Nomes, números, ids de instância, mensagens, tokens e
  chaves não entram no objeto.
- O teste unitário procura nomes fictícios, ids de instância e prefixo de telefone no JSON serializado e falha se
  aparecerem.
- O CORS é `*` porque a página está na Vercel e a API no Render; não há cookie nem credencial.
- O endpoint não aceita parâmetros que escolham instância ou banco. `?refresh=1` não é exposto no público: força de cache
  só existe no serviço privado da Observabilidade.
- O `GlobalSetting` não é lido por nenhuma rota pública além desta, e o payload guardado não contém dados de cliente.

## 12. Acessibilidade e responsivo

- Link "Pular para o conteúdo", foco visível com `outline` de 2 px.
- `aria-busy` no herói e na lista de grupos enquanto carrega; `aria-live="polite"` nos grupos e nos incidentes.
- Cada faixa de 7 dias é um `role="img"` com `aria-label` que resume a contagem por estado.
- As barras têm `title` com data e estado; a legenda explica a escala.
- O estado nunca é comunicado só por cor: o texto ao lado diz Operacional, Degradado, Indisponível ou Sem dados.
- `details/summary` nativo em "Como medimos", sem JavaScript.
- Grade de uma coluna no celular; a partir de 801 px, o componente usa três zonas (nome, barras, estado).
- Sem animação de rolagem. A página não anima conteúdo; ainda assim há uma regra de `prefers-reduced-motion` que zera
  animações e transições.

## 13. Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Tornar a Observabilidade pública | Expõe nomes, consumo e chaves; exige chave global |
| Tabela nova para histórico | Exigiria migration nos três schemas para um ganho pequeno |
| Redis para histórico | O Redis gratuito não é durável; o status precisa sobreviver a restart |
| Cron a cada minuto | Acordaria o Neon e o Render sem necessidade |
| Preencher lacunas como operacional | Inventaria disponibilidade; o correto é **Sem dados** |
| Status embutido no painel | Não serve a quem não tem login; o cliente precisa de uma URL pública |
| Iframe ou componente do OpenCode | Não é código nosso e traria dependência externa |

## 14. O que fica para depois

- Monitor externo para uptime de verdade e para cobrir a cegueira de Vercel/Render.
- Nota manual do operador em um incidente.
- Agrupar transições no mesmo incidente.
- Página de histórico por componente, se o volume justificar.
- Verificação ativa do site e da Cloud API quando houver número oficial configurado.
