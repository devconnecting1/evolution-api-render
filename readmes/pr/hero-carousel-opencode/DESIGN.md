# Decisões de design: carrossel de cards no hero

## Método

- Referência pública: home do opencode.ai em 1440 e 390 px, temas claro e escuro, capturada em 15/11/2026.
- Foram observados a mecânica da trilha, a proporção dos cards, o snap, as setas, o estado desabilitado, a sobreposição
  do texto no celular e a hierarquia entre mídia, título, texto e ação.
- Não foram copiados arquivos, CSS, fontes, textos, logos, imagens ou vídeos da referência.
- O HTML, o CSS e o JS foram escritos à mão, com os tokens e o conteúdo do WhatsAI.
- As capturas da referência ficam em `reference/` apenas para revisão e não são publicadas.

## Estrutura do hero

```
hero
├── kicker
├── h1
├── lead
├── ações (Agendar demonstração / Ver planos)
├── linha de planos
└── carrossel
    ├── h2 oculto
    ├── trilha (ul, rolagem horizontal, snap)
    │   └── 4 cards
    │       ├── mídia 4:5 (mockup + selo + nota)
    │       └── texto (kicker, título, texto, ação)
    └── pé (aviso de ilustrativo + setas)
```

No desktop, a mídia fica acima do texto. No celular, o texto é absoluto na base da mídia e um degradê verde profundo
garante contraste. A altura mínima da mídia no celular é 400 px (420 px abaixo de 360 px) para o texto não cobrir a
simulação.

## Tokens

| Uso | Token |
| --- | --- |
| Fundo da mídia | Gradiente entre `--wa-card`, `--wa-bg`, `--wa-art-hill-3` e `--wa-card-2` |
| Texto | `--wa-fg`, `--wa-fg-2`, `--wa-fg-3` |
| Accent | `--wa-accent`, `--wa-accent-soft`, `--wa-accent-line` |
| Atenção | `--wa-warn`, `--wa-warn-bg`, `--wa-warn-line` |
| Texto sobre a mídia no celular | `--c-dark-text`, `--c-dark-text-2`, `--c-dark-text-3` |
| Ação no celular | `--c-dark-text` de fundo, `--c-dark-surface` de texto |

Nenhuma cor nova. O verde continua com significado: atendimento, confirmação e estado ok. O âmbar aparece só na pausa
humana e no lead urgente.

## Componentes

- **Trilha:** `display: grid`, `grid-auto-flow: column`, `overflow-x: auto`, `scroll-snap-type: x mandatory`, barra
  escondida. A largura do card é calculada por `--wa-hc-visible` e `--wa-hc-gap`.
- **Card:** mídia 4:5, kicker numerado, título, texto de até três linhas e uma ação.
- **Mídia:** mockup em HTML/CSS com barra de janela, bolhas, agenda, lista de leads, selo de estado e nota de
  resultado. Tudo decorativo (`aria-hidden`).
- **Selo:** pílula pequena no canto superior esquerdo, com ponto verde ou âmbar, no padrão dos estados do painel.
- **Nota:** cartão flutuante no canto inferior direito, com ícone de linha e duas linhas de texto.
- **Setas:** 32 px, sem borda, cor secundária, `aria-disabled` nas pontas, escondidas em `pointer: coarse` e sem JS.
- **Ação:** fantasma no desktop; branca de 44 px no celular, para o toque e para o contraste com o degradê.

## Movimento

- Só o `transform` dos mockups no hover e o deslocamento da trilha.
- `scrollTo` com `smooth` quando o sistema permite; `auto` em `prefers-reduced-motion`.
- Sem autoplay, sem timer, sem animação de entrada.

## Responsivo

| Largura | Cards visíveis | Ajuste |
| --- | --- | --- |
| >= 1200 px | 3,6 | Mídia 4:5 e texto abaixo |
| 900-1199 px | 2,6 | Idem |
| 720-899 px | 2,2 | Idem |
| <= 719 px | 1,12 | Texto sobreposto, mídia com 400 px de altura mínima, ações sólidas |
| <= 359 px | 1,12 | Mídia com 420 px de altura mínima |

O próximo card sempre aparece cortado à direita, como na referência, para indicar que há mais conteúdo.

## O que é nosso

- Marca, textos, preços, planos, exemplos e mockups do WhatsAI.
- Ícones de linha do sprite SVG da própria página.
- Gradientes, selos e notas em HTML/CSS.
- Conteúdo em português, com "triagem" e "organizar os atendimentos", sem promessa de resultado.
- Dados fictícios nas conversas, leads e agenda.

## O que ficou de fora, de propósito

- Logo, marca, nomes e textos do opencode.
- Imagens, vídeos, fontes e CSS da referência.
- Autoplay.
- Logos de terceiros na página.
- Qualquer requisição externa, CDN, cookie ou telemetria nova.

## Alternativas consideradas

1. **Manter a janela única e colocar o carrossel abaixo.** Duplicaria o papel da janela e alongaria o hero. A janela
   foi substituída pelo carrossel.
2. **Quatro botões sólidos no desktop.** Competiria com o CTA principal do hero. A ação fantasma mantém a hierarquia;
   no celular, o botão branco compensa a ausência do CTA acima.
3. **Autoplay.** A referência não usa e a página é de conversão; movimento automático atrapalha a leitura e a
   acessibilidade.
4. **Texto abaixo da mídia no celular.** Deixaria o card alto e o texto fora da dobra. A sobreposição com degradê é a
   solução da referência e foi mantida.
5. **Imagens externas.** O projeto não usa imagens externas na landing; os mockups continuam em HTML/CSS.

## Limitações e próximos passos

- O texto do hero é maior que o da referência; em 1440 x 900 px o texto dos cards fica logo abaixo da dobra.
- A comparação com a referência é de mecânica e proporção, não de conteúdo visual: a mídia é um mockup de interface,
  não uma foto ou vídeo de tela cheia.
- Antes do merge: rodar Lighthouse em `/` e `/seguranca` e conferir a página com a API simulada.
- Se a direção for aprovada, a evolução natural é um quinto card para "Processos", mas só se o dono quiser dar mais
  peso ao público de advocacia no topo.
