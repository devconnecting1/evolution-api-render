# Documentação pública: decisões de design

Esta página (`/docs`) é HTML, CSS e JS escritos à mão, sem framework, sem dependência externa e sem asset de
terceiros. O padrão de documentação do Render serviu como referência de layout, componentes e comportamento de
leitura. Nenhum arquivo CSS, fonte, logo, ilustração, texto ou outro asset do Render foi copiado. A marca, o conteúdo,
os ícones e o código são do WhatsAI.

## Método

- Referências públicas usadas nas capturas: `https://render.com/docs` (home) e
  `https://render.com/docs/your-first-deploy` (guia), nos mesmos viewports e temas da nossa página.
- As capturas foram feitas com Playwright, sem login. Avisos de consentimento e widgets de terceiros foram removidos
  antes da imagem para não poluir a comparação.
- As imagens do Render ficam só em `readmes/pr/documentacao/referencia/`, para revisão no PR. Elas não entram em
  `manager/dist` e não são publicadas no site.
- Valores de cor, medida, raio, sombra e tempo de animação foram extraídos do CSS público servido pela página e
  recriados com nomes de token e classes próprios em `docs.css` e `docs.js`.
- As capturas comparativas usam dados fictícios. Não há telefone, nome de cliente, chave ou token reais.

## Comparação de tokens

| Token | Referência (claro / escuro) | WhatsAI (claro / escuro) | Observação |
| --- | --- | --- | --- |
| Fundo da página | `#ffffff` / `#0d0d0d` | igual | Mesmo contraste base. |
| Superfície suave | `#fafafa` / `#141414` | igual | Cabeçalhos de grupo, bloco de código e hover. |
| Borda | `#e3e3e3` / `#272727` | igual | Cartões, divisórias e cabeçalho do código. |
| Borda de campo | `#c7c7c7` / `#4d4d4d` | igual | Busca e botão secundário. |
| Texto | `#0d0d0d` / `#ffffff` | igual | Texto principal. |
| Texto secundário | `#4d4d4d` / `#e3e3e3` | igual | Navegação e parágrafos de apoio. |
| Texto terciário | `#6b6b6b` / `#b3b3b3` | igual | Legendas, placeholder e metadados. |
| Accent | `#8a05ff` / `#d1b8ff` | `#0e7a4d` / `#5fcf8a` | Adaptado para o verde escuro da marca; o Render usa roxo. Item ativo, links, foco e hover do botão primário. |
| Accent suave | `#f4f0ff` / `#2a0052` | `#e9f5ee` / `#12241a` | Fundo do item ativo e ícones de card, no verde da marca. |
| Foco | `#8a05ff` / `#c29eff` | `#0e7a4d` / `#86efac` | Anel de foco visível por teclado. |
| Nota | `#f4f0ff`, borda `#9b52fb`, texto `#1c0037` / `#1c0037`, borda `#48008c`, texto `#e7dbff` | `#e9f5ee`, borda `#1a9e5c`, texto `#0b3d26` / `#12241a`, borda `#1f5c3a`, texto `#c9f7d9` | Callout informativo no verde da marca. |
| Atenção e limite | `#fce2fe`, borda `#f347ff`, texto `#2c001d` / `#2c001d`, borda `#5c0056`, texto `#fac7ff` | `#fdf0d5`, borda `#d97706`, texto `#5a3a00` / `#2a1f0c`, borda `#8a5a12`, texto `#fcd38d` | Callout de atenção em âmbar, no lugar do rosa do Render. |
| Erro | `#fce2fe`, borda `#f347ff`, texto `#2c001d` / `#2c001d`, borda `#5c0056`, texto `#fac7ff` | `#fde2e1`, borda `#b42318`, texto `#5a1210` / `#2d1414`, borda `#7f2a2a`, texto `#fca5a5` | Callout de erro em vermelho, separado da atenção. |
| Código inline | fundo `#fafafa`, texto `#e23642` / fundo `#272727`, texto `#f0989e` | fundo `#fafafa`, texto `#0d0d0d` / fundo `#272727`, texto `#ffffff` | Neutro, porque vermelho é reservado a erro. |
| Bloco de código | fundo `#fafafa`, cabeçalho `#ffffff`, borda `#e3e3e3` / `#141414`, `#0d0d0d`, `#272727` | igual | Barra com linguagem e botão de copiar. |
| Botão primário | fundo `#0d0d0d`, texto `#ffffff` / fundo `#ffffff`, texto `#0d0d0d` | igual | Hover preenche com o accent. |

## Tipografia e adaptação

| Uso | Referência | WhatsAI |
| --- | --- | --- |
| Títulos | Roobert, peso 300, entrelinha 1,05, letter-spacing negativo | Geist, mesmos tamanhos, pesos e entrelinhas |
| Corpo e interface | PPNeueMontreal | Geist |
| Código e rótulos mono | PPNeueMontrealMono | Pilha monoespaçada do sistema (`ui-monospace`, SFMono, Menlo, Consolas) |

Roobert, PPNeueMontreal e PPNeueMontrealMono são fontes proprietárias do Render e não foram copiadas nem serviram
por CDN. A página usa a Geist que o site e o painel do WhatsAI já carregam, com a mesma escala, peso e ritmo de linha.
Como as métricas das fontes são diferentes, as quebras de linha não são idênticas às da referência. O código e os
cabeçalhos de tabela usam mono do sistema, inclusive com a regra global de Geist do site (`assets/geist.css`), que é
sobrescrita apenas dentro da documentação.

## Layout e medidas

| Item | Referência | WhatsAI |
| --- | --- | --- |
| Topo | 60 px + 1 px de borda, padding lateral de 32 px | igual |
| Busca do topo | 480 x 36 px, raio 0, borda de 1 px | igual |
| Navegação lateral | 280 px, fixa, grupo com 44 px de altura | igual |
| Navegação no celular | gaveta de largura total, abaixo do topo, com cortina | gaveta de largura total, abaixo do topo, com cortina; o nosso topo mantém a busca visível acima da gaveta |
| Artigo em 1440 px | caixa de 792 px, padding de 60 px, texto de 672 px | igual |
| Artigo entre 1024 e 1279 px | caixa de 728 px, padding de 60 px, texto de 608 px | igual |
| Artigo abaixo de 1024 px | coluna de 672 px centralizada, padding de 32 px | igual |
| Celular | padding de 20 px, uma coluna | igual |
| Índice lateral | 352 px, só a partir de 1280 px, topo fixo | igual |
| Título da página | `clamp(48px, 5vw, 64px)`, peso 300 | igual |
| Subtítulo do herói | `clamp(22px, 2.2vw, 28px)`, entrelinha 1,08 | igual |
| Seção | `clamp(32px, 3.3vw, 42px)`, peso 300 | igual |
| Subseção | 28 px, peso 500 | igual |
| Corpo | 18 px, entrelinha 1,5 | igual |
| Tabela | 16 px; cabeçalho mono de 14 px em caixa alta | igual |
| Código | 14 px, entrelinha 20 px, barra de 34 px | igual |
| Botões | 40 px de altura, raio de 2 px, texto de 14 px | igual |
| Cards | Grade de 2 colunas, borda de 1 px, raio 0, padding de 24 px | Adaptado: a referência usa 3 colunas na home larga; nosso artigo de leitura tem 672 px |

## Componentes

- **Sidebar**: fundo suave nos grupos, ícone de linha à esquerda, chevron à direita, item ativo com barra de 2 px e
  fundo `--d-accent-soft`. Os grupos podem ser recolhidos e a busca os expande temporariamente.
- **Busca**: campo quadrado com ícone, painel sobreposto, contagem de resultados, trecho encontrado com destaque,
  navegação por setas e Enter, atalhos `/` e Ctrl/Cmd+K, Escape para fechar.
- **Cards**: bloco com ícone em tile de accent suave, título, resumo e link "Ler seção" com seta que anda 2 px no
  hover. Sem sombra; a borda fica accent no hover.
- **Código**: barra superior com linguagem em mono, botão de copiar e feedback "Copiado"; rolagem horizontal dentro do
  bloco, sem estourar a página.
- **Callout**: ícone circular de 24 px no canto superior esquerdo, padding de 17 px e recuo de 60 px para o texto;
  variantes de nota (violeta) e atenção (rosa), sem raio e sem sombra.
- **Tabelas**: sem borda externa, linhas separadas por `--d-table-line`, cabeçalho mono em caixa alta, rolagem
  horizontal em telas estreitas.
- **Índice**: sticky a partir de 1280 px, seção ativa em accent, botão "Copiar link" com ícone de link e confirmação.
- **Estados e movimento**: transições de interface de 0,15 s com `cubic-bezier(.4,0,.2,1)`; preenchimento do botão
  primário em 0,35 s com `cubic-bezier(.9,.1,.1,.9)`; gaveta em 200 ms; setas com deslocamento de 2 px. Tudo é
  desligado em `prefers-reduced-motion: reduce`.
- **Sombras**: só no painel de busca e no menu de tema, com os mesmos dois níveis da referência. Cartões, callouts,
  tabelas e botões não têm sombra.

## O que é nosso

- Marca, textos e exemplos do WhatsAI, baseados em `README-WHATSAI.md` e `README.md`. Nenhum dado real de cliente.
- Ícones de linha do sprite SVG da própria página; nenhuma biblioteca ou ilustração de terceiro.
- Conteúdo em português, com "triagem" e "organizar os atendimentos", sem nota numérica para pessoas.
- Tema Sistema por padrão, com Claro/Escuro persistidos em `localStorage` (`wa-theme`) e aplicados antes da primeira
  pintura.
- Busca local tolerante a acentos, sem servidor, sem chave e sem requisição de rede.
- Foco visível, armadilha de foco na gaveta, atalhos de teclado e respeito a movimento reduzido.
- CSS e JS externos, sem estilo ou script inline: a CSP de `manager/dist/vercel.json` segue sem `unsafe-inline` e sem
  hash novo.
- Rodapé com os links do produto, da área do cliente e do projeto, além do aviso da condição 1b da licença do
  Evolution API.

## O que ficou de fora, de propósito

- "Ask AI" e qualquer busca com servidor ou chave de API.
- Fontes proprietárias, CDN, telemetria de terceiros e imagens de marca de outros produtos.
- Menu com dezenas de grupos: o manual tem 11 seções de primeiro nível e a busca cobre o restante.
- Botões comerciais no topo da documentação; o caminho para o site e o painel já existe no topo e no rodapé.
- Home em largura total com três colunas: o nosso conteúdo é um manual contínuo, então a coluna de leitura de 672 px
  com índice lateral atende melhor. Se o manual ganhar uma página inicial própria, a grade larga da referência pode
  ser reavaliada.

## Limitações registradas

- As capturas do Render são de páginas públicas, feitas sem autenticação. Não houve bloqueio de captura automatizada.
- As fontes proprietárias não foram usadas; por isso o desenho das letras e algumas quebras de linha diferem.
- A comparação é visual e de medidas CSS. O conteúdo, a busca, os textos e os estados de interação são implementações
  próprias, não uma cópia do comportamento interno do Render.

## Recomendações para evoluir

1. Gerar índice e corpo a partir de `README-WHATSAI.md` no build, para não manter duas fontes de texto.
2. Acrescentar "Copiar página em Markdown" e navegação anterior/próxima entre seções.
3. Adicionar feedback "Esta página foi útil?" e um link direto para abrir uma issue no GitHub.
4. Guardar no navegador o estado dos grupos recolhidos da navegação.
5. Incluir `/docs` na meta de Lighthouse e nas capturas automatizadas de 390, 768, 1024 e 1440 px, claro e escuro.
6. Manter a semântica de cor do painel: verde = ok, âmbar = atenção e vermelho = erro; não voltar ao rosa/roxo do Render nos callouts.
