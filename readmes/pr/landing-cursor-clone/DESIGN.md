# Decisões de design: landing no padrão do Cursor

## Método

- Referência pública: home do Cursor em 1440, 1024 e 390 px, temas claro e escuro.
- Foram observados layout, hierarquia, escala tipográfica, espaçamento, componentes, estados e comportamento
  responsivo. Não foram copiados arquivos, CSS, fontes, textos, logos ou imagens.
- O HTML, o CSS e o JS são escritos à mão e usam a marca e o conteúdo do WhatsAI.
- As capturas de referência ficam em `reference/`, fora de `manager/dist`, e não são publicadas.

## Tokens

| Token | Referência | WhatsAI |
| --- | --- | --- |
| Fundo claro | Creme quente | `#f7f7f4` |
| Fundo escuro | Quase preto | `#14120b` |
| Texto claro | Tinta quase preta | `#26251e` |
| Texto escuro | Branco quente | `#edecec` |
| Accent claro | Laranja/azul da marca | `#1d5c40` |
| Accent escuro | Laranja/azul da marca | `#9fdcb6` |
| Borda | Cinza de baixo contraste | `rgba(38, 37, 30, 0.13)` / `rgba(237, 236, 236, 0.16)` |
| Botão primário | Tinta sobre creme | `#26251e` com texto `#f7f7f4`; inverte no escuro |
| Botão secundário | Contorno claro | Borda `--wa-line-strong`, fundo transparente |

O accent verde é o único acento cromático. O laranja e o azul da referência não foram transportados porque a cor do
WhatsAI precisa manter significado: verde para ok, âmbar para atenção e vermelho para erro.

## Tipografia

| Uso | Referência | WhatsAI |
| --- | --- | --- |
| Família | Fonte proprietária do Cursor | Geist, já carregada pelo site e pelo painel |
| Título do herói | Cerca de 32 px, duas linhas no desktop | `clamp(28px, 3vw, 44px)`, duas linhas no desktop e três no celular |
| Título de seção | Escala editorial grande | `clamp(30px, 3.4vw, 48px)` |
| Corpo | Texto de apoio curto | 16 px, entrelinha 1,5 |
| Rótulos | Caixa alta com tracking | Kicker de 12 px, caixa alta, tracking de 0,08em |

A fonte proprietária não foi copiada nem servida por CDN. A Geist tem métricas diferentes; por isso as quebras de
linha não são idênticas às da referência.

## Layout

- Topo fixo de 52 px, com logo à esquerda, navegação central e ações à direita.
- Largura máxima de 1440 px; padding lateral de 20 px e 70 px a partir de 1200 px.
- Herói com muito espaço em branco, título à esquerda e janela de produto abaixo.
- Seções com `padding-block: clamp(72px, 9vw, 128px)`.
- Grade de recursos em três, duas e uma coluna.
- Planos em três cartões; o Profissional é o destaque, com borda e selo.
- Rodapé em colunas, com produto, segmentos, recursos, empresa e legal.

## Componentes

- **Botões:** pílula, 44 px de altura; 48 px na versão grande. O primário é tinta sobre creme; o secundário é
  contorno. O foco visível usa o accent.
- **Janela de produto:** barra com três pontos, título, colunas de conversa, ficha e resumo. É um mockup em HTML/CSS,
  não uma captura do painel real.
- **Faixa de segmentos:** substitui a faixa de logos de clientes da referência por texto e uma conversa fictícia.
- **Blocos alternados:** texto de um lado, mockup do outro; no celular, empilham.
- **Grade de recursos:** nove cartões com ícone de linha, título e uma frase.
- **Cartões de destaque:** três cartões com arte abstrata em CSS.
- **Planos:** preço, implantação, recursos e CTA; tabela comparativa e FAQ abaixo. O Premium mantém o cartão grafite
  com o canvas de pixels animados da landing atual (`landing-pixels.js`), com máscara antes da lista e pausa em
  `prefers-reduced-motion`.
- **Novidades e destaques:** cartões editoriais com categoria, título e descrição.
- **Movimento:** transições de 0,15 s; menu de 200 ms; tudo desligado em `prefers-reduced-motion: reduce`.

## O que é nosso

- Marca, textos, preços, planos, exemplos e mockups do WhatsAI.
- Ícones de linha do sprite SVG da própria página.
- Paisagem abstrata em gradiente CSS.
- Canvas de pixels do Premium, escrito no projeto e já usado na landing atual.
- Conteúdo em português, com "triagem" e "organizar os atendimentos", sem promessa de resultado.
- Dados fictícios nas conversas, leads e agenda.

## O que ficou de fora, de propósito

- Logo, marca, nomes e textos do Cursor.
- Fontes proprietárias, ilustrações, fotos e capturas de tela da referência.
- Logos de clientes e a faixa de prova social com marcas de terceiros.
- Cores de marca do Cursor.
- Qualquer requisição externa, CDN ou telemetria de terceiros.

## Limitações e próximos passos

- O título do herói é um pouco maior que o da referência para acomodar o português; o lead e a linha de metadados
  também empurram a janela de produto para baixo.
- A página é mais longa que a referência porque inclui planos, comparação e perguntas frequentes.
- Antes de qualquer merge: revisar textos comerciais e jurídicos com o dono, rodar Lighthouse em 1440 e 390, claro e
  escuro, e conferir a página com a API simulada.
- Se a direção for aprovada, a adoção pode ser gradual: primeiro o herói compacto e a janela de produto; depois a grade
  de recursos e os blocos alternados.
