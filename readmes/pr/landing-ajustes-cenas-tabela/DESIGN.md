# Decisões: painéis, tabelas e pontos

## Painéis: um canto só

As quatro cenas usavam cantos alternados: inferior direito, inferior esquerdo, superior direito e superior esquerdo.
A variação não acrescentava informação e quebrava a leitura: o olho precisava procurar o painel em cada seção.

A decisão foi fixar todos no **inferior direito**. Conversas já estava assim e serve de referência. As marcas d'água
vão todas para o **superior esquerdo**, de modo que o fundo respira sempre do mesmo lado. O recorte, a sombra, o raio
de 2 px e o fundo não mudam; a mudança é só de posição.

No celular, o painel ocupa 94% da largura e mantém o canto inferior direito. A marca d'água continua no topo.

Alternativas:

- **Manter a alternância.** Rejeitada: o usuário pediu o mesmo lado e a variação não tinha função.
- **Espelhar a posição conforme o texto.** É o que existia; cria quatro composições diferentes para a mesma ideia.
- **Painel centralizado.** Rejeitada: perde o efeito de cena e o fundo fica sem função.

## Tabelas: docs como fonte

A tabela da landing estava em 13 px, com 10/14 px e moldura externa no bloco de número adicional. A do docs usa 16 px,
12/20 px, cabeçalho mono de 14 px e nenhuma moldura externa. A diferença fazia a landing parecer um produto diferente.

A decisão foi usar a escala do docs na landing:

- 16 px e entrelinha 1.4;
- células de 12/20 px; cabeçalho de 10/20 px;
- cabeçalho em mono, 14 px, caixa alta, sem quebra;
- primeira coluna em peso 500;
- sem moldura externa.

A largura mínima continua 720 px na landing, porque a matriz de planos tem quatro colunas e rótulos longos; o docs usa
540 px para tabelas menores. A escala e o respiro são os mesmos; a largura é consequência do conteúdo.

Alternativas:

- **Manter a tabela compacta.** Rejeitada: o usuário pediu para comparar e igualar ao docs.
- **Empilhar a tabela em cards no celular.** Melhoraria a leitura de uma tabela pequena, mas a matriz de planos é
  comparativa: empilhar quebraria a comparação lado a lado. O docs também usa rolagem horizontal.
- **Fonte de 15 px.** Ficaria entre os dois, mas não seria o mesmo padrão.

## Rolagem: dica, fade e foco

Em 390 px, a tabela do docs mostrava três colunas e cortava a quarta sem nenhuma pista. A da landing fazia o mesmo. O
visitante podia achar que a tabela terminava ali.

A decisão foi usar um script pequeno e progressivo:

- detecta wrappers que passam da largura;
- insere a dica "Deslize para ver a tabela completa";
- aplica uma máscara de 28 px na borda direita enquanto houver conteúdo à direita;
- remove a máscara ao chegar ao fim;
- dá `role="region"`, `aria-label` e `tabindex="0"` ao contêiner rolável;
- escuta scroll, resize, `toggle` de `<details>` e `ResizeObserver` para atualizar.

Em 768/1440, quando a tabela cabe, nada aparece. No docs, uma tabela mais larga ainda rola em 768 e recebe a dica; no
celular, todas as que passam recebem. O mesmo CSS/JS é usado nas páginas legais, porque elas carregam docs.css.

Alternativas:

- **Só scrollbar.** Em celular, a scrollbar é overlay e fica invisível; a dica e o fade cobrem esse caso.
- **Só dica.** A dica diz o que fazer, mas não mostra o corte; o fade dá a pista lateral.
- **Só fade.** Sem texto, pode parecer um problema de renderização.
- **Sempre mostrar a dica.** Polui as tabelas que cabem; o script só mostra quando há overflow.
- **Transformar a tabela em cards.** Rejeitado pela comparação lado a lado dos planos.

## Pontos: auditoria

O problema das notas dos canais era um ponto pequeno, colorido e alinhado ao topo da linha. A auditoria nas páginas
públicas encontrou apenas marcadores com função:

- `.status-dot` em Segurança e Docs: 7 px, verde, `flex: none`, `margin-top: 7px`; alinhado à primeira linha.
- `.wa-docfoot-dot`: 7 px, `currentColor`, `flex: none`; neutro e alinhado.
- `.callout-ico`: 24 px, com símbolo, cor semântica; não é um ponto decorativo.

Nada foi alterado. Remover o ponto verde ou os ícones de aviso tiraria significado, não ruído.

## Acessibilidade

- A dica é texto visível; não depende só de cor.
- O contêiner rolável recebe foco e nome acessível.
- O fade é decorativo; o conteúdo continua no DOM e acessível.
- A tabela mantém cabeçalhos `th` com `scope` quando já existiam.
- O script não intercepta teclado nem impede a rolagem nativa.

## Performance

- Nenhuma imagem nova.
- Um script de cerca de 2 KB, sem timer e sem rede.
- A dica e o fade não aparecem em telas onde a tabela cabe.
- Lighthouse local com gzip: desktop 100 nas quatro categorias; celular 99 em performance e 100 nas outras três.

## Limitações

- A matriz de planos continua rolando no celular; a dica não elimina a rolagem.
- Sem JavaScript, a rolagem nativa continua; a dica e o fade não aparecem.
- Navegadores antigos podem ignorar `mask-image`; restam a dica e a scrollbar.
- O CSS dos mockups antigos continua no bundle.
