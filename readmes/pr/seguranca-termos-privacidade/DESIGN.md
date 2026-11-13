# Segurança, Termos de Uso e Privacidade sem sidebar

Redesenho das três páginas públicas legais do WhatsAI (`/seguranca`, `/termos` e `/privacidade`). A versão anterior
usava o esqueleto da documentação (`/docs`), com navegação lateral de 280 px, busca no topo e índice lateral. O
resultado ficou pesado para páginas de leitura e de confiança, e a sidebar não existe nas páginas equivalentes do
Render. Nesta versão cada página segue a anatomia da sua referência, sem sidebar e sem busca:

- `/seguranca` é uma página de confiança, com topo de site, herói com grade e arte abstrata, três canais de contato,
  práticas, conformidade, suboperadores e os controles implementados;
- `/termos` e `/privacidade` são documentos legais, com topo de site, herói de título grande, coluna de leitura de
  797 px e índice "Nesta página" à direita a partir de 1280.

O conteúdo jurídico e factual foi preservado, assim como as rotas, o SEO/Open Graph e a CSP. Marca, textos, paleta,
ícones, classes e código são do WhatsAI; nenhum asset, fonte, texto ou CSS do Render foi copiado.

## Método

1. Referências estudadas em 1440x900, 1024x768 e 390x844, no claro e no escuro:
   - `https://render.com/security`
   - `https://render.com/terms`
   - `https://render.com/privacy`
2. Capturas completas da referência em `redesign-render/referencia/render-<pagina>-<largura>-<tema>[-completa].png`
   e recortes de componentes em `redesign-render/recortes/render-*.png`. As medidas de topo, título, artigo, índice,
   cartões e tabelas foram extraídas com o Playwright e usadas só como parâmetro de hierarquia e densidade.
3. Capturas do estado anterior (documentação com sidebar) em `redesign-render/antes/antes-*.png`.
4. Capturas do resultado em `redesign-render/depois/depois-*.png` e recortes equivalentes em
   `redesign-render/recortes/whatsai-*.png`.
5. HTML reescrito à mão, sem framework, sem script inline e sem estilo inline. Tokens, tipografia, botões, avisos,
   tabelas, tema, índice e cópia de link continuam vindo de `manager/dist/docs/docs.css` e
   `manager/dist/docs/docs.js`. O layout próprio destas páginas fica em `manager/dist/landing/legal.css`.
6. Conferência com o Playwright em 360, 390, 768, 1024, 1280 e 1440 px, claro e escuro: largura de rolagem igual à
   largura do viewport, índice visível só a partir de 1280, ausência de busca e de sidebar, tema, cópia de link,
   âncoras e console sem erros.

## Anatomia de cada página

### Segurança (`/seguranca`)

1. Topo de 61 px: marca WhatsAI, links Site, Documentação e Painel, botão de tema. Sem busca.
2. Herói com grade de 88 px e arte abstrata em mosaico verde da marca. Título grande (`clamp(44px, 5.8vw, 84px)`),
   apoio e linha de atualização com "O que mudou".
3. Três canais de contato em colunas: uso indevido, vulnerabilidades e contato de segurança.
4. "Nossas práticas de segurança": título e apoio à esquerda, três cartões à direita em duas colunas.
5. "Controles implementados": oito cartões com ícone, número e texto; chips das tecnologias.
6. "Sem selos que não temos": quatro cartões de conformidade e tabela que diz, linha a linha, o que o WhatsAI exibe.
   SOC 2 e ISO 27001 aparecem sempre como certificações da infraestrutura (Render, Neon e Vercel), nunca do WhatsAI.
7. "Suboperadores e onde ficam os dados", "Como os dados circulam", "LGPD e os seus direitos", "Se algo der errado",
   "Reportar uma falha", "Perguntas sobre segurança" e "O que mudou", nesta ordem.
8. Rodapé institucional da documentação, com o aviso da condição 1b da licença do Evolution API.

### Termos de uso (`/termos`)

1. Topo de 61 px, igual ao da página de segurança.
2. Herói com grade, sobrescrito "Termos de uso", título grande (`clamp(42px, 4.6vw, 64px)`) e linha de apoio.
   Sem cartões e sem atalhos no herói.
3. Artigo de leitura de até 797 px, começando pela data "Atualizados em 12 de novembro de 2026".
4. Resumo em checklist e dez seções com os ids preservados (`#servico` a `#gerais`).
5. Índice "Nesta página" de 328 px à direita a partir de 1280, com item ativo acompanhando a rolagem.
6. Rodapé institucional.

### Privacidade (`/privacidade`)

1. Topo de 61 px, igual ao das outras duas páginas.
2. Herói com grade, sobrescrito "Política de privacidade", título próprio e linha de apoio.
3. Artigo de leitura de até 797 px, começando por "Atualizada em 12 de novembro de 2026".
4. Resumo e sete seções com os ids preservados (`#papeis` a `#incidentes`), incluindo a declaração de Uso Limitado
   das APIs do Google na seção `#google`.
5. Índice "Nesta página" de 328 px à direita a partir de 1280.
6. Rodapé institucional.

## O que saiu

| Item da versão anterior | Por que saiu | O que entrou |
| --- | --- | --- |
| `.layout` com sidebar de 280 px | Páginas de leitura não precisam de navegação permanente; a referência não tem sidebar | Topo simples de 61 px e conteúdo em coluna |
| Busca no topo e gaveta | Não há acervo de páginas para buscar; a busca da documentação não se aplica | Links Site, Documentação e Painel |
| `.legal-quick` (três atalhos no herói) | O herói de termos e privacidade deve ser só título e apoio | Herói limpo; resumo do documento fica dentro do artigo |
| Números `01` a `10` nos títulos | A referência usa títulos simples; a numeração não ajuda a leitura | Títulos de seção limpos, com âncora discreta |
| `.side-pages` e links legais na lateral | Eram exclusivos da sidebar | Os mesmos links continuam no rodapé |
| `data-search-parent` no `<body>` | Só existia para a busca da documentação | `<body>` sem atributo |
| TOC de 352 px e sidebar de 280 px no mobile | Estrutura de documentação, não de documento legal | Índice só a partir de 1280; artigo em largura total abaixo disso |

## O que veio da documentação

| Componente | Origem | Uso nas páginas legais |
| --- | --- | --- |
| Tokens de cor, tipografia e espaçamento | `docs.css` (`--d-*`) | Fundo, texto, bordas, verde da marca, âmbar e vermelho |
| Tema Sistema, Claro e Escuro | `docs.js`, `initTheme()` | Padrão Sistema; `theme-color` acompanha o tema efetivo |
| Índice com item ativo | `docs.js`, `initScrollSpy()` | Índice de termos e privacidade a partir de 1280 |
| Copiar link | `docs.js`, `initCopy()` | Botão "Copiar link" no índice, com anúncio em `aria-live` |
| Botões, avisos, tabelas, listas, passos e perguntas | `.btn`, `.callout`, `.table-wrap`, `.checklist`, `.steps`, `.faq`, `.chips` | Conteúdo jurídico e de segurança |
| Rodapé e aviso da licença | `.doc-footer`, `.foot-license` | Rodapé das três páginas |

O topo, o herói, o artigo, o índice e os cartões de segurança são CSS próprio em `legal.css`. Nenhuma regra de
sidebar, gaveta ou busca é usada.

## Medidas

| Medida | Termos e privacidade | Segurança |
| --- | --- | --- |
| Topo | 61 px sticky, padding lateral de 32 px | 61 px sticky, padding lateral de 32 px |
| Padding esquerdo do conteúdo | 16 px; 6vw a partir de 720; 14vw a partir de 1024 | Centralizado, largura máxima de 1085 px, padding de 16 a 32 px |
| Herói | Grade de 88 px mascarada; padding de 76/64 px | Grade de 88 px; padding de 72/80 px; arte em mosaico de 3x3 |
| Título | `clamp(42px, 4.6vw, 64px)`, peso 300, linha 1.04 | `clamp(44px, 5.8vw, 84px)`, peso 300, linha 1.02 |
| Artigo | Até 797 px; 797 px em 1440; 358 px em 390 | Não se aplica |
| Índice | 328 px, `gap` de 64 px, sticky a 40 px do topo; só a partir de 1280 | Não se aplica |
| Títulos de seção | `clamp(28px, 2.6vw, 34px)`, peso 300 | `clamp(30px, 3.2vw, 44px)`, peso 300 |
| Corpo | 18 px / 1.55; resumo 16 px | 18 px / 1.55; cartões 15 px |
| Cartões | Resumo, escopo, duplo e controles com gap de 16 px | Contatos em 3 colunas, práticas em 2 colunas, conformidade em 4 colunas |
| Breakpoints | 1279 (índice some), 1023, 899, 719, 559, 389 | 1023, 899, 719, 559, 389 |

Em 1440 px, o artigo começa em x=202 e o índice em x=1063; o título de segurança começa em x=186. Em 1024 px, o
artigo começa em x=143 e o índice está oculto. Em 390 px, o conteúdo começa em x=16 e não há rolagem horizontal.

## Referência Render x WhatsAI

### Segurança (`/seguranca`)

| Aspecto | Referência Render | WhatsAI |
| --- | --- | --- |
| Topo | Site, 61 px, sem sidebar | Site, 61 px, com Site, Documentação, Painel e tema |
| Herói | Título de 84 px, grade e blocos abstratos roxos | Título de até 84 px, grade e mosaico verde da marca |
| Contato | Abuse, Vulnerability Disclosure e Security Point of Contact | Uso indevido, Vulnerabilidades e Contato de segurança |
| Práticas | Título à esquerda e cartões à direita | Mesma divisão, com três práticas e cartões em duas colunas |
| Conformidade | Selos e certificações do próprio Render | Quatro cartões que separam infraestrutura de WhatsAI; nenhum selo próprio |
| Certificações | ISO 27001, SOC 2, GDPR, HIPAA e DPF exibidos | SOC 2 e ISO 27001 atribuídos a Render, Neon e Vercel; WhatsAI declara que não os possui |
| Suboperadores | Tabela de entidade, finalidade e país | Tabela com serviço, finalidade, dado recebido e país |
| Controles | Cartões de práticas | Oito controles implementados, com ícone e número |
| Índice | Não tem | Não tem |
| Rodapé | Institucional | Rodapé da documentação, com aviso da licença 1b |

### Termos de uso (`/termos`)

| Aspecto | Referência Render | WhatsAI |
| --- | --- | --- |
| Topo | Site, 61 px, sem busca | Site, 61 px, sem busca |
| Herói | Grade e título de 64,8 px, sem cartões | Grade, título de até 64 px e linha de apoio, sem cartões |
| Artigo | 797 px, começando por "Last Modified" | 797 px, começando por "Atualizados em 12 de novembro de 2026" |
| Títulos | H2 simples, cerca de 32 px | H2 simples, `clamp(28-34px)`, com âncora discreta |
| Índice | À direita, a partir de 1280 | "Nesta página" de 328 px à direita, a partir de 1280 |
| Seções | Conteúdo próprio do Render | Dez seções com os ids `#servico` a `#gerais` preservados |
| Resumo | Não tem bloco de resumo | Resumo em checklist, preservado do texto anterior |
| Links | Termos e privacidade do Render | Planos, Privacidade, Segurança e contato do WhatsAI |
| Rodapé | Institucional | Rodapé da documentação, com aviso da licença 1b |

### Privacidade (`/privacidade`)

| Aspecto | Referência Render | WhatsAI |
| --- | --- | --- |
| Topo | Site, 61 px, sem busca | Site, 61 px, sem busca |
| Herói | Grade e título de 64,8 px, sem cartões | Grade, título próprio de até 64 px e linha de apoio |
| Artigo | 797 px, começando por "Last Modified" | 797 px, começando por "Atualizada em 12 de novembro de 2026" |
| Índice | À direita, a partir de 1280 | "Nesta página" de 328 px à direita, a partir de 1280 |
| Dados tratados | Blocos de texto | Tabela de dado e finalidade, preservada |
| Compartilhamento | Lista de fornecedores | Lista e aviso âmbar de transferência internacional |
| Google Agenda | Seção com declaração de Uso Limitado | Mesma seção, com aviso e link para a política do Google |
| Retenção e direitos | Blocos de prazo e direitos | Lista de prazos e checklist de direitos |
| Incidentes | Seção de incidentes | Seção com link para o fluxo de segurança |
| Rodapé | Institucional | Rodapé da documentação, com aviso da licença 1b |

## O que é nosso e o que ficou de fora

- Não foram copiados logo, marca, textos, fontes proprietárias, ilustrações, imagens, arquivos CSS, classes ou
  trechos de código do Render. A referência serviu para medidas, hierarquia, densidade e comportamento.
- A paleta é a da marca WhatsAI: verde escuro `#0e7a4d` no claro e verde claro `#5fcf8a` no escuro. Âmbar é usado
  só para atenção, vermelho para erro e o neutro para código. Não há roxo.
- Nenhuma certificação, selo, prazo ou promessa foi inventado. A página de Segurança diz, em texto, cartões e tabela,
  que o WhatsAI não exibe SOC 2, ISO 27001 ou qualquer selo que não possua; as certificações citadas são dos
  provedores de infraestrutura.
- Nenhuma página menciona GitHub. O rodapé traz Site, Painel, Documentação, Novidades, Segurança, Termos,
  Privacidade, Área do cliente, Contato, Planos e `security.txt`.
- Nenhum dado real de cliente aparece nas páginas ou nas capturas; os exemplos são fictícios ou inexistentes.
- O aviso da condição 1b da licença do Evolution API está no rodapé das três páginas, como no restante do site.
- O texto jurídico e factual foi preservado: medidas técnicas, provedores e países, LGPD, prazos, direitos,
  incidentes, limites da IA, proibições, planos sem fidelidade, cancelamento com 30 dias, franquia da IA,
  responsabilidade limitada a 3 meses, foro e desenvolvedor independente. A data de atualização (12/11/2026) e o
  histórico da página de Segurança foram mantidos.
- As páginas não usam JSON-LD nem script ou estilo inline. A CSP e os hashes existentes em `vercel.json` continuam
  válidos; as rotas de `vercel.json` não mudaram.
- O `.gitignore` local não foi commitado e nenhum dado de produção, credencial ou conexão do WhatsApp foi tocado.

## Acessibilidade e comportamento

- Atalho "Pular para o conteúdo", foco visível e `main` com `tabindex="-1"`.
- Tema persistido em `localStorage`, padrão Sistema; o menu aceita setas, Home, End e Escape.
- Índice com `aria-current` acompanhando a rolagem; links de seção com âncora e `aria-label`.
- Botão de copiar link com confirmação visual e anúncio em `aria-live`.
- Tabelas dentro de `.table-wrap` com `tabindex="0"` e rolagem apenas dentro do bloco.
- `prefers-reduced-motion` desliga transições e `@media print` limpa o topo, o índice, a arte e os blocos de contato.
- Nenhuma rolagem horizontal da página em 360, 390, 768, 1024, 1280 ou 1440; o índice aparece em 1280 e some em 1024;
  a sidebar e a busca não existem em nenhuma largura.

## Validação executada

- `node --check manager/dist/docs/docs.js`.
- Parse de `manager/dist/landing/legal.css` com esbuild.
- `python3 -I manager/patches/*.py --check` em todos os patches do painel.
- `node manager/patches/landing-css.mjs --check` (o bundle do site não inclui as páginas legais).
- `xmllint --html --noout` nas três páginas, sem erro de aninhamento.
- Playwright: 18 capturas de viewport e de página inteira (3 páginas x 3 larguras x 2 temas), mais 360, 768, 1280 e
  os recortes de componentes; tema, cópia de link, âncoras, índice e console sem erros.
- `test/unit/security.test.ts` continua válido: nenhuma página legal adiciona script ou estilo inline, então os hashes
  da CSP não mudam.

## Arquivos alterados

- `manager/dist/landing/seguranca.html`
- `manager/dist/landing/termos.html`
- `manager/dist/landing/privacidade.html`
- `manager/dist/landing/legal.css`
- `readmes/pr/seguranca-termos-privacidade/DESIGN.md`
- `readmes/pr/seguranca-termos-privacidade/redesign-render/` (antes, referência, depois e recortes)

## Recomendações

1. Revisão jurídica do texto final, em especial prazos de retenção, responsabilidade e dados do Google, antes de
   considerar a redação definitiva.
2. Rodar o Lighthouse em `/seguranca`, `/termos` e `/privacidade` depois do deploy, no celular e no computador, para
   confirmar a meta de 100 nas quatro notas e a Navegação agêntica 4/4.
3. Conferir o deploy `live` no Render e o estado da instância em produção depois do merge, tarefa de quem tem os MCPs.
4. Manter a lista de suboperadores de `#onde` e a política de privacidade sincronizadas quando um provedor mudar.
5. Se o projeto precisar de navegadores muito antigos, trocar os `color-mix()` do mosaico e dos cartões por cores
   sólidas equivalentes.
6. Avaliar, em outro PR, descrições mais curtas para `/seguranca`, `/termos` e `/privacidade` em `llms.txt` e
   `sitemap.xml`; as rotas já estão listadas e continuam válidas.
