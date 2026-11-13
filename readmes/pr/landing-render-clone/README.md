# Proposta: landing no padrao da home do Render

Este PR e uma **proposta visual**, mantida em draft e **sem merge**. A landing atual do main foi restaurada para o desenho anterior; este branch guarda a versao inspirada na home do Render para comparacao e decidacao futura.

## Comparacao

As capturas ficam em `readmes/pr/landing-render-style/`:

- `referencia-render/`: home do Render em 1440, 1024 e 390 (full page e viewport).
- `antes/`: nossa landing anterior.
- `depois/`: esta proposta, com full page, viewport e recortes de cabecalho, hero, passos, recursos, integracoes, segmentos, planos, FAQ, CTA e rodape.
- `DESIGN.md`: tokens, medidas, decisoes e o que foi adaptado.

## Problemas identificados na proposta

1. **Cores**: o verde da marca foi aplicado em varios tons (hero, botoes, badges, ilustracao, fundos), enquanto a referencia usa uma base neutra com um unico accent. Isso cria uma paleta menos coesa que a do Render.
2. **Layout**: o hero centralizado e as grades uniformes de cards se afastam da composicao do Render, que alterna faixas full-width, blocos assimetricos e secoes de produto com mais respiro.
3. **Componentes e bordas**: a proposta mistura botoes-pill, cards arredondados, sombras suaves e paineis de chat; a referencia usa bordas finas, raios pequenos e superficies mais retas. O resultado parece um template SaaS, nao uma home de plataforma.
4. **UI/UX**: o mockup de conversa e bom para explicar o WhatsAI, mas ocupa o papel do painel de produto do Render. Faltam equivalentes visuais para as secoes de recursos e de confianca, e a hierarquia de CTAs nao segue a mesma cadencia.
5. **CSS**: existem dois sistemas convivendo (`site-header.css` e `landing.css`) com tokens e breakpoints proprios. Eles ja divergiram uma vez e precisam de uma fonte unica de tokens.
6. **Consistencia entre paginas**: o cabecalho agora e unico nas quatro paginas, mas a landing ainda carrega um bundle proprio que pode divergir do restante do site.

## Recomendacoes para uma clonagem fiel

1. Definir o alvo: "inspirado no Render" ou "clone fiel". Para clone fiel, extrair uma tabela unica de tokens (cores, escala tipografica, espacamentos, raios, bordas, sombras e movimento) e implementar um unico sistema.
2. Manter um unico accent — o verde escuro da marca — em vez de varios tons de verde; neutros para superficies e texto.
3. Mapear a anatomia da home do Render uma a uma (anuncio, hero, prova, tres passos, faixa de stack, recursos, depoimento, integracoes, seguranca, CTA e rodape) e encaixar o conteudo do WhatsAI sem inventar componentes novos.
4. Normalizar botoes, cards, tabelas e callouts: mesmos raios, bordas de 1 px, sombras limitadas e a mesma largura de conteudo.
5. Unificar os tokens do cabecalho e da landing; evitar dois bundles e dois sistemas de breakpoints.
6. Comparar por componente (cabecalho, hero, passos, cards, planos, seguranca, CTA e rodape), nao apenas a pagina inteira.
7. Preservar o que ja esta bom: Lighthouse 100 nas quatro categorias, acessibilidade, conteudo comercial, aviso da licenca e as paginas legais sem sidebar.

## Estado

- Branch: `feat/landing-render-clone`.
- Draft, sem merge.
- A landing do main continua na versao anterior.
