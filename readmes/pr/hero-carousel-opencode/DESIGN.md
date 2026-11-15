# Decisões de design: hero em carrossel e faixa de destaque

## Método

- Referências públicas: carrossel de produtos e bloco de console da home do opencode.ai, em 1440 e 390 px, temas claro
  e escuro, capturados em 15/11/2026.
- Foram observados a mecânica da trilha, a proporção dos cards, o snap, as setas, o estado desabilitado, a sobreposição
  do texto no celular, o fundo grafite com grade de pontos e a hierarquia entre mídia, título, texto e ação.
- Não foram copiados arquivos, CSS, fontes, textos, logos, imagens, vídeos ou o visual do console da referência.
- O HTML, o CSS e o JS foram escritos à mão, com os tokens e o conteúdo do WhatsAI.
- As capturas da referência ficam em `reference/` apenas para revisão e não são publicadas.

## Estrutura do hero

```
hero
├── h1
├── lead
├── ações (Agendar demonstração / Ver planos)
├── linha de planos
└── carrossel
    ├── h2 oculto
    ├── nota oculta sobre mockups fictícios
    ├── trilha (ul, rolagem horizontal, snap)
    │   └── 4 cards
    │       ├── mídia 4:5 (mockup + selo + nota)
    │       └── texto (título, texto, ação)
    └── setas (só no desktop com ponteiro)
```

Não há rótulo pequeno acima do título, do carrossel ou das seções. O título e o lead carregam a hierarquia.

## Faixa de destaque

```
faixa (fundo #1a1a1a + pontos)
├── painel de operação (12 leads, 5 horários, 3 com a equipe, próximo passo, uso do mês)
└── copy
    ├── h2 "O atendimento inteiro em um só painel."
    ├── parágrafo curto
    └── ação "Agendar demonstração"
```

A faixa fica entre "Sempre um passo à frente" e os planos. No celular, a copy vem antes do painel. Não há rótulo
"CONSOLE" nem outro texto pequeno de seção, por decisão do dono.

A grade de pontos é um pseudo-elemento mascarado de cima para baixo: 6% de opacidade no topo, 18% a 35%, 70% a 72% e
100% na base. Assim os pontos quase somem atrás do título e ficam claros na parte de baixo, como na referência. Se o
navegador não suportar `mask-image`, os pontos aparecem uniformes, sem quebrar o layout.

## Tokens

| Uso | Token |
| --- | --- |
| Accent | `--c-accent: var(--c-text)` (preto no claro, branco no escuro) |
| Accent suave | `--c-accent-soft: var(--c-bg-muted)` |
| Accent de borda | `--c-accent-border: var(--c-border-strong)` |
| Foco e seleção | `--c-focus: var(--c-text)`; `--c-selection: var(--c-bg-muted)` |
| Botão primário | `--c-btn-bg` / `--c-btn-text`, com hover neutro `#272727` / `#e3e3e3` |
| Mídia no desktop | Gradientes entre `--wa-card`, `--wa-bg`, `--wa-art-hill-3` e `--wa-card-2` |
| Mídia no celular | `#161616`, texto `--c-dark-text` |
| Faixa de destaque | `#1a1a1a`, texto `#ffffff`, texto secundário `rgba(255,255,255,.68)` |
| Atenção | `--wa-warn`, `--wa-warn-bg`, `--wa-warn-line` |

O verde saiu do accent da landing. O âmbar continua com significado: pausa humana e contato urgente. O plano Premium
tem um conjunto local de tokens escuros para que o accent branco e os checks continuem legíveis sobre o cartão
grafite.

A paisagem decorativa, os cartões de destaque e o carrossel também passaram a usar cinza. O plano Premium mantém os
pixels animados, agora brancos e com brilho máximo de 0,18.

## Componentes

- **Trilha:** `display: grid`, `grid-auto-flow: column`, `overflow-x: auto`, `scroll-snap-type: x mandatory`, barra
  escondida. A largura do card é calculada por `--wa-hc-visible` e `--wa-hc-gap`.
- **Card:** mídia 4:5, título, texto de até três linhas e uma ação. Sem rótulo numerado.
- **Mídia:** mockup em HTML/CSS com barra de janela, bolhas, agenda, lista de leads, selo de estado e nota de
  resultado. Tudo decorativo (`aria-hidden`). No desktop, fundo cinza claro; no celular, grafite.
- **Selo:** pílula pequena no canto superior esquerdo, com ponto neutro ou âmbar, no padrão dos estados do painel.
- **Nota:** cartão flutuante no canto inferior direito, com ícone de linha e duas linhas de texto.
- **Setas:** 32 px, sem borda, cor secundária, `aria-disabled` nas pontas, escondidas em `pointer: coarse` e sem JS.
- **Ação do card:** fantasma neutra no desktop; branca de 44 px no celular.
- **Faixa de destaque:** painel de operação com borda `rgba(255,255,255,.16)`, grade de pontos mascarada de cima
  para baixo, números brancos, linhas `rgba(255,255,255,.14)` e botão branco.

## Movimento

- Só o `transform` dos mockups no hover e o deslocamento da trilha.
- `scrollTo` com `smooth` quando o sistema permite; `auto` em `prefers-reduced-motion`.
- Os pixels do Premium continuam a ~30 fps, com um quadro parado em `prefers-reduced-motion`.
- Sem autoplay, sem timer e sem animação de entrada.

## Responsivo

| Largura | Cards visíveis | Ajuste |
| --- | --- | --- |
| >= 1200 px | 3,6 | Mídia 4:5 cinza e texto abaixo |
| 900-1199 px | 2,6 | Idem |
| 720-899 px | 2,2 | Idem |
| <= 719 px | 1,12 | Mídia grafite com 400 px de altura mínima, texto sobreposto e ações sólidas |
| <= 359 px | 1,12 | Mídia com 420 px de altura mínima |

O próximo card sempre aparece cortado à direita, como na referência, para indicar que há mais conteúdo. A faixa de
destaque vira uma coluna em 900 px: copy primeiro, painel depois.

## O que é nosso

- Marca, textos, preços, planos, exemplos e mockups do WhatsAI.
- Ícones de linha do sprite SVG da própria página.
- Gradientes, selos, notas, painel de operação e grade de pontos em HTML/CSS.
- Conteúdo em português, com "triagem" e "organizar os atendimentos", sem promessa de resultado.
- Dados fictícios nas conversas, leads, agenda e painel de operação.

## O que ficou de fora, de propósito

- Logo, marca, nomes, textos, console e produtos do opencode.
- Imagens, vídeos, fontes e CSS da referência.
- Rótulos pequenos de seção e legendas visíveis de mockup.
- Autoplay.
- Logos de terceiros na página.
- Qualquer requisição externa, CDN, cookie ou telemetria nova.

## Alternativas consideradas

1. **Manter o verde nos cards.** Foi a primeira versão. O dono pediu a remoção porque o fundo verde ficou pesado; o
   cinza no desktop e o grafite no celular deixaram a interface mais sóbria.
2. **Manter o accent verde em links e botões.** O pedido foi accent neutro invertido. O preto no claro e o branco no
   escuro mantêm contraste e não competem com o âmbar de atenção.
3. **Manter os rótulos pequenos.** Eles davam contexto, mas criavam ruído visual. Foram removidos; a hierarquia ficou
   com título, lead e texto de apoio.
4. **Manter as legendas "Ilustrativo".** Saíram do visual. A indicação continua no `aria-label`, na nota `sr-only` do
   carrossel e no comentário do HTML.
5. **Faixa de destaque com o rótulo "CONSOLE".** Não foi trazido porque o pedido foi remover os textos pequenos. A
   faixa mantém o fundo, os pontos, a ação e o contraste.
6. **Autoplay.** A referência não usa e a página é de conversão; movimento automático atrapalha a leitura e a
   acessibilidade.

## Limitações e próximos passos

- O hero do WhatsAI é mais longo que o da referência; em 1440 x 900 px o texto dos cards fica logo abaixo da dobra.
- A mídia é um mockup de interface, não uma foto ou vídeo de tela cheia.
- A faixa de destaque acrescenta altura à página; ela não substitui o CTA final.
- Antes do merge: repetir o Lighthouse em `/` e `/seguranca` e conferir a página com a API simulada.
- Se o dono quiser limpar ainda mais, os próximos candidatos são as categorias pequenas dos cartões de Novidades e
  Destaques.
