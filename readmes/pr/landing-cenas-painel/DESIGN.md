# Decisões: painéis em cenas com fundo e canto

## Objetivo

As seções de produto tinham uma captura real, mas ainda pareciam um retângulo emoldurado no meio do branco. A
referência do [Devin](https://devin.ai/) mostra outro gesto: uma área com fundo, o painel entrando pelo canto e sendo
recortado pela borda, e o texto ao lado. O objetivo foi trazer esse gesto para o WhatsAI sem copiar a paleta, os
assets ou o excesso de camadas.

## O que foi observado no Devin

- Cada card ou etapa tem uma área de mídia com fundo fotográfico desfocado.
- O painel de produto não fica centralizado: ele entra por um canto e é cortado pela borda.
- Às vezes há uma segunda interface flutuando sobre o fundo (um menu, um alerta), criando profundidade.
- O texto fica abaixo do card ou ao lado da etapa.
- Os cantos são arredondados (cerca de 10 px) e a sombra é ampla.
- No celular, a composição continua, mas o painel é recortado com mais força.

## O que foi adaptado

### Fundo

O fundo fotográfico foi trocado por um gradiente neutro, uma grade de pontos e uma marca d'água grande do ícone do
recurso. Motivos:

- o WhatsAI usa cor só com significado; uma foto colorida quebraria a regra;
- não há banco de imagens próprio para essas cenas;
- uma marca d'água do próprio recurso conecta o fundo ao conteúdo e não parece um placeholder.

A grade e o gradiente usam `--wa-bg`, `--wa-card-2` e `--wa-line-strong`, então acompanham o tema claro e o escuro
sem uma segunda folha de estilos.

### Painel

- A captura real continua sendo a mesma WebP, com o mesmo `srcset`, `alt` e `width`/`height`.
- O painel é posicionado no canto oposto ao texto: inferior direito, inferior esquerdo, superior direito e superior
  esquerdo, alternando nas quatro seções.
- Ele entra 24 px pela borda no desktop e 12 px no celular. O recorte é intencional e cria o efeito de "entrar pelo
  canto".
- A moldura tem 1 px e raio de 2 px, seguindo o design system público. A sombra tem duas camadas, uma longa e difusa
  e outra curta, para dar profundidade sem exagero.

### Segunda camada

O Devin usa uma segunda interface flutuante em alguns cards. No WhatsAI, a segunda camada é a marca d'água do ícone do
recurso. A decisão evita duplicar a mesma captura ou inventar uma interface que não existe no produto. O painel real
continua sendo o único conteúdo de interface da cena.

### Texto

O texto continua ao lado, alternando esquerda e direita. O Devin coloca o texto abaixo em cards de grade; a landing do
WhatsAI usa uma narrativa alternada e a mudança manteria o texto e a cena em uma leitura horizontal mais direta.

### Celular

- O painel ocupa 94% da largura e vai para o canto.
- O fundo e a marca d'água continuam visíveis acima.
- A marca d’água continua; não há segunda tela no celular, porque ela não caberia sem apertar o texto.
- A altura da cena cai para 330 px e o texto continua acima.

## Posições por seção

| Seção | Painel | Marca d'água |
| --- | --- | --- |
| Conversas | canto inferior direito | chat, canto superior esquerdo |
| Contatos da IA | canto inferior esquerdo | pausa, canto superior direito |
| Processos | canto superior direito | balança, canto inferior esquerdo |
| Leads | canto superior esquerdo | alvo, canto inferior direito |

A alternância mantém o ritmo da página e evita que as quatro seções pareçam a mesma imagem repetida.

## Alternativas consideradas

1. **Fundo com a própria captura desfocada.** Testado; a captura é majoritariamente branca, então o fundo ficava
   quase invisível e, quando aparecia, lembrava uma tela fantasma. Rejeitado.
2. **Segunda captura recortada como camada.** Testado; como era a mesma tela, parecia um bug de duplicação. Rejeitado.
3. **Fundo fotográfico colorido.** Copiaria a paleta do Devin e quebraria a regra de cor com significado. Rejeitado.
4. **Cantos de 10 px e sombra ampla como no Devin.** O site usa 2 px; o raio maior afastaria a cena do restante da
   landing. Rejeitado.
5. **Manter a moldura centralizada e só acrescentar uma sombra.** Não resolveria o pedido de fundo e canto. Rejeitado.
6. **Mover o painel para o canto sem fundo.** O painel ficaria solto no branco; o fundo é o que cria a cena. Rejeitado.

## Implementação

- `manager/dist/landing/index.html`: cada `figure.wa-alt-art` ganhou um `div.wa-scene` com uma marca d'água em SVG e o
  `div.wa-shot` existente dentro.
- `manager/dist/assets/landing-cursor.css`: bloco "cenas com o painel no canto" no fim do arquivo.
- `manager/dist/assets/landing.bundle.css`: regerado pelo `landing-css.mjs`.
- Nenhuma imagem nova, nenhum script novo e nenhum asset de terceiro.
- A captura principal mantém o `srcset` e o carregamento atual.

## Acessibilidade

- A marca d'água é `aria-hidden`; não entra na árvore de acessibilidade.
- A captura mantém o `alt` descritivo.
- O contraste do texto não muda; a cena não tem texto sobreposto.
- A ordem de títulos e a navegação por âncoras não mudam.
- A cena não usa animação.

## Limitações

- O painel é recortado pela borda; a tela completa continua disponível na captura original.
- O fundo é neutro, não fotográfico.
- A marca d'água é decorativa; não é uma segunda tela.
- O CSS dos mockups antigos continua no bundle compartilhado com `/novidades`.
- O Devin é referência de composição; nenhum asset, logo, texto ou CSS dele entra no produto.
