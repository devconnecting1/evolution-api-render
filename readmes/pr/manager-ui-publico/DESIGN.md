# Decisões de design: painel com a linguagem do site público

## Objetivo

O sistema do projeto (painel) e as páginas públicas (Docs e Landing) pareciam dois produtos: o site já era neutro,
Geist, com bordas finas, cantos de 2 px e títulos leves; o painel tinha raios de 6/8 px, um dark quente com creme e uma
escala própria. A referência de linguagem é o [Render](https://render.com/), cujo site e docs combinam tipografia
grande, contraste preto/branco, bordas de 1 px e controles discretos.

A decisão foi compartilhar a linguagem, não copiar a página. O painel precisa de sidebar, topo, tabelas, filtros e
ações; o Docs precisa de leitura longa. Os dois usam o mesmo sistema de tokens e componentes, mas mantêm a estrutura
adequada ao seu trabalho.

## Fonte dos valores

A ponte usa os mesmos valores de `manager/dist/assets/tokens.css`:

| Papel | Claro | Escuro |
| --- | --- | --- |
| Fundo/canvas | `#ffffff` | `#0d0d0d` |
| Superfície | `#fafafa` | `#141414` |
| Texto | `#0d0d0d` | `#ffffff` |
| Texto de apoio | `#4d4d4d` | `#e3e3e3` |
| Texto fraco | `#6b6b6b` | `#b3b3b3` |
| Borda | `#e3e3e3` | `#272727` |
| Borda forte | `#c7c7c7` | `#4d4d4d` |
| Primário | `#0d0d0d` | `#ffffff` |
| Texto do primário | `#ffffff` | `#0d0d0d` |
| Hover do primário | `#272727` | `#e3e3e3` |
| Raio de campo/card | 2 px | 2 px |

Os tokens semânticos seguem o site:

- verde `#0e7a4d` no claro e `#5fcf8a` no escuro;
- âmbar `#d97706` no claro e `#fcd38d` no escuro;
- vermelho `#b42318` no claro e `#fca5a5` no escuro;
- chips com os fundos de nota, aviso e erro do site.

## Por que uma ponte, e não carregar tokens.css

O site decide o tema por `data-theme-mode` (`light`/`dark`) e por `prefers-color-scheme`; o painel decide por
`data-theme` (`light`/`dark`) no `<html>`. Carregar `tokens.css` no painel faria o tema do sistema operacional vencer
o seletor manual do painel em alguns casos. A ponte:

- replica os valores públicos nos dois estados do painel;
- mantém o painel independente de `prefers-color-scheme`;
- permite que o tema manual do painel continue funcionando;
- deixa explícito o ponto de sincronização quando o site mudar.

O bloco fica no fim de `design-system.css`, que já era o último CSS do painel e vencia as regras anteriores sem
`!important`. Nenhum JS foi alterado.

## Componentes

### Títulos

- 24 px, peso 500, `line-height` 1.3 e `letter-spacing` -0.02 no desktop.
- 20 px em 1023 px ou menos.
- A escala é menor que o h1 de 48-64 px do Docs de propósito: o painel tem tabelas, filtros e ações na mesma dobra.
  O que se alinha é o peso, o contraste e o ritmo, não o tamanho de leitura.

### Cards, controles e chips

- O token de raio foi para 2 px; os controles que usavam `--m-radius-field`, `--m-radius-item` e `--m-radius-card`
  acompanham.
- Chips ficaram quadrados; pílulas continuam apenas onde já eram status.
- O login perdeu a faixa de marca (`::before`), ganhou cartão de 2 px e, no celular, borda e padding internos.
- O console perdeu a moldura externa de cartão; a lateral ganhou a divisória vertical do Docs e o topo perdeu a linha.

### Cores com significado

- O accent é preto/branco; não há roxo, azul ou verde decorativo.
- Verde, âmbar e vermelho continuam reservados a conectado/atenção/erro.
- Os gráficos usam uma escala neutra. Se um gráfico precisar de mais séries, a recomendação é uma paleta intencional,
  documentada, e não as cores antigas de gráfico.

### Exceções

- As bolhas do chat mantêm 20 px de raio; são mensagens, não cards de página.
- Os alvos de toque mantêm 44 px em telas de toque; a densidade de 32/28 px vale para mouse.
- O Docs usa corpo maior; o painel mantém 13/14 px para caber tabelas e filtros.

## Comparações

As folhas em `comparacao/` mostram:

- login, instâncias e visão geral em 1440, 768 e 390 px, claro e escuro;
- a referência Render ao lado da Landing, do Docs e do painel depois.

As capturas usam dados fictícios e uma API simulada. O Render é usado só como referência de linguagem; nenhum asset
ou texto dele entra no produto.

## Acessibilidade

Contrastes calculados sobre os tokens:

| Par | Claro | Escuro |
| --- | --- | --- |
| Texto principal | 19,44:1 | 19,44:1 |
| Texto de apoio | 8,45:1 | 15,14:1 |
| Texto fraco | 5,33:1 | 9,27:1 |
| Texto do botão primário | 19,44:1 | 19,44:1 |
| Chip verde | 10,97:1 | 13,76:1 |
| Chip âmbar | 9,12:1 | 11,42:1 |
| Chip vermelho | 11,21:1 | 9,06:1 |

- O foco visível continua com 2 px e usa o accent do tema.
- Campos usam borda `#8f8f8f`, que passa no critério de 3:1 para componentes.
- A ordem de títulos, a navegação e os alvos não mudaram.
- A tabela de instâncias rola dentro do wrapper no tablet/desktop estreito; a página não ganha rolagem horizontal.

## Alternativas consideradas

1. **Copiar o layout de página do Docs para o painel.**
   Perderia sidebar, tabela e filtros; o painel ficaria mais bonito e menos útil. Rejeitado.
2. **Carregar `tokens.css` diretamente no painel.**
   O tema manual do painel e o `prefers-color-scheme` do site brigariam. A ponte resolve sem alterar o site.
3. **Manter o dark quente e ajustar só os raios.**
   Era a diferença mais visível entre o painel e o site. O dark neutro é o principal ganho desta rodada.
4. **Usar um accent verde, roxo ou azul no painel.**
   O site usa cor só com significado; o accent neutro mantém a leitura e o contraste.
5. **Arredondar tudo para 8-12 px como um app genérico.**
   O Docs e a Landing usam 2 px; o painel agora fala a mesma língua.
6. **Trocar todos os 13/14 px por 18 px.**
   Aumentaria a leitura, mas quebraria a densidade de tabelas, filtros e listas. A escala de conteúdo continua menor e
   documentada.

## Implementação

- `manager/dist/assets/design-system.css`: bloco de ponte no fim, depois de todas as regras antigas.
- `manager/patches/design-system.py`: `CSS_VERSION = 2`, `CACHE_VERSION = 82` e troca do link `?v=1` pelo `?v=2`.
- `manager/dist/index.html`: `design-system.css?v=2` e bundle `?v=82`.
- Nenhum JS do bundle foi editado; o esqueleto de layout e os componentes continuam os mesmos.
- O patch continua determinístico e todos os `--check` passam.

## Limitações e próximos passos

- A ponte repete os valores do site; a sincronização é manual. O próximo passo é gerar o bloco a partir de
  `tokens.css` ou expor os tokens públicos também para `data-theme`.
- O `theme-color` do navegador ainda usa `#10100e`/`#f5f5f5` no script inline; mudar isso exige atualizar a CSP e o
  teste de segurança. Ficou fora desta rodada.
- O painel mantém a densidade de sistema; se o dono quiser a escala de leitura do Docs, é uma decisão separada.
- As bolhas do chat e os alvos de toque são exceções deliberadas.
- O PR não foi mesclado; a revisão do dono decide se a ponte entra como está, se vira geração automática ou se o
  console deve perder mais estrutura.
