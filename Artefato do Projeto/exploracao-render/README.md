# Exploração visual do painel com o design system do Render

Esta pasta é uma **exploração isolada**, não uma mudança do painel. Ela mostra como três telas do WhatsAI
ficariam com os componentes e a linguagem visual do [Render DDS](https://github.com/R4ph-t/DDS), para o dono
avaliar o que vale aproveitar. Nada aqui é carregado pelo painel em produção, e nenhum arquivo de `src/`,
`prisma/`, `manager/dist/assets/` ou `manager/patches/` foi alterado.

Todos os dados são fictícios: escritório, pessoas, conversas, números e agenda foram inventados para esta
exploração. Não há dados de cliente, telefone real, logo de terceiro ou identificador de modelo de IA.

## O que foi montado

- Protótipo navegável em React 18 + Vite 6, usando os componentes reais do `render-dds` 0.8.6 (MIT).
- Três telas: **Visão geral**, **Conversas** e **Plano e limites**.
- Layout responsivo próprio no vocabulário visual do DDS. O DDS não traz um AppShell/sidebar, então a navegação,
  a barra superior e as grades foram escritas para esta exploração.
- Tema claro e escuro, com o `ThemeProvider` e o `ThemeToggle` do DDS. O tema inicial pode ser forçado por
  `?tema=claro` ou `?tema=escuro`; sem o parâmetro, vale o que estiver no `localStorage`.
- Rotas por hash: `#visao-geral`, `#conversas` e `#plano`.
- Interações de demonstração: abas de período, troca de tema, abertura do menu no celular, toasts e o botão
  "Assumir conversa". Telas fora do escopo mostram um aviso, sem navegar.
- Fontes Inter e Roboto incluídas localmente, sem CDN. O build estático fica em `site/` e o código-fonte em
  `src/`, para consulta e reconstrução.

### Como abrir o protótipo

O `site/` usa módulos ES e precisa ser servido por HTTP (abrir o arquivo direto no navegador não funciona):

```bash
cd "Artefato do Projeto/exploracao-render"
python3 -m http.server 4173 --directory site
```

Depois acesse `http://127.0.0.1:4173/?tema=claro#visao-geral`.

Para reconstruir a partir do código-fonte (opcional; exige Node e acesso ao GitHub para baixar o DDS):

```bash
cd "Artefato do Projeto/exploracao-render"
npm ci
npm run build
```

O `vite.config.mjs` aponta `shiki` para um stub local. O DDS importa Shiki apenas no bloco de código, que não é
usado aqui; sem o stub, o build carrega dezenas de gramáticas e cresce vários MB. O JavaScript final fica em
torno de 1,7 MB (502 kB gzip), já incluindo React, DDS e ícones.

## Capturas

Dimensões usadas, todas em Chromium (Playwright 1.65, `deviceScaleFactor: 1`):

| Aparelho | Viewport | Tema |
| --- | --- | --- |
| Desktop | 1440 x 900 | claro e escuro |
| Tablet retrato | 768 x 1024 | claro e escuro |
| Celular | 390 x 844 | claro e escuro |

São 18 capturas de tela (3 telas x 3 viewports x 2 temas) mais 3 capturas de interação. Todas foram conferidas
sem estouro horizontal (`scrollWidth` igual à largura da viewport) e sem erro de console. O resumo dessa
verificação está em [`capturas/verificacao.json`](capturas/verificacao.json).

### Visão geral

| Claro | Escuro |
| --- | --- |
| ![Visão geral no desktop, tema claro](capturas/desktop/visao-geral-claro.png) | ![Visão geral no desktop, tema escuro](capturas/desktop/visao-geral-escuro.png) |
| ![Visão geral no tablet, tema claro](capturas/tablet/visao-geral-claro.png) | ![Visão geral no tablet, tema escuro](capturas/tablet/visao-geral-escuro.png) |
| ![Visão geral no celular, tema claro](capturas/mobile/visao-geral-claro.png) | ![Visão geral no celular, tema escuro](capturas/mobile/visao-geral-escuro.png) |

### Conversas

| Claro | Escuro |
| --- | --- |
| ![Conversas no desktop, tema claro](capturas/desktop/conversas-claro.png) | ![Conversas no desktop, tema escuro](capturas/desktop/conversas-escuro.png) |
| ![Conversas no tablet, tema claro](capturas/tablet/conversas-claro.png) | ![Conversas no tablet, tema escuro](capturas/tablet/conversas-escuro.png) |
| ![Conversas no celular, tema claro](capturas/mobile/conversas-claro.png) | ![Conversas no celular, tema escuro](capturas/mobile/conversas-escuro.png) |

### Plano e limites

| Claro | Escuro |
| --- | --- |
| ![Plano e limites no desktop, tema claro](capturas/desktop/plano-claro.png) | ![Plano e limites no desktop, tema escuro](capturas/desktop/plano-escuro.png) |
| ![Plano e limites no tablet, tema claro](capturas/tablet/plano-claro.png) | ![Plano e limites no tablet, tema escuro](capturas/tablet/plano-escuro.png) |
| ![Plano e limites no celular, tema claro](capturas/mobile/plano-claro.png) | ![Plano e limites no celular, tema escuro](capturas/mobile/plano-escuro.png) |

### Interações

| Toast no desktop, claro | Toast no desktop, escuro | Menu no celular, claro |
| --- | --- | --- |
| ![Toast depois de assumir a conversa, tema claro](capturas/interacoes/toast-conversas-desktop-claro.png) | ![Toast depois de assumir a conversa, tema escuro](capturas/interacoes/toast-conversas-desktop-escuro.png) | ![Menu lateral aberto no celular](capturas/interacoes/menu-mobile-claro.png) |

## Recomendações

Resumo: **vale aproveitar os padrões de densidade, cards, tabelas e estados; não vale trocar a identidade do
WhatsAI pela identidade do Render nem acoplar o pacote DDS ao painel atual.**

### O que vale adotar

1. **Densidade e hierarquia.** Cards compactos com borda de 1 px, títulos pequenos, números grandes e contexto
   em uma linha. A Visão geral mostra cinco indicadores, gráfico, agenda e tabela sem parecer apertada no
   desktop. É o ganho mais direto e o de menor risco.
2. **StatCard e MetricCard.** O formato "rótulo, número, variação/limite" funciona bem para atendimento e para
   uso do plano. A variação deve continuar escrita em texto ("+12% vs semana passada"), não depender só de cor.
3. **Tabelas compactas com ícone no cabeçalho.** A tabela de últimas conversas e a de limites ficam fáceis de
   escanear. Vale manter uma coluna de status com texto e uma de tempo relativo.
4. **ProgressBar e lista de limites.** O bloco de uso do plano ficou mais claro do que uma lista de números
   soltos. O alerta de "plano saudável" no topo ajuda a leitura.
5. **Layout de três colunas em Conversas.** Lista, conversa e ficha do lead no desktop; no tablet, a ficha sai e
   entra uma faixa compacta de contexto; no celular, fica só a conversa, com o menu em gaveta. Esse recorte
   responde bem às três larguras.
6. **Chips e alertas inline.** Status com texto (aguardando equipe, em atendimento, novo) e avisos curtos dentro
   do contexto, sem modal, combinam com a rotina de triagem.
7. **Navegação em grupos.** "Atendimento" e "Escritório" com seletor de instância no topo deixam a hierarquia
   clara. A ideia é boa; a implementação deve seguir o layout e os tokens atuais do painel.

### O que adotar com ajustes

- **Cor.** O roxo (#9333ea no claro, #a855f7 no escuro) e o amarelo (#facc15) são a identidade do Render. No
  WhatsAI, cor tem significado: verde para ok, âmbar para atenção, vermelho para erro. O roxo compete com esses
  estados e o amarelo pode ser confundido com alerta. Manter a identidade atual e usar o amarelo do DDS somente
  como preenchimento de atenção, nunca como cor de marca.
- **Tipografia.** O DDS usa Inter no corpo e Roboto Light nos títulos. O painel usa Geist, com pesos mais
  estáveis. Não importar as duas famílias: isso aumenta o download, muda a personalidade do produto e piora a
  consistência com o site e o restante do painel. Copiar a hierarquia, não as fontes.
- **Cantos.** O raio 0 do DDS é uma assinatura do Render. O painel já tem raios próprios; manter os atuais (ou
  no máximo um raio pequeno e consistente) evita uma troca visual ampla sem ganho funcional.
- **Tema.** O painel usa **Sistema** por padrão. O `ThemeToggle` do DDS só alterna claro/escuro, tem rótulos em
  inglês e não oferece "Sistema". Se a ideia for adotar o controle, ele precisa de três opções, texto em PT-BR,
  persistência e o mesmo padrão de foco do painel.
- **Badges.** O `Badge` do DDS força `uppercase` e tracking. Em PT-BR, status em caixa alta e letras espaçadas
  cansam a leitura e fogem do padrão de texto do produto. Usar caixa de frase, 12 px no mínimo e cor semântica.
- **Toast.** O toast do DDS é escuro nos dois temas, fica fixo a 1 rem do topo (cobre a barra superior e o nome
  do usuário, como aparece nas capturas), não tem `role="status"`/`aria-live` e o botão de fechar não tem nome
  acessível. A recomendação é manter o padrão visual, mas implementar o toast no painel com anúncio para
  leitores de tela, botão "Fechar" rotulado e posição que não cubra a navegação.
- **Sidebar.** O DDS não tem sidebar. A gaveta do celular nesta exploração abre e fecha, mas não tem focus trap
  nem fechamento por Esc; para produção, isso precisa ser resolvido com o padrão de acessibilidade do painel.

### O que não vale adotar

- **O pacote DDS como dependência do painel.** O painel publicado é um bundle compilado em `manager/dist`, sem
  fonte no repositório, e é ajustado por patches em `manager/patches/*.py`. Colocar React + DDS dentro desse
  bundle exigiria reconstruir o painel (fonte indisponível) ou injetar um runtime paralelo, com alto risco e
  dependências novas (Radix, react-icons, Shiki). O custo não se justifica para ganhos que são principalmente
  visuais.
- **Roxo e amarelo como marca, tema escuro como padrão, cantos retos, Inter/Roboto Light e microtexto em caixa
  alta.** São escolhas coerentes no DDS, mas não são o WhatsAI.
- **Variantes escuras de Badge no tema claro.** As variantes `green`, `yellow`, `blue`, `purple` e `red` do DDS
  foram pensadas para fundo escuro. No claro, o texto amarelo sobre branco tem contraste de 1,53:1, por exemplo.
  Se o DDS for usado como referência, apenas as variantes `*-light` fazem sentido no tema claro.
- **Textos de 8 a 10 px.** Esta exploração usa essa escala para mostrar o quanto o DDS cabe em 1440 x 900. Não é
  uma recomendação de produção: 8 a 10 px são pequenos demais para leitura confortável e para acessibilidade.
  O piso deve ser 12 px para rótulos e 14 px para corpo/mensagens, mesmo que isso reduza a quantidade de
  informação visível de uma vez.

## Acessibilidade e contraste

Contraste calculado pela fórmula WCAG 2.x (não é teste com leitor de tela):

| Combinação | Contraste | Leitura |
| --- | --- | --- |
| Roxo primário claro (#9333ea) sobre branco | 5,38:1 | passa em texto normal AA |
| Texto branco sobre roxo primário claro | 5,38:1 | passa em texto normal AA |
| Roxo primário escuro (#a855f7) sobre #0d0d0d | 4,91:1 | passa em texto normal AA, não passa em AAA |
| Texto #0d0d0d sobre roxo primário escuro | 4,91:1 | passa em texto normal AA |
| Amarelo (#facc15) sobre branco | 1,53:1 | falha; usar só como fundo com texto escuro |
| Texto #0d0d0d sobre amarelo | 12,69:1 | passa |
| Texto secundário claro (#71717a) sobre branco | 4,83:1 | passa em texto normal AA |
| Texto secundário claro sobre cinza (#f4f4f5) | 4,40:1 | falha por pouco em texto normal AA |
| Texto secundário escuro (#a1a1aa) sobre #0d0d0d | 7,58:1 | passa com folga |
| Vermelho destrutivo (#ef4444) sobre branco | 3,76:1 | falha em texto normal; serve para ícone/área grande |

Outros pontos observados no DDS 0.8.6, que precisariam de correção antes de produção:

- `MetricCard` tem o texto "Show/Hide detailed breakdown" fixo em inglês.
- `Tabs` não tem navegação por setas do teclado no componente.
- `ThemeToggle` tem `aria-label`/`title` em inglês e não oferece a opção Sistema.
- `Badge` força caixa alta; `Toast` não tem região viva nem rótulo no botão de fechar.
- O CSS compilado aplica regras de `h1`–`h6` fora de `@layer`, o que sobrepõe utilidades de tipografia do
  Tailwind e torna a previsibilidade dos títulos pior.

A exploração também não testou leitores de tela, navegação completa por teclado, zoom de 200% nem todos os
estados de foco. Antes de qualquer adoção, esses testes são obrigatórios, junto com as capturas de 390, 768,
1024 e 1440 px nos dois temas.

## Esforço e risco

| Caminho | Esforço | Risco | Recomendação |
| --- | --- | --- | --- |
| Copiar densidade, cards, tabelas, chips e progresso usando o CSS/patches atuais | baixo a médio | baixo | recomendado, em fases pequenas |
| Reorganizar Conversas em três colunas, com ficha lateral e recorte de tablet/celular | médio | médio | recomendado como piloto, com revisão de acessibilidade |
| Adotar o DDS inteiro como biblioteca do painel | alto | alto | não recomendado no formato atual do painel |
| Reconstruir o painel a partir de uma fonte nova só para trocar o design system | alto | alto | fora do escopo desta exploração |

O caminho de menor risco é tratar o DDS como **referência de padrões**, não como dependência: aplicar primeiro
os tokens e a tipografia mínima, depois os blocos de indicadores e tabelas, e por último o layout de Conversas.
Cada etapa deve ser validada nas quatro larguras e nos dois temas, com os mesmos dados fictícios.

## Limites desta exploração

- Apenas Visão geral, Conversas e Plano e limites foram desenhadas. Leads, Agenda, Processos, Notificações,
  Atendente IA, Conexão e Equipe e acessos continuam com o desenho atual.
- Não há API, banco, autenticação nem envio real de mensagem. Os botões mostram toasts; as abas de período
  apenas mudam o estado visual.
- A gaveta do celular, os toasts e os demais controles são demonstrativos; não passaram por teste completo de
  teclado, leitor de tela ou focus trap.
- As capturas foram feitas em um Chromium headless, uma instância por vez, sem teste em Safari, Firefox ou
  aparelho físico.
- Não foi rodada a suíte do projeto. O build executado foi apenas o do protótipo, fora do clone do repositório.

## Licenças e créditos

- Componentes e CSS compilados do **render-dds 0.8.6**, de Render, sob licença MIT. O aviso está em
  [`LICENCIAS/render-dds-MIT.txt`](LICENCIAS/render-dds-MIT.txt). Fonte: https://github.com/R4ph-t/DDS.
- Fonte **Inter** sob SIL Open Font License: [`src/fonts/LICENSE-Inter.txt`](src/fonts/LICENSE-Inter.txt).
- Fonte **Roboto** sob Apache License 2.0: [`src/fonts/LICENSE-Roboto.txt`](src/fonts/LICENSE-Roboto.txt).
- Nenhum logo ou marca de terceiro foi usado. O produto exibido é o WhatsAI; "Render" e "DDS" aparecem apenas
  como referência à origem do design system.

## Estrutura da pasta

```text
exploracao-render/
  README.md
  index.html                 entrada do Vite
  package.json               dependências do protótipo
  package-lock.json          versões travadas (render-dds via tag v0.8.6)
  vite.config.mjs            build estático com base relativa
  site/                      build navegável, sem dependência externa
  src/                       código-fonte do protótipo
    main.jsx
    styles.css
    fonts/
    shims/shiki.js
  capturas/
    desktop/                1440 x 900
    tablet/                 768 x 1024
    mobile/                 390 x 844
    interacoes/             toasts e menu
    verificacao.json        estouro, tema e erros de console
  LICENCIAS/
```
