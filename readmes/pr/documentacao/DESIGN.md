# Documentação pública: decisões de design

Esta página (`/docs`) foi escrita à mão em HTML, CSS e JS, sem framework, sem dependência externa e sem asset de
terceiros. O padrão de documentação do Render serviu só como referência de organização e de leitura. Marca, textos,
cores, fontes, ícones e CSS são do WhatsAI.

## O que foi inspirado no padrão do Render

- Topo compacto e fixo: marca à esquerda, busca global no centro, links de produto e de projeto à direita.
- Navegação persistente à esquerda, agrupada por tarefa (Começar, Atendimento, Operação), com a seção atual destacada.
- Artigo em coluna larga e confortável, com título grande, subtítulo de uma linha e ações no topo.
- Índice "Nesta página" à direita, acompanhando a rolagem, visível a partir de 1200 px.
- Cards de entrada logo abaixo do herói para levar a quem chega aos assuntos principais.
- Blocos de código com barra de linguagem e botão de copiar; tabelas densas; passos numerados; callouts de nota,
  atenção e limite; perguntas frequentes em acordeão.
- Busca local com resultados sobre o conteúdo, teclado e atalho, sem recarregar a página.
- Abaixo de 1024 px, a navegação vira gaveta com cortina; a busca ocupa a segunda linha do topo no celular.

## O que é nosso

- Toda a paleta "Meu Tema Global": claro com página `#f5f5f5`, superfície branca e tinta `#1a1a1a`; escuro com
  `#10100e` e creme `#ffffe3`. Verde, âmbar e vermelho só com significado (ok, atenção, erro).
- Tipografia Geist em todo o site, inclusive nos blocos de código, para manter a identidade do projeto.
- Raios de 4 px em controles e 8 px em cartões, sem sombras, como no site e no painel.
- Conteúdo em PT-BR baseado em `README-WHATSAI.md` e `README.md`: visão geral, primeiros passos, conexão (Baileys e
  Cloud API), atendente de IA, Leads, Agenda, Processos, equipe e segurança, planos e limites, operação e FAQ.
- Ícones de linha desenhados no próprio HTML (sprite SVG), sem biblioteca.
- Tema Sistema por padrão, com escolha Claro/Escuro persistida em `localStorage` (`wa-theme`) e aplicada antes da
  primeira pintura.
- Nenhum script ou estilo inline: `docs.css` e `docs.js` são externos, então a CSP de `manager/dist/vercel.json`
  continua sem `unsafe-inline` e sem hash novo. A página não faz requisição de rede além dos próprios arquivos.
- Busca 100% no navegador, tolerante a acentos, filtrando seções e títulos e destacando o trecho encontrado.
- Foco visível, navegação por teclado (setas, Enter, Escape, `/` e Ctrl/Cmd+K), armadilha de foco na gaveta e
  respeito a `prefers-reduced-motion`.
- Rodapé com os links do produto, da área do cliente e do projeto, mais o aviso da condição 1b da licença do
  Evolution API.

## Medidas e tokens usados

| Item | Medida |
| --- | --- |
| Largura máxima da página | 1560 px |
| Coluna da navegação | 264 px |
| Coluna do artigo | 820 px (padding de 40 px nas laterais) |
| Índice lateral | 232 px, só a partir de 1200 px |
| Topo | 60 px no computador; 105 px no celular, com a busca na segunda linha |
| Título da página | `clamp(30px, 4.4vw, 42px)`, peso 650 |
| Seção | `clamp(23px, 3vw, 27px)`; subseção 16,5 px |
| Corpo | 15,5 px com entrelinha 1,65 |
| Código | 12,5 px com rolagem horizontal |
| Raios | 4 px (controles) e 8 px (cartões, callouts, tabelas) |
| Breakpoints | 1200 px (índice), 1024 px (gaveta), 860 px, 719 px e 559 px |

## O que ficou de fora, de propósito

- "Ask AI" e qualquer busca com servidor ou chave de API: a página é estática e não deve expor credencial.
- Menu gigante com dezenas de grupos recolhíveis: o manual tem 11 seções de primeiro nível, e a busca cobre o resto.
- Botões comerciais no topo da documentação: o caminho de volta ao site e ao painel já está no topo e no rodapé.
- Métricas de terceiros, fontes externas, CDN e imagens de marca de outros produtos.

## Recomendações para evoluir depois

1. Gerar o índice e os blocos do artigo a partir de `README-WHATSAI.md` no build, para não haver duas fontes de texto.
2. Acrescentar "Copiar página em Markdown", como no padrão estudado, e navegação anterior/próxima entre seções.
3. Adicionar feedback "Esta página foi útil?" e um link direto para abrir uma issue no GitHub.
4. Quando o manual crescer, permitir recolher grupos da navegação e guardar o estado no navegador.
5. Incluir `/docs` na meta de Lighthouse e nas capturas automatizadas de 390/768/1024/1440 px, claro e escuro.
