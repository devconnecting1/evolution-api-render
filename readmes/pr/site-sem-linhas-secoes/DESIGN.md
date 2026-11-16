# Decisões de design: sem linhas divisórias entre seções

## O problema

A landing e as páginas públicas usavam uma linha horizontal de 1 px para marcar a troca de blocos. Em algumas
páginas, a mesma linha aparecia também abaixo do cabeçalho, acima do rodapé e antes do copyright. O efeito era o de
uma página dividida em faixas, mesmo quando o conteúdo já tinha espaço suficiente para se separar.

O pedido foi remover as linhas entre seções, não as bordas que cumprem uma função dentro de um componente. A escolha
foi explícita: manter bordas de cards, tabelas, perguntas frequentes e listas.

## Regra adotada

- Linha de seção: sai. A separação fica pelo espaçamento, pelo fundo ou pelo título.
- Borda de componente: fica. Cards, tabelas, FAQ, listas, navegação lateral, inputs e botões continuam delimitados.
- Textura de fundo: fica. A grade decorativa do herói da Segurança não é uma divisória; é parte da ilustração.
- Divisória interna dos botões conectados: fica. O pedido atual era sobre as linhas entre seções, não sobre o grupo
  de botões.

## O que foi removido

| Página | Seletor | Linha |
| --- | --- | --- |
| Landing | `.wa-proof` | topo e base da faixa de prova social |
| Landing | `.wa-alt + .wa-alt` | entre blocos alternados de produto |
| Landing | `.wa-why` | acima da grade de recursos |
| Landing | `.wa-plan-notes` | acima das notas dos planos |
| Landing | `.wa-addon` | acima dos adicionais |
| Landing | `.wa-cta` | acima do CTA final |
| Landing, legais e Novidades | `.wa-docfoot` | acima do rodapé compartilhado |
| Landing, legais e Novidades | `.wa-head.is-scrolled` | abaixo do cabeçalho fixo ao rolar |
| Documentação | `.topbar` | abaixo do topo fixo |
| Documentação | `.doc-footer` | acima do rodapé |
| Documentação | `.foot-license` | acima do copyright |
| Segurança, Termos e Privacidade | `.legal-hero` | abaixo do herói |
| Segurança | `.trust-contacts` | abaixo dos três contatos |
| Novidades | `.nv-list-section` | acima da lista de mudanças |

As regras foram removidas ou zeradas no CSS de origem; não foi criado um overlay branco por cima. Assim, a linha não
volta em outro tema, em zoom ou em impressão.

## O que foi mantido

- `.wa-feature-grid` e `.wa-feature`: a grade de recursos é uma moldura de cards. A linha de cima e as linhas entre as
  células são a própria grade; a linha de seção que ficava acima do título saiu.
- `.wa-faq details` e `.wa-faq details:last-child`: linhas entre perguntas.
- `.wa-table th`, `.wa-table td`, `.wa-compare`: linhas de tabela.
- `.legal-changes` e `.legal-changes li`: lista de histórico, com as linhas entre entradas.
- `.nv-list .nv-item` e as linhas entre entradas de Novidades.
- `.side-label`, `.side-foot`: navegação lateral da documentação.
- `.trust-contact`, `.wa-channel`, `.wa-plan`, `.wa-card`, `.wa-research`, `.wa-frontier-card`: bordas de cards.
- A grade decorativa do herói da Segurança.

A distinção é intencional: uma linha que separa dois blocos de leitura pode sair; uma linha que contém um item, uma
tabela ou uma pergunta ajuda a ler o conteúdo.

## Cabeçalho e rodapé

### Cabeçalho

O `.wa-head` já tinha uma borda inferior transparente. Ao rolar, a classe `.is-scrolled` trocava a cor para
`--c-border` e criava a linha. A regra foi removida: o cabeçalho continua fixo e opaco, mas sem a linha.

Na documentação, o `.topbar` tinha a mesma função. A borda inferior foi removida; o fundo opaco do topo fixo continua
separando o cabeçalho do conteúdo sem precisar de uma linha.

### Rodapé

O `.wa-docfoot` perdeu a borda superior. O rodapé continua com o wordmark grande, o status, os links e o copyright;
o espaço em branco antes dele já faz a separação. Na documentação, o `.doc-footer` e o `.foot-license` também
perderam as linhas; as colunas e o copyright continuam.

## Responsividade e temas

- A remoção é só de borda: não há mudança de grid, largura, `padding` ou `overflow`.
- Testado em 320, 390, 768, 1024 e 1440 px, nos temas claro e escuro; sem rolagem horizontal.
- Os temas manuais também foram conferidos; a linha não volta por causa de uma regra de mídia.
- O cabeçalho fixo continua opaco nos dois temas.
- O espaço entre seções foi preservado; a página não "colou" um bloco no outro.

## Acessibilidade

- Nenhuma âncora, título ou ordem de foco mudou.
- Nenhum contraste de texto foi alterado; as linhas eram decoração.
- As bordas que ajudam a delimitar tabelas, FAQ e cards continuam.
- A landing, a Segurança e a documentação continuam em 100 de acessibilidade no Lighthouse 13.6, tema claro.

## Alternativas consideradas

1. **Clarear a linha em vez de removê-la.** Ainda apareceria; o pedido foi não deixar visível.
2. **Usar um gradiente de fade no lugar da linha.** Continuaria sendo uma faixa decorativa e criaria mais ruído.
3. **Remover todas as bordas, inclusive cards e tabelas.** Prejudicaria a leitura de planos, comparativos e FAQ; a
   escolha foi manter as bordas funcionais.
4. **Remover só na landing.** Deixaria a documentação, as legais e Novidades com o mesmo padrão antigo. A correção foi
   aplicada também nelas.
5. **Usar um fundo alternado por seção.** Seria outra mudança visual e não foi pedida; o espaçamento já resolve.
6. **Esconder a linha com `overflow: hidden` ou um pseudo-elemento branco.** Voltaria a aparecer em tema escuro, zoom
   ou impressão; a regra foi removida na origem.

## Limitações e próximos passos

- A grade de recursos mantém as linhas das células. Uma grade sem nenhuma linha exigiria repensar os cards.
- As listas, tabelas, FAQ e a navegação lateral continuam com linhas; são bordas de conteúdo, não divisórias de seção.
- A grade decorativa do herói da Segurança continua; é textura, não divisória.
- Antes do merge, repetir a conferência na Vercel e rodar o Lighthouse no tema claro.
