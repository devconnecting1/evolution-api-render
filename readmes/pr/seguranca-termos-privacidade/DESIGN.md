# Segurança, Termos de Uso e Privacidade no padrão da documentação

Redesenho das três páginas públicas legais do WhatsAI (`/seguranca`, `/termos` e `/privacidade`) para o mesmo
esqueleto visual, de navegação e de leitura da documentação pública (`/docs`), inspirado nas páginas equivalentes do
Render. O conteúdo jurídico e factual de cada página foi preservado; a marca, os textos, a paleta, os ícones, as
classes e o código são do WhatsAI.

## Método

1. Páginas de referência estudadas em 1440x900, 1024x768 e 390x844, no claro e no escuro:
   - `https://render.com/security`
   - `https://render.com/terms`
   - `https://render.com/privacy`
2. Capturas de referência em `referencia/render-<pagina>-<largura>-<tema>.png`; medidas de header, título, artigo,
   índice e espaçamentos foram extraídas com o Playwright durante o estudo e usadas só como parâmetro, sem copiar
   marca, textos, fontes, ilustrações, assets ou CSS.
3. O esqueleto, os tokens e os componentes vieram de `manager/dist/docs/docs.css` e `manager/dist/docs/docs.js`.
   Só o que é específico das páginas legais ficou em `manager/dist/landing/legal.css`.
4. O HTML foi reescrito à mão, sem framework, sem script inline e sem estilo inline, para manter a CSP de
   `manager/dist/vercel.json` e o teste `test/unit/security.test.ts` válidos.
5. Cada página foi conferida com o Playwright em 1440x900, 1024x768 e 390x844, claro e escuro, além de gaveta em
   390 e 768, busca, tema, teclado e cópia de link. Capturas finais em `depois-<pagina>-<largura>-<tema>.png`.

## O que veio da documentação

| Componente | Origem | Uso nas páginas legais |
| --- | --- | --- |
| Topo fixo de 60 px (116 px abaixo de 1024) | `.topbar`, `.topbar-in`, `.brand`, `.brand-doc` | Marca WhatsAI, nome da página, busca, Site, Documentação, Painel, tema e gaveta |
| Busca local com resultados e teclado | `.search*`, `initSearch()` | Busca "nesta página", com o nome da página como pai do resultado |
| Navegação lateral de 280 px | `.sidebar`, `.side-group`, `.side-label`, `.side-nav` | Grupo "Nesta página" e bloco "Páginas legais" |
| Gaveta abaixo de 1024 | `.drawer-*`, `initDrawer()` | Largura total, foco preso, Escape e retorno de foco |
| Índice lateral de 352 px | `.toc`, `initScrollSpy()` | Só a partir de 1280; item ativo acompanha a rolagem |
| Artigo de 792 px | `.content`, `.doc-section` | Leitura confortável, com padding de 60 px nas laterais |
| Tema Sistema, Claro e Escuro | `wa-theme`, `initTheme()` | Padrão Sistema; `theme-color` acompanha o tema efetivo |
| Componentes de leitura | `.checklist`, `.callout`, `.steps`, `.table-wrap`, `.faq`, `.chips`, `.btn` | Listas, avisos, fluxo, tabelas, perguntas e ações |
| Rodapé | `.doc-footer`, `.foot-license` | Links internos e aviso da condição 1b da licença do Evolution API |

## Tokens e medidas reaproveitados

| Token | Claro | Escuro | Uso |
| --- | --- | --- | --- |
| `--d-bg` | `#ffffff` | `#0d0d0d` | Fundo do artigo, do topo e da lateral |
| `--d-bg-soft` | `#fafafa` | `#141414` | Resumo, blocos de escopo e hover |
| `--d-border` | `#e3e3e3` | `#272727` | Fios, bordas e grade do herói |
| `--d-text` | `#0d0d0d` | `#ffffff` | Texto principal |
| `--d-accent` | `#0e7a4d` | `#5fcf8a` | Verde da marca: links, ícones e item ativo |
| `--d-accent-soft` | verde suave | verde suave | Fundo de ícones, números e blocos de contato |
| `--d-warn-*` | âmbar | âmbar | Avisos de atenção (selos, transferência internacional, QR code) |
| `--d-bad-*` | vermelho | vermelho | Erro, quando necessário |
| `--d-ok` | `#0e7a4d` | `#5fcf8a` | Confirmações e "sim" nas tabelas |
| `--d-mono` | mono do projeto | mono do projeto | Números de seção, datas, `code` e cabeçalhos de tabela |

Medidas principais:

- Topo de 60 px; 116 px em duas linhas abaixo de 1024. Lateral de 280 px; índice de 352 px a partir de 1280.
- Artigo de 792 px, com padding `30px 60px 100px`; 728 px entre 1024 e 1279.
- Herói: padding de 44 px, grade de 72 px desenhada em CSS e mascarada no rodapé do bloco.
- Título do herói: `clamp(40px, 4.6vw, 56px)`, peso 300, `letter-spacing -0.025em`, linha 1.04.
- Linha de apoio: `clamp(19px, 1.8vw, 22px)`, linha 1.35.
- Título de seção: `clamp(28px, 2.6vw, 34px)`, peso 300, com chip numérico mono de 12 px.
- Corpo: 18 px com linha 1.6; listas 18 px; legendas 13 px; metadados 14 px; sobrescrito mono de 12 px.
- Cartões e blocos com gap de 16 px; faixa de atalhos em 3 colunas, 1 coluna abaixo de 860.
- Breakpoints reaproveitados: 1439, 1279, 1023, 860, 719, 559 e 389.

## Referência Render x WhatsAI

### Segurança (`/seguranca`)

| Aspecto | Referência Render | WhatsAI |
| --- | --- | --- |
| Topo | Fixo, 61 px, marca à esquerda | Topo da documentação, 60 px (116 px no celular) |
| Herói | Título de 84 px, peso 300, grade de fundo | Título `clamp(40-56px)`, peso 300, grade de 72 px |
| Resumo de confiança | Faixa de três colunas abaixo do herói | `.legal-quick` com três atalhos: controles, selos e reportar falha |
| Controles | Cartões em duas colunas | Oito `.legal-card` numerados, ícones de linha e texto objetivo |
| Certificações | A referência tem os próprios selos e políticas | Seção `#selos` diz explicitamente que o WhatsAI não exibe SOC 2, ISO 27001 nem selo próprio; atribui as certificações a Render, Neon e Vercel |
| Fluxo de dados | Diagrama/blocos próprios | Lista `.steps` com seis etapas e chips das tecnologias |
| Suboperadores | Tabela | Tabela com serviço, finalidade, dado recebido e país |
| LGPD | Blocos de política | Checklist com prazos, direitos e aviso sobre o canal por QR code |
| Incidentes | Passos de resposta | Bloco duplo: incidente com dados e cópias de segurança de 6 horas |
| Vulnerabilidades | Canal de contato | Escopo em três caixas e contato pelo site e `security.txt` |
| Perguntas | Acordeão | Seis `<details class="faq">` da documentação |
| Índice | Coluna à direita | TOC de 352 px a partir de 1280; lateral com as nove seções |
| Rodapé | Rodapé institucional | Rodapé da documentação com links internos e aviso da licença 1b |

### Termos de uso (`/termos`)

| Aspecto | Referência Render | WhatsAI |
| --- | --- | --- |
| Herói | Título de 64,8 px, peso 400 | Herói da documentação: `clamp(40-56px)`, peso 300, com resumo e atalhos |
| Largura de leitura | Artigo de 797 px | Artigo de 792 px |
| Corpo | 18 px, linha 26 px | 18 px, linha 1.6 |
| Títulos de seção | 32 px, peso 400, margens 32/16 | `clamp(28-34px)`, peso 300, chip numérico e âncora |
| Resumo | Bloco de destaques no início | `.legal-summary` com cinco itens em checklist |
| Navegação | Índice no topo e à direita | Dez itens na lateral, no TOC e na busca |
| Seções | Numeradas de 1 a 10 | Dez seções com os mesmos ids (`#servico` a `#gerais`) |
| Tabelas | Tabelas de apoio | Nenhuma tabela nesta página; listas e blocos de leitura |
| Links | Links para termos e privacidade | Links para Planos, Privacidade, Segurança e contato |
| Rodapé | Rodapé institucional | Rodapé da documentação com links internos e aviso da licença 1b |

### Privacidade (`/privacidade`)

| Aspecto | Referência Render | WhatsAI |
| --- | --- | --- |
| Herói | Título de 64,8 px, peso 400 | Herói da documentação com três atalhos (papéis, fornecedores e direitos) |
| Largura de leitura | Artigo de 797 px | Artigo de 792 px |
| Títulos | 32 px, peso 400 | `clamp(28-34px)`, peso 300, chip numérico |
| Dados tratados | Blocos de texto | Tabela de duas colunas com dado e finalidade |
| Compartilhamento | Lista de fornecedores | Lista e aviso âmbar de transferência internacional |
| Google Agenda | Seção específica com declaração de Uso Limitado | Mesma seção, com callout de informação e link para a política do Google |
| Retenção | Blocos de prazo | Lista com prazo das mensagens, demais dados e fim do contrato |
| Direitos | Seção de direitos e contato | Checklist de direitos e bloco de contato no canal de privacidade |
| Incidentes | Seção de incidentes | Seção com link para o fluxo da página de Segurança |
| Índice | Coluna à direita | TOC e lateral com as sete seções |
| Rodapé | Rodapé institucional | Rodapé da documentação com links internos e aviso da licença 1b |

## O que é nosso e o que ficou de fora

- Não foram copiados logo, marca, textos, fontes proprietárias, ilustrações, imagens, arquivos CSS, classes ou
  trechos de código do Render. A referência serviu para medidas, hierarquia, densidade e comportamento.
- A paleta é a da marca WhatsAI: verde escuro `#0e7a4d` no claro e verde claro `#5fcf8a` no escuro. Âmbar é usado
  só para atenção, vermelho para erro e o neutro para código. Não há roxo.
- Nenhuma certificação, selo, prazo ou promessa foi inventado. A página de Segurança diz, em texto e em tabela, que
  o WhatsAI não exibe SOC 2, ISO 27001 ou qualquer selo que não possua; as certificações citadas são dos provedores
  de infraestrutura.
- Nenhuma página menciona GitHub. O rodapé traz Site, Painel, Documentação, Novidades, Segurança, Termos,
  Privacidade, Área do cliente, Contato, Planos e `security.txt`.
- Nenhum dado real de cliente aparece nas páginas ou nas capturas; os exemplos são fictícios ou inexistentes.
- O aviso da condição 1b da licença do Evolution API está no rodapé das três páginas, como no restante do site.
- O texto jurídico e factual foi preservado: medidas técnicas, provedores e países, LGPD, prazos, direitos,
  incidentes, limites da IA, proibições, planos sem fidelidade, cancelamento com 30 dias, franquia da IA,
  responsabilidade limitada a 3 meses, foro e desenvolvedor independente. A data de atualização (12/11/2026) e o
  histórico da página de Segurança foram mantidos.
- As páginas não usam JSON-LD nem script ou estilo inline. A CSP e os três hashes existentes em `vercel.json`
  continuam válidos.

## Acessibilidade e comportamento

- Atalho "Pular para o conteúdo", foco visível e `main` com `tabindex="-1"`.
- Gaveta em largura total abaixo de 1024, com foco preso, Escape e devolução do foco ao botão.
- Busca com `role="combobox"`, navegação por setas, Enter, Escape e anúncio da contagem em `aria-live`.
- Índice com `aria-current` acompanhando a rolagem; links de seção com âncora e `aria-label`.
- Tema persistido em `localStorage`, padrão Sistema; o menu aceita setas, Home, End e Escape.
- Botão de copiar link com confirmação visual e anúncio em `aria-live`.
- Tabelas dentro de `.table-wrap` com `tabindex="0"` e rolagem apenas dentro do bloco.
- `prefers-reduced-motion` desliga transições e `@media print` limpa o herói, os atalhos e os blocos de contato.
- Nenhuma rolagem horizontal da página em 1440, 1024 ou 390; a lateral e o TOC aparecem e somem nos breakpoints
  previstos; a gaveta foi testada em 390 e 768.

## Validação executada

- `node --check manager/dist/docs/docs.js`.
- Parse de `manager/dist/landing/legal.css` e `manager/dist/docs/docs.css` com esbuild.
- `python3 -I manager/patches/*.py --check` em todos os patches do painel.
- `node manager/patches/landing-css.mjs --check` (bundle do site em dia; as páginas legais saíram da lista do bundle).
- Validador próprio de HTML: ids únicos, âncoras internas com destino, símbolos SVG existentes, sem script ou estilo
  inline, sem handlers `on*`, um `<main>` por página, canonical, Open Graph e aviso da licença.
- Playwright: 18 capturas de viewport (3 páginas x 3 larguras x 2 temas), gaveta em 390 e 768, busca, tema, cópia de
  link, foco inicial e ausência de erros de console.
- `test/unit/security.test.ts` deve continuar verde: nenhuma página legal adiciona script inline, então os hashes da
  CSP não mudam; o `landing-css.mjs --check` executado pelo teste passa.

## Arquivos alterados

- `manager/dist/landing/seguranca.html`
- `manager/dist/landing/termos.html`
- `manager/dist/landing/privacidade.html`
- `manager/dist/landing/legal.css` (novo)
- `manager/dist/docs/docs.js` (a busca usa `data-search-parent` para mostrar o nome da página)
- `manager/dist/docs/index.html` (`docs.js?v=5`)
- `manager/patches/landing-css.mjs` (as três páginas legais não usam mais o bundle do site)
- `readmes/pr/seguranca-termos-privacidade/` (capturas antes, depois e referência, além deste documento)

## Recomendações

1. Revisão jurídica do texto final, em especial prazos de retenção, responsabilidade e dados do Google, antes de
   considerar a redação definitiva.
2. Rodar o Lighthouse em `/seguranca` depois do deploy, no celular e no computador, para confirmar a meta de 100 nas
   quatro notas e a Navegação agêntica 4/4.
3. Conferir o deploy `live` no Render e o estado da instância em produção depois do merge, tarefa de quem tem os MCPs.
4. Manter a lista de suboperadores de `#onde` e a política de privacidade sincronizadas quando um provedor mudar.
5. Se o projeto precisar de navegadores muito antigos, trocar o `color-mix()` da faixa de atalhos por uma cor sólida.
6. Avaliar, em outro PR, descrições mais curtas para `/seguranca`, `/termos` e `/privacidade` em `llms.txt` e
   `sitemap.xml`; as rotas já estão listadas e continuam válidas.
