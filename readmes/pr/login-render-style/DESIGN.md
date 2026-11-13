# Entrada do cliente no padrão do login do Render

Documento de apoio do PR `feat/login-render-style`. Explica a anatomia adotada em `/acesso`, os tokens, as medidas,
o que veio da referência (o login do Render), o que foi adaptado ao WhatsAI e o que ficou de fora. Serve para revisar
o desenho e o fluxo sem abrir o CSS linha a linha.

## Contexto

`/acesso` é a entrada do cliente: a pessoa recebe um código `wac_` de quem configurou o atendimento e entra com ele.
O painel do desenvolvedor continua separado, em `/manager/login`.

Antes a página era um cartão cinza de 400 px com borda, título de 22 px à esquerda, campos de 44 px, botão escuro e
marca solta no topo. A referência passou a ser o login do Render (`dashboard.render.com/login-next`), capturado em
1440x900, 1024x768 e 390x844. A estrutura é de login de produto: coluna curta centralizada, marca, título, campos
com 1 px de borda, botão principal, ajuda e rodapé discreto.

Nada do Render foi copiado: nem marca, nem textos, nem fontes, nem CSS, nem ilustrações. As capturas da referência
ficam em `referencia-render/` só para comparação lado a lado. Também não há GitHub, Google, SSO, hCaptcha, cadastro,
selos ou marcas de terceiros, porque nada disso está implementado no WhatsAI.

## Arquivos alterados

| Arquivo | O que muda |
| --- | --- |
| `manager/dist/acesso/index.html` | Markup da coluna central; `<style>` inline removido; script inline preservado byte a byte |
| `manager/dist/assets/acesso.css` | Novo: tokens, grade decorativa, campos, botão, links, rodapé, responsivo e tema escuro |
| `manager/dist/acesso/acesso.webmanifest` | `background_color` e `theme_color` passam de `#f5f5f5` para `#faf9f4` |
| `readmes/pr/login-render-style/` | Capturas da referência, antes/depois e este documento |

O script inline foi mantido exatamente igual (mesmo SHA-256), então a CSP e o
`test/unit/security.test.ts` continuam válidos sem alteração. O CSS saiu para um arquivo externo servido por
`'self'`; nenhum estilo ou script inline novo foi criado.

## Referência Render x WhatsAI

Medidas da referência em 1440x900, conferidas no DOM com o Playwright. As medidas do WhatsAI são as do estado final
em 1440x900 (tema claro).

| Elemento | Render (login-next) | WhatsAI (`/acesso`) | Decisão |
| --- | --- | --- | --- |
| Coluna central | 364 px, sem borda, topo em y=157 | 364 px, sem borda, centralizada | Fiel na largura e na ausência de cartão com moldura |
| Marca | Símbolo gráfico do Render acima do título | Wordmark WhatsAI 21 px/650 com ponto verde | Adaptado: marca própria, sem o símbolo do Render |
| Título | 28 px, peso 500, centralizado | 28 px, peso 500, Geist, centralizado | Fiel na escala e no alinhamento |
| Texto de apoio | Não existe | 14 px, cor secundária, centralizado | Adaptado: mantém a explicação do código `wac_` |
| Rótulo do campo | 14 px, peso 500, margem inferior 8 px | 14 px, peso 500, margem inferior 8 px | Fiel |
| Campo | 364x40 px, borda 1 px `#c7c7c7`, raio 0 | 364x40 px, borda 1 px `#c9c7c0`, raio 4 px | Adaptado só no raio pequeno |
| Botão principal | 364x48 px, `#0d0d0d`, texto 16 px, raio 0 | 364x48 px, `#0d0d0d` no claro e `#0e7a4d` no escuro, raio 4 px | Adaptado: verde da marca no escuro |
| Link de ajuda | "Forgot password?" 13 px, `#6b6b6b` | "Não tem o código?" 13 px, cor secundária, centralizado | Adaptado ao fluxo do código |
| Link de destaque | "Don't have an account?" 14 px, roxo | "Sou o desenvolvedor" 14 px, verde | Adaptado: leva ao painel, não a cadastro |
| Métodos alternativos | GitHub, Google e SSO | Não existem | Omitidos de propósito: não estão implementados |
| Rodapé | Links legais 13 px, `#8f8f8f` | Privacidade, Termos e administrador, 13 px | Adaptado: mesmos links de antes, mais discretos |
| Fundo | Branco `#fff` com grade fina de 40 px nos cantos | Creme `#faf9f4` com grade fina de 40 px nos cantos, esmaecida | Adaptado ao papel creme da marca |
| Tema escuro | Não tem | Suportado por `prefers-color-scheme` | Adaptado: o sistema continua valendo |
| Instalar app | Não tem | Botão mantido, oculto até `beforeinstallprompt` | Preservado do fluxo atual |
| Código de acesso | E-mail e senha | Um campo `password` com o código `wac_` | Adaptado ao produto |

## Antes x Depois

| Medida | Antes | Depois |
| --- | --- | --- |
| Fundo | `#f5f5f5` | `#faf9f4` (creme) |
| Cartão | 400 px, borda 1 px, raio 10 px | 364 px, sem borda |
| Título | 22 px/500 à esquerda | 28 px/500 centralizado (26 px no celular) |
| Campo | 44 px de altura, raio 6 px, borda `#cccccc` | 40 px, raio 4 px, borda `#c9c7c0` |
| Botão principal | 44 px, `#1a1a1a`, raio 6 px | 48 px, `#0d0d0d` no claro e `#0e7a4d` no escuro, raio 4 px |
| Marca | Texto solto no topo esquerdo | Wordmark dentro da coluna, centralizado |
| Fundo decorativo | Nenhum | Grade fina de 40 px nos dois cantos, esmaecida |
| Link do desenvolvedor | Só "Entrar como administrador" no rodapé | "Sou o desenvolvedor" no cartão e administrador no rodapé |
| Nota de instalação | Abaixo do cartão, fora dele | Dentro da coluna, em texto discreto |
| Tema escuro | Botão creme sobre fundo quase preto | Botão verde da marca, textos e bordas próprios |
| Rolagem horizontal | 0 | 0 em 320, 360, 390, 414, 768, 1024, 1280 e 1440 px |

## Tokens

| Token | Claro | Escuro | Uso |
| --- | --- | --- | --- |
| `--page` | `#faf9f4` | `#10100e` | Fundo da página |
| `--text` | `#141414` | `#f4f4ec` | Texto principal |
| `--text-2` | `#6b6b6b` | `#a6a69c` | Texto secundário, ajuda e rodapé |
| `--field` | `#ffffff` | `#171714` | Fundo do campo |
| `--field-border` | `#c9c7c0` | `#3d3d35` | Borda de 1 px do campo |
| `--field-border-strong` | `#9b998f` | `#5a5a50` | Borda no hover |
| `--hover` | `#f1efe8` | `#1c1c18` | Fundo do botão secundário no hover |
| `--grid` | `#e9e5da` | `#242420` | Linhas da grade decorativa |
| `--primary` | `#0d0d0d` | `#0e7a4d` | Botão principal |
| `--on-primary` | `#ffffff` | `#ffffff` | Texto do botão principal |
| `--primary-hover` | `#2a2a2a` | `#12945c` | Botão principal no hover |
| `--accent` | `#0e7a4d` | `#6fd695` | Ponto da marca e link do desenvolvedor |
| `--error` | `#b42318` | `#f87171` | Mensagem de erro |
| `--focus` | `#0e7a4d` | `#6fd695` | Anel de foco |

Contrastes calculados (WCAG 2.1):

| Par | Contraste | Situação |
| --- | --- | --- |
| Texto principal no fundo claro | 17,48:1 | AAA |
| Texto secundário no fundo claro | 5,06:1 | AA |
| Verde do link no fundo claro | 5,10:1 | AA |
| Branco no botão preto | 19,44:1 | AAA |
| Branco no botão verde | 5,37:1 | AA |
| Texto no fundo escuro | 17,23:1 | AAA |
| Texto secundário no fundo escuro | 7,76:1 | AAA |
| Verde do link no fundo escuro | 10,64:1 | AAA |

A borda de 1 px do campo tem contraste baixo de propósito, como na referência (1,69:1 no claro e 1,64:1 no escuro).
O estado de foco não depende dela: o anel verde de 2 px tem contraste alto e é o indicador principal de teclado.

## Medidas e ritmo vertical

- Coluna de 364 px; `16 px` de margem lateral no celular; a coluna ocupa 358 px a 390 px de viewport.
- Marca: 21 px/650, ponto verde de 7 px, 20 px abaixo dela vem o título.
- Título: 28 px/1.25 no desktop e 26 px no celular.
- Texto de apoio: 14 px/1.5, 26 px até o formulário.
- Rótulo: 14 px/500, 8 px até o campo.
- Campo: 40 px de altura, raio 4 px, padding lateral de 12 px.
- Botão principal: 48 px de altura, 16 px de distância do campo, raio 4 px.
- Ajuda: 13 px, 16 px abaixo do botão.
- Nota de instalação: 12,5 px, 20 px abaixo da ajuda.
- Link do desenvolvedor: 14 px, 24 px abaixo da nota.
- Rodapé: 13 px, preso ao fim da tela, com `env(safe-area-inset-bottom)`.
- Desktop: coluna centralizada na vertical. Celular: topo em 40 px, porque a referência também encosta no topo.
- Grade: células de 40 px, linhas de 1 px, dois quadrantes com máscara radial; escondida abaixo de 760 px.

## O que ficou fiel

- Largura da coluna de 364 px e ausência de cartão com moldura.
- Campo de 40 px, rótulo de 14 px e botão de 48 px com a mesma hierarquia da referência.
- Título de 28 px/500 centralizado, com marca acima e formulário abaixo.
- Fundo claro com grade fina nos cantos, sem nenhuma marca da referência.
- Rodapé de links legais discreto e uma única ação principal.
- Layout sem sidebar, centralizado e responsivo, com margem de 16 px no celular.
- Tema claro e escuro coerentes; o tema do sistema continua mandando.

## O que foi adaptado

- A marca é o wordmark WhatsAI com o ponto verde, não o símbolo do Render.
- O fundo é creme e o verde da marca aparece no ponto, no foco, no link e no botão do tema escuro.
- O campo único recebe o código `wac_`; o texto de apoio explica o que fazer.
- "Sou o desenvolvedor" substitui o link de cadastro e leva a `/manager/login`.
- O botão de instalar o app, o manifest e a nota de instalação continuam no fluxo.
- O rodapé mantém Privacidade, Termos e "Entrar como administrador".
- O raio pequeno de 4 px foi adotado nos campos e botões (a referência usa canto reto).

## O que não entrou

- Logo, marca, textos, fontes, cores ou qualquer asset do Render.
- GitHub, Google, SSO, hCaptcha, cadastro e "More options": não estão implementados.
- Chave global, senha do desenvolvedor ou qualquer validação de administrador nesta página pública.
- Selos ou certificações que o WhatsAI não tem.
- Dados reais de clientes nas capturas: todos os exemplos são fictícios e o campo aparece vazio ou com `abc`.
- Alteração de endpoints, da validação `wac_`, do rate limit, do armazenamento de sessão ou do painel.

## Segurança e privacidade

- O script inline é byte a byte o mesmo de antes: SHA-256
  `QKF0/aQ62VwBc3Ejx4ThT2d9XYfPxvcNcl23m2joxSE=`, um dos três hashes já permitidos em `manager/dist/vercel.json`.
- Nenhum script ou estilo inline novo. O CSS é externo (`/assets/acesso.css?v=1`) e a CSP já permite `'self'`.
- Verificação equivalente ao teste de CSP: 10 arquivos HTML, 3 scripts inline, 3 hashes permitidos, nenhum handler
  inline. O `test/unit/security.test.ts` completo não rodou localmente porque falta `@prisma/adapter-mariadb` no
  `node_modules` local; o GitHub Actions roda a suíte no PR.
- A página sob a CSP real de `vercel.json` carregou sem erro de console e sem bloqueio.
- O link "Sou o desenvolvedor" é só um link para `/manager/login`; a autenticação do painel continua lá, separada.
- Nenhuma chave global, token ou mensagem interna aparece no HTML, no CSS ou nas capturas.
- O manifest continua apontando para os mesmos ícones e o escopo continua `/`.

## Acessibilidade

- Um `<main>`, uma `<section aria-labelledby>` e um `h1`; rodapé em `<footer>` (contentinfo).
- Rótulo explícito `for="code"`, campo `type="password"`, `aria-describedby="err"` e erro `role="alert"`.
- Ordem de tabulação: marca, campo, Entrar, Sou o desenvolvedor, Privacidade, Termos, administrador. O botão de
  instalar fica oculto e fora da ordem até existir o prompt.
- Foco visível de 2 px em todos os elementos interativos, com `outline-offset` de 2 px (1 px no campo).
- `prefers-reduced-motion` remove as transições de cor.
- Snapshot de acessibilidade do Playwright: main, region "Área do cliente", heading nível 1, textbox "Código de
  acesso", button "Entrar" e contentinfo com os três links.

## Validação feita

- Referência do Render em 1440x900, 1024x768 e 390x844 (só no claro, como o produto), e o nosso antes/depois nas
  mesmas medidas, no claro e no escuro, com viewport, página inteira e recortes de cartão, campo, botão, links,
  rodapé, foco e erro.
- Sem rolagem horizontal em 320, 360, 390, 414, 768, 1024, 1280 e 1440 px, nos dois temas.
- Fluxo real testado com a API simulada no navegador: código vazio e inválido mostram o mesmo erro e devolvem o foco
  ao campo; código válido grava `token`, `instanceId` e `wa-portal` e vai para `/manager/instance/inst1/chat`;
  sessão já salva redireciona; `?saiu=1` troca o texto de apoio; o link de administrador limpa `wa-portal` e abre
  `/manager/login`.
- `node --check` do script inline, conferência de chaves do CSS, parse dos JSON e
  `npx esbuild manager/dist/assets/index-b29a5d7a.js --format=esm`.
- `python3 -I manager/patches/*.py --check`: todos os patches continuam aplicados (o `perf-boot.py` é o único que
  toca a página e só ajusta `?v=` de Geist; os links e o preload foram mantidos).

## Capturas

Referência do Render (`referencia-render/`):

- `render-login-1440-viewport.png`, `render-login-1440-full.png`, `render-login-1440-cartao.png`,
  `render-login-1440-canto.png`, `render-login-1440-campo.png`, `render-login-1440-botao.png`,
  `render-login-1440-links.png`, `render-login-1440-rodape.png`
- `render-login-1024-viewport.png`, `render-login-1024-full.png`
- `render-login-390-viewport.png`, `render-login-390-full.png`

Antes (`antes/`): 1440 e 390 em claro e escuro, 1024 no claro; em cada tamanho capturado, viewport, página inteira
e recortes de cartão, campo, botão, links e rodapé.

Depois (`depois/`): 1440 e 390 em claro e escuro, 1024 no claro (todos os recortes) e no escuro (viewport, página
inteira e cartão); mais `depois-acesso-1440-light-foco-campo.png` e `depois-acesso-1440-light-erro.png`.

## Recomendações

1. Manter a entrada do cliente e o login do painel separados. O código `wac_` é para quem atende; a chave global e a
   senha do desenvolvedor não devem passar por esta página pública.
2. Se o suporte pedir uma ajuda mais explícita para obter o código, criar uma rota curta de ajuda e apontar o link
   "Não tem o código?" para ela. Hoje o texto orienta a falar com quem configurou o atendimento.
3. Se um dia houver OAuth ou SSO de verdade, os botões secundários cabem abaixo do principal, como na referência.
   Até lá, não criar botão que não funciona.
4. O manifest do app é claro (`#faf9f4`); se o PWA precisar de splash escuro, será necessário um segundo manifest ou
   uma imagem de abertura própria, o que está fora deste PR.
5. Qualquer mudança futura no script inline exige atualizar o hash em `manager/dist/vercel.json` e o
   `test/unit/security.test.ts`; enquanto ele ficar inline, o hash é o contrato.
