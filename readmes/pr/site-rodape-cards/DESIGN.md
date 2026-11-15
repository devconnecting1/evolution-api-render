# Decisões de design: rodapés sem descrição e cards opacos

## Método

- Revisão visual das páginas públicas em 320, 390 e 1440 px, temas claro e escuro.
- Foram identificadas as superfícies que usavam `transparent` ou `rgba` como preenchimento, especialmente o painel da
  faixa de destaque, os cards de recursos, a cópia do carrossel, as paisagens e os ladrilhos do herói da Segurança.
- O critério: o fundo decorativo da seção pode aparecer nos vãos e ao redor dos cards, nunca através do preenchimento
  de um card ou de uma caixa de conteúdo.
- As descrições dos rodapés foram removidas a pedido do dono; o copyright, os links e o status continuam.

## Rodapé

### Público

```
Falar no WhatsApp · links essenciais · © 2026 WhatsAI
WhatsAI (wordmark grande)
```

Saiu a nota "WhatsApp é marca da Meta; o WhatsAI não é afiliado à Meta nem à OpenAI." e ficou o copyright. O
wordmark e o restante do rodapé não mudaram.

### Documentação

```
WhatsAI
Produto · Recursos · Atalhos
© 2026 WhatsAI.
```

Saíram a descrição do produto e a frase "Documentação baseada no manual operacional do projeto." A marca em texto,
as colunas e o copyright continuam.

## Superfícies opacas

| Página | Elemento | Antes | Depois |
| --- | --- | --- | --- |
| Landing | Cards de recursos | transparente | `--wa-card` |
| Landing | Cópia do carrossel (desktop) | transparente | `--wa-bg` |
| Landing | Mídia do carrossel | gradiente com base transparente | `--wa-bg` + gradiente |
| Landing | Paisagens abstratas | gradiente com base transparente | `--wa-art-sky` + gradiente |
| Landing | Painel da faixa de destaque | `rgba(255,255,255,.04)` | `#141414` |
| Segurança | Ladrilho do círculo (`.ta-b2`) | gradientes com paradas transparentes | base `--d-bg` + gradientes |
| Segurança | Ladrilho de linhas (`.ta-c2`) | linhas com fundo transparente | base `--d-bg` + linhas |
| Segurança | Canais de contato | transparente | `--d-bg` |
| Segurança, Termos, Privacidade | Wrappers de tabela | transparente | `--d-bg` |
| Legais | Cards de controles e resumo | já opacos | mantidos |

A regra é simples: o preenchimento de um card é uma cor de superfície opaca. Transparência fica para overlay de mídia,
bordas, sombras e estados.

## Textura e decoração

- A grade do herói da Segurança continua atrás da seção; os ladrilhos agora têm base opaca e o desenho é feito dentro
  deles.
- Os pontos da faixa de destaque continuam atrás do painel; o painel é grafite sólido.
- Os cards de recursos não têm textura; a superfície `--wa-card` os separa da página.
- A mídia do carrossel mantém os gradientes, mas sobre uma base `--wa-bg`; nenhuma parte do fundo da página atravessa.
- No celular, a cópia do carrossel é transparente sobre a mídia grafite opaca. É a única transparência de texto que
  sobrou, e ela não revela o fundo da página; o texto branco precisa do fundo escuro para manter contraste.

## Cores e contraste

- O accent continua neutro: preto no claro e branco no escuro.
- As superfícies opacas usam os tokens existentes; nenhuma cor nova.
- A remoção da nota do rodapé não muda contraste de links ou texto.
- `/seguranca` continua com acessibilidade 100 no Lighthouse; `/docs` também.
- O verdinho semântico do status e dos checks continua.

## Alternativas consideradas

1. **Deixar os cards transparentes e apenas remover a textura do fundo.** Isso tiraria a grade e os pontos do herói e
   da faixa, que são parte da referência. A base opaca preserva a textura sem atravessar os cards.
2. **Usar uma superfície cinza em todos os cards.** Mudaria a hierarquia da landing e da documentação. Onde o card
   já tinha superfície, ela foi mantida; onde era transparente, usei a superfície da página ou `--wa-card` quando o
   card precisava de separação.
3. **Remover o wordmark junto com as descrições.** O wordmark é a marca do rodapé; a descrição era o texto ao lado
   dele. A remoção foi só das descrições.
4. **Manter o aviso de marcas no rodapé.** O dono pediu para remover; o aviso de uso da licença do Evolution API
   continua no README e no Manual, que é onde a condição 1b exige.
5. **Colocar fundo opaco no painel da faixa só no tema escuro.** O painel é grafite nos dois temas; a base `#141414`
   é consistente com o bloco e esconde os pontos.

## Limitações e próximos passos

- A mudança dos ladrilhos da Segurança é sutil porque o desenho continua igual; a diferença é a base opaca.
- Termos e Privacidade já tinham as caixas principais opacas; a correção neles foi nos wrappers de tabela e nos
  blocos de contato.
- Se o dono quiser um card de recursos com outra superfície, é uma troca de token local, sem mexer na estrutura.
- Antes do merge: repetir o Lighthouse em produção (`/` e `/seguranca`) e conferir a Vercel. A mudança é estática e
  leva `[skip render]`.
