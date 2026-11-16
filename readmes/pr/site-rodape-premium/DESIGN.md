# Decisões de design: wordmark centralizado e Premium invertido

## Wordmark centralizado

- O rodapé público tem uma linha superior com status, links e copyright e, abaixo, o wordmark grande.
- O wordmark estava alinhado à esquerda. Como ele é uma assinatura de marca, o centro da faixa de conteúdo dá o
  equilíbrio esperado e resolve o aspecto "torto".
- A mudança é só `text-align: center` no `.wa-docfoot-wordmark`; a escala, o peso, o line-height e o link continuam.
- A linha superior não foi centralizada: ela continua com status à esquerda e links/copyright à direita.
- O rodapé da documentação não usa o wordmark; a marca em texto e as colunas continuam compactas.

## Premium invertido no tema escuro

### Estados

| Estado | Fundo do card | Texto | Botão | Selo | Pixels |
| --- | --- | --- | --- | --- | --- |
| Claro | `#0d0d0d` | `#ffffff` | branco, texto `#0d0d0d` | borda clara, texto branco | brancos |
| Escuro | `#f5f5f5` com gradiente leve | `#0d0d0d` | `#0d0d0d`, texto `#f5f5f5` | `#f0f0f0`, texto escuro | invertidos para escuros |

O plano Premium é o card em destaque. No tema claro, ele já era o card grafite entre cards claros. No tema escuro, se
continuasse grafite, ficaria parecido com os outros planos e com a página; a inversão mantém o destaque.

### Tokens locais

O card define tokens locais em vez de usar os tokens escuros globais:

- `--wa-fg`, `--wa-fg-2`, `--wa-fg-3`: texto;
- `--wa-line`, `--wa-line-strong`: linhas da tabela de implantação;
- `--wa-accent`, `--wa-accent-soft`, `--wa-accent-line`: botão, selo e checks;
- `--wa-premium-bg`: fundo do card e cor do texto do botão;
- `--wa-premium-btn-hover`: hover do botão.

No tema claro, o fundo é `var(--c-dark-surface)`; no escuro, `#f5f5f5`. O botão usa `var(--wa-accent)` como fundo e
`var(--wa-premium-bg)` como texto. O selo usa o accent local; os checks também. Assim, a inversão inteira acontece com
a troca dos tokens, sem regras específicas para cada elemento.

### Pixels

- O `landing-pixels.js` desenha pixels brancos; ele não foi alterado.
- No tema escuro, o canvas recebe `filter: invert(1)`, virando pontos escuros sobre o card claro.
- A máscara do canvas e o `prefers-reduced-motion` continuam iguais.
- Se o script passar a desenhar em outra cor, o filtro deve ser revisto.

### Temas manuais

- `:root[data-theme-mode="dark"] .wa-plan--px` aplica o card claro quando o tema é fixado em escuro.
- `@media (prefers-color-scheme: dark)` só aplica quando `data-theme-mode` não é `light`, então o tema manual claro
  continua com o card grafite.
- Isso evita o bug de o sistema estar escuro e o usuário escolher claro.

## Acessibilidade

- Card claro: texto `#0d0d0d` sobre `#f5f5f5`, botão `#f5f5f5` sobre `#0d0d0d`, selo escuro sobre `#f0f0f0`. Os
  contrastes principais ficam acima de 15:1.
- Card grafite: os contrastes continuam os mesmos do tema claro, que já passava em 100 no Lighthouse.
- O fundo claro tem base opaca, então o card não revela a página.
- O texto do botão no card claro é claro sobre escuro; o hover `#272727` mantém o contraste.
- `/` e `/seguranca` continuam em 100 de acessibilidade no Lighthouse no tema claro; o card do tema escuro foi
  conferido pelos valores computados e pela captura.

## Alternativas consideradas

1. **Centralizar também a linha superior.** Isso quebraria a leitura de status/links/copyright. Só o wordmark foi
   centralizado.
2. **Manter o Premium escuro no tema escuro e adicionar uma borda.** O card continuaria se confundindo com os outros
   planos. A inversão é mais clara e foi o pedido.
3. **Usar `#ffffff` no card claro.** O `#f5f5f5` mantém a suavidade e o gradiente; o `#ffffff` puro deixaria o card
   muito duro sobre o fundo escuro.
4. **Mudar o script de pixels para desenhar escuro.** O filtro CSS resolve sem alterar o JS e sem risco de regressão no
   card do tema claro.
5. **Usar apenas o seletor de mídia.** O site tem seletor de tema manual; sem o bloco de `data-theme-mode`, o card
   ficaria errado quando o usuário fixasse o tema.

## Limitações e próximos passos

- O card claro no tema escuro é proposital; se o dono quiser um contraste menor, usar `#ececec`.
- O Lighthouse padrão não audita o tema escuro; a validação foi visual e por valores computados.
- Antes do merge: repetir o Lighthouse em produção (`/` e `/seguranca`) e conferir a Vercel. A mudança é estática e
  leva `[skip render]`.
