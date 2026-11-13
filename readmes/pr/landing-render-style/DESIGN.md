# Landing e cabeçalho no padrão de home de produto

Documento de apoio do PR `feat/landing-render-style`. Explica a anatomia adotada, os tokens, as medidas, o que foi
adaptado da referência (a home do Render) e o que foi deliberadamente deixado de fora. Serve para revisar o desenho
sem precisar abrir o CSS linha a linha.

## Contexto

A landing antiga era uma página de vendas em blocos, com um cabeçalho próprio, e as páginas legais
(`/seguranca`, `/termos`, `/privacidade`) tinham outro cabeçalho (`legal-top`): marca, um link de voltar e nada de
navegação. O pedido foi unificar o topo das quatro páginas e redesenhar a home seguindo a anatomia da home do Render,
com a marca, o verde e a tipografia Geist do WhatsAI.

Nada do Render foi copiado: nem logo, nem textos, nem fontes, nem ilustrações, nem CSS. A referência foi usada só
como estrutura de leitura (o que vem antes do quê, como o topo se comporta, como as seções respiram). As capturas da
referência ficam em `referencia-render/` apenas para comparação lado a lado.

## Arquivos alterados

| Arquivo | O que muda |
| --- | --- |
| `manager/dist/landing/index.html` | Reestruturado na anatomia de home de produto; cabeçalho compartilhado; conteúdo comercial preservado |
| `manager/dist/assets/landing.css` | Reescrito: tokens, tipografia, grade de recursos, mockups, planos, tabelas empilhadas no celular |
| `manager/dist/assets/landing-theme.css` | Só tokens do modo escuro e dois ajustes de contraste |
| `manager/dist/assets/landing.js` | Só contato (origem e UTM) e barra fixa do celular; o topo saiu daqui |
| `manager/dist/assets/site-header.css` | Novo: cabeçalho autossuficiente das quatro páginas públicas |
| `manager/dist/assets/site-header.js` | Novo: gaveta, menus, filete e contato do cabeçalho |
| `manager/dist/landing/seguranca.html`, `termos.html`, `privacidade.html` | Passam a usar o mesmo `site-head`; `legal-top` removido |
| `manager/dist/landing/legal.css` | Remove `.legal-top`; topo de 64 px vira `--d-topbar` |
| `manager/patches/landing-css.mjs` | Inclui `site-header.css` no bundle e aceita o novo `<link>` |
| `manager/dist/assets/landing.bundle.css` | Regenerado pelo patch (hash `?v=` no `index.html`) |

## 1. Cabeçalho único

### Markup

O mesmo bloco nas quatro páginas, copiado literalmente (sem include, porque o site é estático):

- marca `WhatsAI` com o ponto verde;
- navegação principal com dois menus (Produto e Segmentos) e três links diretos (Planos, Dúvidas, Documentação);
- ações de topo: `Entrar no painel` (borda) e `Agendar demonstração` (verde, com `data-sh-wa`);
- botão de menu no celular com dois ícones (abrir/fechar) e um `.sr` cujo texto o JS troca entre "Abrir menu" e
  "Fechar menu";
- a gaveta repete as ações no fim (`sh-drawer-end`), porque no celular os botões do topo ficam ocultos.

O cabeçalho é autossuficiente: `.site-head` define os próprios tokens `--sh-*`, então ele não herda cor, altura,
fonte ou foco do CSS da página. Isso permite carregar o mesmo arquivo depois de `landing.css` (na home, dentro do
bundle) e depois de `legal.css` e `docs.css` (nas páginas legais) sem conflito. As páginas legais carregam
`site-header.css?v=1` e `site-header.js?v=1`; a home recebe o CSS pelo bundle e o JS pelo `<script>` próprio.

### Comportamento (`site-header.js`)

- gaveta no celular: `aria-expanded`, `aria-controls`, classe `.is-open`, trava a rolagem do body, fecha ao clicar
  num link, ao clicar fora e no Escape (devolvendo o foco ao botão);
- Tab preso dentro da gaveta aberta, para não vazar para o conteúdo atrás;
- menus de Produto e Segmentos: abertura por clique, seta para baixo abre e foca o primeiro item, Escape fecha e
  devolve o foco ao botão, clique fora fecha;
- filete inferior aparece quando a página sai do topo (`is-scrolled`, via `requestAnimationFrame`);
- contato: monta `wa.me/5521974699723` com a mensagem padrão, a origem da página (`data-wa-origin`) e
  `utm_source`/`utm_campaign` limpos e limitados a 40 caracteres; o número existe só aqui e é exposto em
  `window.WA_CONTACT_WHATSAPP` para o `landing.js`;
- ao passar de 960 px, a gaveta fecha sozinha (troca de layout sem estado preso).

Sem script inline: a CSP de `manager/dist/vercel.json` continua `script-src 'self'` com os hashes existentes, e
`test/unit/security.test.ts` não precisou mudar.

### Tokens do cabeçalho

| Token | Claro | Escuro |
| --- | --- | --- |
| `--sh-bg` | `rgba(255,255,255,.94)` com blur | `rgba(13,13,13,.92)` com blur |
| `--sh-text` / `--sh-text-2` | `#0d0d0d` / `#4d4d4d` | `#f5f5f5` / `#c7c7c7` |
| `--sh-line` | `#e5e5e5` | `#2b2b2b` |
| `--sh-primary` | `#0e7a4d` | `#5fcf8a` |
| `--sh-tint` | `#e9f6ef` | `#12241a` |
| `--sh-focus` | `#0e7a4d` | `#86efac` |

O escuro é aplicado por `prefers-color-scheme` e também por `data-theme`/`data-theme-mode`, que o `docs.js` grava
antes da primeira pintura nas páginas legais.

### Medidas

| Item | Desktop | ≤ 1120 px | ≤ 959 px | ≤ 379 px |
| --- | --- | --- | --- | --- |
| Altura mínima | 64 px | 64 px | 60 px | 60 px |
| Padding lateral | 32 px | 24 px | 20 px | 14 px |
| Marca | 21 px / 650 | 21 px | 20 px | 20 px |
| Links | 14 px, 36 px de altura | 14 px, padding 8 px | 17 px, 48 px, coluna | coluna |
| Botões do topo | 40 px | 40 px | CTA 38 px; "Entrar" vai para a gaveta | ocultos |
| Botão do menu | — | — | 42 px | 42 px |

A largura máxima do conteúdo é 1344 px, um pouco mais larga que os 1200 px das seções da landing, para o topo
alinhar com a referência sem espremer a navegação.

## 2. Landing

### Anatomia: referência Render x WhatsAI

| Seção da referência | No WhatsAI | Conteúdo | Adaptação |
| --- | --- | --- | --- |
| Topo fixo com menus e CTA | `site-head` | Marca, Produto, Segmentos, Planos, Dúvidas, Documentação, Entrar, Agendar | Markup e CSS próprios; gaveta no celular |
| Herói com título, subtítulo, CTAs e painel visual | `.hero` | "Seu WhatsApp responde em segundos. Sua equipe assume quando quiser.", texto de apoio, dois botões e um painel com conversa ilustrativa | Painel desenhado em HTML/CSS com dados fictícios, não captura de tela |
| Faixa de prova / stack | `.proof` | Chips de texto: WhatsApp, OpenAI, Google Agenda, Meta API, LGPD, Evolution API | Sem logos de terceiros, como pedido |
| Três passos | `#como-funciona` | Conecte, configure, atenda; cada card com um mini-visual e um "versus" do antes/depois | Textos e visuals originais |
| Faixa "whatever your stack" | `#integracoes` | Faixa verde profunda com canais, IA, agenda e sistemas, mais nota de que integrações variam por plano | Faixa escura nos dois temas, como a referência |
| Grade de recursos com mini-visuais | `#tour` | Seis recursos (pausa humana, áudio/foto/PDF, instruções e horários, transcrição, follow-up, relatórios) | Cada card tem um mockup de interface; ids `#pausa`, `#midia`, `#instrucoes` para os menus |
| Depoimento | `.quote-band` | Princípio de atendimento, não depoimento de cliente real | Sem pessoa ou empresa fictícia apresentada como cliente |
| Grade de segmentos | `#segmentos` | Advocacia, clínicas, lojas, imobiliárias, serviços; linha de números (24 h, 100%, 20 s, 5 min) | Números são recursos do produto, não promessa de resultado |
| Segurança / confiabilidade | `/seguranca` linkado no topo e no rodapé | O que está implementado, sem selos | Nenhuma certificação exibida |
| CTA final | `.cta#contato` | "Veja o WhatsAI atendendo os clientes do seu negócio." com botão e telefone | WhatsApp com origem e UTM |
| Rodapé multi-coluna | `footer.foot` | Produto, Recursos, Segmentos, Acesso, marca, aviso da licença Evolution API | Sem GitHub; sem logos de clientes |

### Tokens da landing

Claro (base em `landing.css`):

| Token | Valor | Uso |
| --- | --- | --- |
| `--bg` | `#fbfbf9` | Fundo da página |
| `--bg-soft` | `#f2f4f0` | Seções alternadas |
| `--panel` | `#ffffff` | Cards |
| `--text` / `--text-2` / `--muted` | `#101410` / `#414941` / `#687268` | Títulos / corpo / apoio |
| `--line` / `--line-soft` | `#e0e5df` / `#edf0eb` | Bordas |
| `--primary` | `#0e7a4d` | Verde da marca |
| `--tint` / `--tint-text` | `#e9f6ef` / `#095c39` | Chips e destaques |
| `--lime` | `#c6f27c` | Destaque sobre as faixas escuras |
| `--deep` / `--band-bg` | `#07271b` | Faixas escuras |
| `--focus` | `#0e7a4d` | Foco visível |

Escuro (em `landing-theme.css`, só tokens): página `#0c0f0c`, seções suaves `#121612`, cards `#141914`, tinta
`#eef3ec`, corpo `#c3ccc2`, apoio `#96a296`, bordas `#293229` e `#1f261f`, verde `#5fcf8a`, hover `#86efac`. As
faixas escuras continuam verdes nos dois modos; o chat do herói continua claro, como uma captura de tela do produto.

Sem roxo em nenhum modo. A cor só aparece com significado, como nas demais páginas do projeto: verde para ação e
confirmação, âmbar para atenção, vermelho para erro.

### Tipografia

Geist local (`geist.css`, já no bundle), sem fonte externa.

| Papel | Tamanho | Peso | Detalhes |
| --- | --- | --- | --- |
| Título do herói (`.display`) | `clamp(2.55rem, 1.35rem + 4.6vw, 4.6rem)` | 600 | `line-height: 1.02`, `letter-spacing: -0.05em`, `text-wrap: balance` |
| Título de seção (`.h2`) | `clamp(1.9rem, 1.3rem + 2.3vw, 3rem)` | 600 | `1.08`, `-0.035em` |
| Subtítulo de card (`.h3`) | `clamp(1.05rem, 0.98rem + 0.4vw, 1.22rem)` | 600 | `1.32` |
| Corpo (`.lead`) | `clamp(1rem, 0.95rem + 0.3vw, 1.125rem)` | 400 | `1.62`, largura máxima de 56 caracteres |
| Sobrescrito (`.eyebrow`) | 11.5 px | 600 | caixa alta, `0.14em` |

Números de preço usam `font-variant-numeric: tabular-nums` para as colunas da comparação não dançarem.

### Espaçamento e grades

- Conteúdo: `--maxw: 1200px`, calha de 24 px; seções com `padding-block: clamp(56px, 8vw, 104px)`.
- Herói: `clamp` próprio no topo e na base, sem altura fixa; o painel visual fica ao lado do texto acima de 900 px e
  abaixo dele no celular.
- Recursos: 2 colunas no desktop e 1 coluna até 820 px, com largura máxima de 640 px.
- Segmentos: 3 colunas; 2 colunas até 1000 px; 1 coluna até 720 px.
- Planos: 3 colunas; viram 1 coluna com largura máxima de 640 px até 1000 px (não há versão de 2 colunas para não
  quebrar a leitura de preço).
- Rodapé: marca + 4 colunas; 2 colunas até 1000 px; 1 coluna até 480 px.
- Raios: `8px`, `12px`, `20px`; sombras em duas camadas discretas.

### Componentes com decisão própria

- **Painel do herói**: conversa ilustrativa em HTML/CSS, com etiqueta "Ilustrativo · dados fictícios". Não é captura
  de tela real e não usa nome, telefone ou caso de cliente.
- **Mini-visuais dos recursos**: mockups de interface (bolha de pausa, cartão de áudio, lista de instruções, barra de
  relatório) feitos com divs e SVG inline. Nada de imagem externa.
- **Tabela de adicionais e comparação de planos**: `details` nativos. Até 719 px as duas tabelas são empilhadas com
  `data-label` em cada célula, então não há rolagem horizontal; acima disso, são tabelas normais.
- **FAQ**: 6 perguntas visíveis e um `details` "Ver mais dúvidas" com 8 perguntas aninhadas. Todo o conteúdo antigo
  foi preservado.
- **Barra do celular**: `.sticky-cta` só entra com a classe `.is-on`, quando o botão do herói sai da tela, e sai
  quando `#contato` aparece, para não cobrir o mesmo botão duas vezes.
- **Contato**: o telefone aparece formatado no rodapé e no CTA, e todos os links abrem `wa.me` em nova aba com
  `noopener`. Sem o número configurado, os links continuam rolando até `#contato`.

### Conteúdo comercial preservado

Nada de preço, prazo, adicional ou promessa foi inventado. Os valores da página continuam os mesmos:

| Plano | Mensalidade | Implantação | Número adicional | Extras |
| --- | --- | --- | --- | --- |
| Essencial | R$ 437 | R$ 1.800 | R$ 287 | 200 a 400 conversas/mês |
| Profissional | R$ 767 | R$ 3.500 | R$ 497 | 500 a 1.000 conversas/mês, agenda e follow-up |
| Premium | R$ 1.427 | a partir de R$ 6.400 | R$ 927 | 1.000 a 2.000 conversas/mês, API oficial, integrações |

As notas de piloto (R$ 690), treinamento, acompanhamento, relatório e prazos de entrada também foram mantidas no
texto e na tabela de comparação. O JSON-LD continua com `lowPrice` 437 e `highPrice` 1427.

## 3. Acessibilidade e responsividade

- Foco visível em todos os links e botões (`.site-head` e `.btn`), com `:focus-visible`.
- Skip link como primeira parada do Tab nas quatro páginas.
- Menus com `aria-expanded`/`aria-controls`, Escape devolve o foco, gaveta com Tab preso e rótulo que muda.
- Títulos em ordem, `aria-labelledby` nas seções, `aria-label` nos grupos de links.
- Contraste AA para texto pequeno nos fundos usados, nos dois temas.
- Sem rolagem horizontal em 320, 360, 375, 390, 414, 480, 600, 768, 900, 1000, 1024, 1200 e 1440 px, com FAQ e
  comparação abertos.
- Tabelas empilhadas no celular com rótulo por célula, em vez de rolagem lateral.
- `prefers-reduced-motion`: as únicas animações são o fade curto dos menus e a transição de cor; o menu respeita a
  preferência e não há animação de rolagem em nenhum ponto.

## 4. O que não foi copiado do Render

- Logo, marca, nome, textos, headlines, depoimentos e números.
- Fonte (o Render usa a própria; aqui é Geist, já usada no painel e no site).
- Ilustrações, capturas, ícones e imagens.
- CSS, nomes de classe ou estrutura de componentes.
- Selos e certificações que o WhatsAI não tem (SOC 2, ISO 27001 etc.). A página de segurança só lista o que está
  implementado.
- Logos de terceiros: OpenAI, WhatsApp, Google Agenda e Meta aparecem como chips de texto.
- Links para o GitHub. O rodapé mantém o aviso da licença do Evolution API (Apache 2.0 com condições adicionais),
  exigido pela condição 1b do `LICENSE`.

## 5. Validação executada

```bash
node manager/patches/landing-css.mjs
node manager/patches/landing-css.mjs --check
for f in manager/patches/*.py; do python3 -I $f --check; done
node --check manager/dist/assets/site-header.js
node --check manager/dist/assets/landing.js
npx esbuild manager/dist/assets/landing.bundle.css --log-level=error > /dev/null
```

QA com Playwright em servidor estático local (nunca contra produção):

- capturas em 1440, 1024 e 390, claro e escuro, com recortes por componente;
- cabeçalho idêntico nas quatro páginas, menus e gaveta abrindo e fechando, Escape devolvendo o foco;
- links `wa.me` com origem e telefone formatado;
- barra fixa oculta no topo, visível depois do herói e oculta sobre `#contato`;
- FAQ extra e comparação abertos no celular sem estouro de largura;
- âncoras do topo e do rodapé resolvendo na home;
- nenhum erro de console ou de página.

A suíte completa não foi rodada localmente, conforme a regra do projeto: lint, Prettier, build, tipos, unitários,
integração e patches rodam no GitHub Actions.

## 6. Capturas

As imagens ficam em três pastas, no mesmo enquadramento para comparar:

- `referencia-render/`: home do Render em 1440, 1024 e 390 (viewport e página inteira);
- `antes/`: nossa home e as três páginas legais antes da mudança;
- `depois/`: as mesmas telas depois, mais recortes por componente
  (`hero`, `prova`, `passos`, `integracoes`, `recursos`, `segmentos`, `principio`, `planos`, `duvidas`, `cta`,
  `rodape`), tema escuro, menu aberto, mega menu, comparação e FAQ abertos e a barra do celular.

## 7. Pendências e recomendações

- **Lighthouse**: o ambiente desta tarefa não tem Chrome com Lighthouse instalado. A meta continua 100 nas quatro
  categorias e navegação agêntica 4/4; recomendo rodar no Preview da Vercel ou com `npx lighthouse` num Chromium
  local antes do merge. Os pontos de atenção são o tamanho do HTML (uma página longa) e a quantidade de SVG inline,
  que já vinham do formato anterior.
- **Preços e ofertas**: a página preserva os valores atuais, mas eles vivem em vários lugares (site, `llms.txt`,
  `agents/whatsai.md`, `readmes/RESUMO.md`, `readmes/README-COMERCIAL.md` e manual). Qualquer mudança futura precisa
  passar por todos.
- **Conteúdo**: a grade de segmentos e os mini-visuais foram escritos com exemplos genéricos; se o dono quiser,
  dá para trocar por casos reais anonimizados, sem dados de cliente.
- **Imagens da pasta do PR**: são capturas de QA, não entram no build. Podem ser removidas depois do merge se o
  repositório preferir não carregar o histórico de imagens.
