# Decisões de design: botões conectados

## Referência

O opencode.ai usa um botão dividido: uma ação principal e um segmento anexo, sem espaço entre eles, com uma
divisória fina e um único contorno externo. O segmento anexo não é outra ação de página; é um complemento da mesma
ação.

O WhatsAI precisa do mesmo efeito com outra intenção: dois CTAs de verdade, um principal e um secundário. A solução
foi transportar a mecânica do botão dividido para um grupo de dois botões:

- mesmo contorno externo;
- sem espaço interno;
- divisória única de 1 px;
- cantos arredondados só nas extremidades;
- altura e alinhamento iguais;
- hierarquia preservada pelas cores.

## Anatomia do grupo

Na landing, `wa-btn-group`; na documentação e nas páginas legais, `btn-group`.

| Propriedade | Valor | Motivo |
| --- | --- | --- |
| `display` | `flex` | mantém os segmentos na mesma linha |
| `flex-wrap` | `nowrap` | impede o empilhamento em qualquer largura |
| `align-items` | `stretch` | iguala a altura dos dois botões |
| `gap` | `0` | remove o espaço interno do grupo |
| raio do primeiro | `2px 0 0 2px` | preserva o raio externo do site |
| raio do segundo | `0 2px 2px 0` | fecha o contorno externo |
| segundo botão | `margin-left: -1px` | sobrepõe as bordas e cria uma divisória única |
| foco | `position: relative; z-index: 1` | o contorno não é coberto pelo vizinho |

O `-1px` é o detalhe que faz o grupo parecer um só controle. Sem ele, aparecem duas bordas ou um vão de 1 px. A
borda do segundo botão é a divisória; o primeiro não precisa de borda direita.

O raio de 2 px é o mesmo dos botões existentes. Um raio grande transformaria o grupo em pílulas separadas e
quebraria a leitura de continuidade.

## Hierarquia

O grupo não é uma pílula única com duas cores iguais. A landing mantém:

- primeiro botão: preenchimento `--wa-btn` (preto no claro, branco no escuro), texto invertido;
- segundo botão: `ghost`, com borda `--wa-line-strong` e fundo transparente (ou `--wa-card` no hover).

Na documentação e nas páginas legais:

- primeiro botão: `btn-primary` com `--d-btn-bg` e texto `--d-btn-text`;
- segundo botão: `btn-quiet` com `--d-bg`, borda e texto do tema.

A conexão é estrutural. Se os dois ficassem com o mesmo preenchimento, o usuário perderia a pista de qual é a ação
principal. Se ficassem separados por 10 px, o par voltaria a parecer dois controles independentes.

## Responsividade

### Landing

- Acima de 719 px, o grupo usa a largura do conteúdo.
- Até 719 px, o grupo ocupa 100% da largura e os dois botões dividem o espaço (`flex: 1 1 auto`).
- Até 719 px, os botões usam 13 px de fonte e 12 px de padding lateral.
- Abaixo de 390 px, os rótulos completos são trocados pelos curtos:
  - "Agendar demonstração" vira "Agendar";
  - "Ver planos e preços" vira "Ver planos";
  - "Falar no WhatsApp" vira "WhatsApp".
- Abaixo de 390 px, a fonte cai para 12 px e o padding para 8 px. O botão principal mantém a seta.

### Documentação e páginas legais

- O grupo ocupa 100% da largura do conteúdo em 559 px ou menos (documentação) e 719 px ou menos (legais).
- Os botões usam 13 px de fonte e 10 px de padding lateral no celular.
- Abaixo de 390 px, os rótulos curtos entram em cena e a fonte cai para 12 px com 8 px de padding.
- O botão solitário da Privacidade continua com largura total no celular; não há grupo para conectar.

### Por que encurtar em vez de empilhar

Em 320 px, os rótulos completos não cabem em dois segmentos com padding legível. As alternativas eram:

1. empilhar, que é exatamente o que o pedido proíbe;
2. permitir quebra de linha dentro do botão, criando alturas diferentes e um grupo com duas linhas;
3. esconder a segunda ação, perdendo um caminho;
4. encurtar o rótulo.

A opção 4 mantém as duas ações, a mesma linha e o grupo conectado. O texto completo volta em 390 px, que é a largura
de referência do teste. O nome acessível acompanha o rótulo visível, sem `aria-label` divergente.

## Hover e foco

### Landing

- O hover usa `--wa-btn-hover` e `--wa-btn-fg`, que já existiam: `#272727` com texto branco no claro e `#e3e3e3` com
  texto escuro no escuro.
- O segundo botão usa `--wa-card` no hover, mantendo a divisória.

### Documentação e páginas legais

O hover antigo do `btn-primary` usava `--d-accent` no gradiente e `#ffffff` fixo no texto. No tema escuro, o accent
é branco, então o texto sumia no fundo. A correção:

- novo token `--d-btn-hover: var(--c-btn-hover)`;
- hover com `background-color: var(--d-btn-hover)`, `background-image: none` e `color: var(--d-btn-text)`;
- resultado: `#272727` com branco no claro; `#e3e3e3` com `#0d0d0d` no escuro.

O foco visível tem 2 px. O `z-index` no foco mantém o contorno acima da divisória e do vizinho.

## Acessibilidade

- O grupo não muda a ordem de tabulação: primeiro a ação principal, depois a secundária.
- Não há texto duplicado para leitores de tela: o rótulo oculto pelo CSS usa `display: none`, que sai da árvore de
  acessibilidade.
- Os dois botões continuam alvos separados; o contorno externo compartilhado não transforma o grupo em um único alvo.
- A landing mantém 44 px de altura; documentação e legais mantêm 40 px, acima do mínimo de 24 px do WCAG 2.2.
- A landing, a Segurança e a documentação ficaram em 100 de acessibilidade no Lighthouse 13.6 no tema claro.
- Os quatro estados de tema foram testados: claro, escuro, escuro com tema manual claro e claro com tema manual
  escuro.

## Alternativas consideradas

1. **Manter o gap de 10 px e só impedir o empilhamento.** O grupo continuaria parecendo dois controles soltos; além
   disso, os rótulos longos não caberiam em 320 px sem overflow.
2. **Empilhar no celular.** Era o comportamento anterior e o motivo do pedido. Rejeitado.
3. **Usar um botão dividido com chevron e menu.** O segundo CTA leva a uma página ("Ver planos", "Falar no WhatsApp",
   "Ler a política"), não abre opções. Um menu esconderia uma ação que precisa estar visível.
4. **Igualar as cores dos dois segmentos.** Daria a aparência de um único controle, mas eliminaria a hierarquia entre
   demonstração e plano/contato.
5. **Quebrar o rótulo em duas linhas.** Os botões ficariam com alturas diferentes ou com duas linhas internas,
   afastando o resultado da referência.
6. **Esconder a segunda ação no celular.** Reduziria o caminho de conversão e não resolveria a regra de manter os
   botões lado a lado.
7. **Usar `aria-label` com o texto completo nos rótulos curtos.** O nome acessível deixaria de conter o texto visível,
   o que atrapalha controle por voz. O rótulo visível é o nome acessível.

## Limitações e próximos passos

- A referência do opencode é uma captura de revisão, não um asset do site. Se a referência for publicada fora do PR,
  conferir a regra de marcas de terceiros.
- Em 320 px, o grupo da landing fica com dois segmentos largos e rótulos curtos; a leitura é clara, mas o texto
  completo só volta em 390 px.
- O grupo não tem animação própria; o hover e o foco usam as transições existentes dos botões.
- Se um terceiro botão entrar no grupo, a divisória e a hierarquia precisam ser redesenhadas; o componente atual é
  para dois segmentos.
- Antes do merge, repetir a conferência em produção depois da Vercel e rodar o Lighthouse no tema claro.
