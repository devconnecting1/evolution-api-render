# Decisões do cartão de estado e das faixas clicáveis

## 1. O problema

A página tinha a informação certa, mas a hierarquia estava errada:

- o estado geral era um título solto, com um rótulo mono pequeno (“Verificado agora mesmo”) que parecia mais um metadado do que o estado da operação;
- as faixas de histórico eram `span` com `title`. No celular, o `title` não aparece; no teclado, não havia como abrir; clicar não fazia nada;
- a legenda dizia o que cada cor significava, mas não o que aconteceu em um período específico.

O pedido foi direto: remover o rótulo, transformar o estado atual em um cartão com cor de operação e fazer cada faixa mostrar a informação dela.

## 2. Hierarquia do cartão

A ordem dentro do cartão é:

1. **Estado:** ponto + rótulo textual. É a primeira leitura.
2. **Atualização:** horário relativo no canto. Diz se o retrato é recente.
3. **Título:** frase curta do estado geral.
4. **Resumo:** o que está acontecendo para quem chega sem contexto.
5. **Recomendação:** uma frase com o que fazer.
6. **Cadência:** “Verificação a cada 5 minutos” e o link para “Como medimos”.

O cartão tem a largura de 980 px, a mesma dos grupos de componentes. Ele deixa de ser um bloco de texto de 760 px e passa a alinhar com o restante da página.

## 3. Cor com significado

As cores vêm dos tokens semânticos que o site já usa:

- operacional: `--c-ok-bg` e `--c-ok`;
- degradado: `--c-warn-bg` e `--c-warn-border`;
- indisponível: `--c-bad-bg` e `--c-bad-border`;
- sem dados: `--c-bg-soft` e `--c-border-strong`;
- falha de leitura: âmbar, com o rótulo “Sem leitura”.

Nada de cor decorativa. O rótulo textual e a recomendação repetem o significado, então a cor não é a única fonte. No escuro, os mesmos tokens têm variantes próprias.

A falha da API é âmbar, não vermelha: a página não sabe se o serviço caiu, só que não conseguiu ler. Dizer “indisponível” nesse caso seria inventar.

## 4. Recomendações por estado

| Estado | Recomendação |
|---|---|
| Operacional | Nada a fazer: o atendimento está disponível. |
| Degradado | A instabilidade está registrada. Se o seu WhatsApp não responder, fale com a equipe. |
| Indisponível | O componente não está respondendo. Se o seu atendimento parou, fale com a equipe. |
| Sem dados | Ainda não há leitura dos componentes. Tente de novo em alguns minutos. |
| Sem leitura (falha) | Não foi possível ler o status agora. Tente de novo ou fale com a equipe se o seu atendimento parou. |

As frases não prometem prazo, causa ou resultado. Elas dizem o que a pessoa pode fazer agora.

## 5. Faixa clicável

Cada faixa é um `<button type="button">`, não um `span` com `title`. O detalhe abre em um bloco abaixo da linha do componente, ocupando toda a largura da linha.

O bloco mostra:

- o nome do componente;
- o estado com rótulo e cor;
- o intervalo de 3 horas no horário local;
- o significado do estado;
- a ação recomendada;
- o botão **Fechar**.

O detalhe é inline, não um popup. Motivos:

- no celular, um popover cobriria as faixas e o próprio texto que a pessoa quer ler;
- o texto é longo e precisa quebrar linha sem ficar apertado;
- o teclado não fica preso em um modal;
- a página não precisa de posicionamento absoluto, camada ou clique fora para fechar.

No desktop, o detalhe ocupa a linha inteira para não comprimir o texto na coluna das barras. No celular, ele aparece depois do estado atual.

## 6. Teclado e leitores de tela

O grupo de faixas tem um único ponto de tabulação. Ao receber foco, ele leva o foco à faixa atual. Depois:

- seta esquerda e seta direita mudam a faixa;
- Home e End vão à primeira e à última;
- Enter e Espaço abrem o detalhe.

Cada botão tem `aria-label` com o período e o estado, `aria-pressed` para a faixa escolhida e `aria-controls` para o detalhe. O detalhe é `aria-live="polite"`.

Isso evita 120 paradas de tabulação (24 faixas em 5 componentes) e mantém a navegação por teclado utilizável.

## 7. Estados e casos de borda

- **Sem dados:** a faixa cinza existe e pode ser clicada; o detalhe explica que não houve coleta e que a página não pode afirmar disponibilidade.
- **Falha da API:** o cartão fica âmbar com “Sem leitura”, o alerta com “Tentar de novo” aparece e as faixas ficam cinza. O detalhe não é aberto porque não há histórico confiável.
- **Atualização com detalhe aberto:** a cada cinco minutos o histórico é redesenhado e o detalhe fecha; a página volta ao estado atual. É aceitável para uma página de status e evita manter um detalhe de um retrato que já mudou.
- **Troca de estado:** o cartão muda de cor com uma transição curta; a regra de movimento reduzido do CSS zera a transição.
- **Tema:** os fundos coloridos usam tokens com variantes clara e escura; o texto principal continua no token de texto, com contraste alto.

## 8. O que não foi feito

- Tooltip flutuante ou popover: menos legível no celular e mais difícil de posicionar.
- 120 botões tabuláveis: pior para quem usa teclado.
- “Tudo operacional” verde para períodos sem coleta: inventaria disponibilidade.
- Agrupar transições em um incidente ou mostrar uma nota manual: fica para a próxima evolução.
- Monitor externo: o histórico ainda depende de alguém abrir a página; está registrado como próximo passo.

## 9. Validação

- Playwright com API simulada em 1440 e 390 px, claro e escuro.
- Clique em faixa verde e em faixa cinza.
- Teclado: foco no grupo, setas, Enter e `aria-pressed`.
- Falha da API com `fetch` 500.
- Sem rolagem horizontal e sem erro de console.
- `node --check`, `esbuild`, patches do painel, CSP e `git diff --check`.
