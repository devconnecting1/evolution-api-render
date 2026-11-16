# Decisões: capturas reais no lugar dos mockups

## Objetivo

A landing já tinha a mecânica do carrossel e a narrativa do produto, mas as telas eram desenhadas em HTML/CSS. O
pedido foi usar o painel real, e a troca precisava manter três coisas: a leitura da página, a troca de tema e o
desempenho. Também era necessário revisar a ordem das seções para a leitura terminar no lugar certo.

## Por que capturas reais

- O visitante vê o produto que vai usar, não uma ilustração.
- Os estados mostrados existem no painel: IA ativa, equipe assumiu, agenda com horários, processos com novidade,
  leads com prioridade.
- O texto comercial deixa de prometer uma tela que o produto não entrega.
- As capturas foram feitas com dados fictícios e API simulada; a privacidade não muda.

## Hero: por que a tela do celular

O card do hero é 4:5. Uma captura desktop 16:9 nesse espaço teria dois caminhos ruins:

1. **cover**: cortaria a conversa ou colunas da tabela no meio, deixando frases incompletas.
2. **contain**: sobraria faixa vazia acima e abaixo, e a tela ficaria menor ainda.

A tela do painel no celular é real e tem a mesma proporção vertical. Ela mostra a interface inteira no card, com texto
legível, e continua sendo uma captura do produto. Por isso o hero usa 4:5 e as seções de produto usam 16:9.

A alternativa de aumentar o card ou trocar o formato para 16:9 foi rejeitada porque quebraria a referência visual do
carrossel do opencode.ai, que o dono pediu para manter.

## Produto: por que a tela desktop

As quatro seções precisam mostrar a mesa de trabalho: lista de conversas, tabela de contatos, calendário e lista de
leads. A tela 16:9 do desktop mostra a maior quantidade de contexto por imagem e é o formato natural do painel. O
texto da interface fica pequeno na largura da página; a função da imagem é provar a tela, e o texto ao lado explica o
benefício.

## Tema: por que duas capturas, e não um filtro

O painel tem fundo branco no claro e grafite no escuro, além de cores semânticas em chips e gráficos. Um filtro
`invert` ou uma camada escura distorceria verde, âmbar e vermelho. A solução é capturar o painel nos dois temas e
trocar a imagem por CSS:

- `html[data-theme-mode="dark"]` cobre o seletor manual do site;
- `prefers-color-scheme: dark` cobre o tema do sistema quando não há escolha manual;
- a imagem inativa fica `display:none` e `lazy`, então não entra no carregamento.

O custo é ter duas tags por imagem no HTML. O ganho é fidelidade de cor e estado nos dois temas.

## Moldura

A captura clara tem fundo branco. Sem moldura, ela se funde com o fundo branco da página. A moldura de 1 px e o fundo
`--wa-card-2` fazem a imagem parecer uma tela, não um bloco solto. A sombra é discreta e usa os tokens do site.

No hero, a captura fica inserida 12 px dentro da moldura do card; no celular, ela ocupa o card inteiro e recebe o
degrade inferior para o texto sobreposto. A primeira imagem é `eager` com prioridade alta; as outras são `lazy`.

## Destaque

A faixa é sempre escura nos dois temas, então a captura é sempre a escura. Usar a versão clara exigiria inverter a
faixa ou aplicar um filtro, e o contraste dos números e do gráfico mudaria. A Visão geral foi escolhida porque é a
tela que resume o painel: números, gráfico, agenda do dia e alertas.

## Ordem das seções

A ordem anterior interrompia a leitura: planos, dúvidas e só depois novidades, processo e destaques. O convite final
ficava depois de conteúdo de apoio.

A ordem nova separa a narrativa em três blocos:

1. **Entender**: hero, prova por segmento, produto, recursos, pilares e destaque.
2. **Confiar**: novidades, como a IA trabalha e destaques.
3. **Decidir**: planos, dúvidas e convite final.

O menu acompanha a ordem. A alternativa de mover só as dúvidas para o fim não resolvia o problema de o preço aparecer
antes das provas e das novidades.

## Desempenho

- WebP em vez de JPEG: a mesma tela com menos bytes e o critério de formato moderno do Lighthouse.
- Duas larguras por imagem com `srcset` e `sizes`: o celular não baixa a variante de 1600 px.
- `width` e `height` em todas as tags: nenhum deslocamento de layout.
- Primeira imagem do hero com prioridade; as demais `lazy`.
- O bundle CSS continua o mesmo; a limpeza do CSS dos mockups removidos ficou para uma rodada separada.
- Resultado local com gzip: desktop 100 nas quatro categorias; celular 99 em performance e 100 nas outras. O TBT é o
  ponto que falta na simulação de celular; a Vercel usa Brotli e CDN.

## Acessibilidade

- Cada imagem tem `alt` com a tela e o estado; a nota em `sr-only` informa que são capturas reais com dados
  fictícios.
- A imagem inativa fica `display:none`; leitores de tela não leem duas descrições.
- O texto alternativo não repete nomes de clientes fictícios desnecessariamente.
- A ordem de títulos e a navegação por âncoras não mudaram.
- O contraste do texto sobre a captura no celular é garantido pelo degrade inferior, que vai a 94% de opacidade.

## Alternativas rejeitadas

1. **Manter os mockups e só trocar o conteúdo.** Não atendia ao pedido e mantinha a sensação de produto ilustrado.
2. **Usar uma captura desktop no card 4:5 com cover.** Cortava frases e colunas.
3. **Usar `contain` no card 4:5.** Criava faixas vazias e reduzia a tela.
4. **Aplicar filtro escuro na captura clara.** Distorcia as cores semânticas do painel.
5. **Usar uma única captura para os dois temas.** O contraste e os estados não ficariam corretos.
6. **Mover apenas as dúvidas.** O preço continuaria antes das provas e das novidades.
7. **Capturar em tempo real no navegador do visitante.** Exigiria API, sessão e dados; a landing é estática.

## Limitações

- A densidade do painel real é maior que a dos mockups. Nas seções de produto, o texto interno é pequeno.
- O hero mostra o painel no celular, não o desktop.
- A faixa escura usa uma captura escura fixa.
- O HTML carrega duas tags por imagem; só uma é baixada.
- O CSS morto dos mockups antigos continua no bundle compartilhado com `/novidades`.
- As imagens são estáticas; mudanças no painel exigem novas capturas e novas variantes WebP.
