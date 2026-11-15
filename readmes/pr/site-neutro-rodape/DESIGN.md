# Decisões de design: accent neutro e rodapé com wordmark

## Método

- Referência pública: rodapé da home do opencode.ai, capturado em 1440 e 390 px, temas claro e escuro, em 15/11/2026.
- A referência usa um wordmark grande na base do rodapé, com letras vazadas e alças de edição. O WhatsAI manteve a
  escala e a posição, não o desenho.
- O accent neutro foi definido nos tokens globais das páginas públicas e aplicado a Docs, Segurança, Termos,
  Privacidade e Novidades. A landing já usava o accent neutro desde a rodada anterior.
- Nenhum arquivo, CSS, fonte, texto, logo, imagem ou vídeo do opencode foi copiado.

## Tokens

| Uso | Claro | Escuro |
| --- | --- | --- |
| Accent | `#0d0d0d` | `#ffffff` |
| Accent forte | `#000000` | `#e3e3e3` |
| Accent suave | `#f0f0f0` | `#1f1f1f` |
| Accent suave 2 | `#e3e3e3` | `#272727` |
| Borda do accent | `#c7c7c7` | `#4d4d4d` |
| Foco | `#0d0d0d` | `#ffffff` |
| Seleção | `#f0f0f0` | `#1f1f1f` |
| Hover do botão primário | `#272727` | `#e3e3e3` |
| ok (semântico) | `#0e7a4d` | `#5fcf8a` |
| Atenção (semântico) | `#5a3a00` em texto / âmbar em borda | `#fcd38d` |
| Erro (semântico) | `#b42318` | `#fca5a5` |

O verde de interface saiu. O verde, o âmbar e o vermelho continuam com significado: status ok, checks, notas,
atenção e erro. O accent neutro mantém o contraste alto nos dois temas e não compete com esses estados.

## Cabeçalho

- O ícone de chat saiu de todas as páginas com o cabeçalho público.
- O texto "WhatsAI" continua no topo, com o mesmo peso, alinhado à esquerda.
- A navegação central e as ações à direita não mudaram.
- O topo da documentação, que já era só texto, não precisou de mudança.

## Rodapé

```
rodapé
├── linha superior
│   ├── Falar no WhatsApp
│   ├── links essenciais
│   └── copyright e aviso de marcas
└── wordmark "WhatsAI" grande, link para a home
```

- O wordmark usa Geist 600, `letter-spacing: -0.06em`, `line-height: 0.74` e
  `font-size: clamp(70px, 21vw, 300px)`.
- Em 1440 px: 300 px de fonte, cerca de 242 px de altura e o bloco de conteúdo inteiro disponível.
- Em 390 px: 82 px de fonte e 73 px de altura.
- Em 320 px: 70 px de fonte, ainda dentro dos 280 px de conteúdo.
- O texto é preto no claro e branco no escuro. O hover usa `--c-text-2`, sem verde.
- O wordmark é um link estático para `/`, com texto visível e sem animação.
- A landing, Novidades, Segurança, Termos e Privacidade compartilham o rodapé. O rodapé da documentação continua
  compacto, com o texto "WhatsAI" e as colunas de links.

## Acessibilidade

- Os números dos cartões de controle da página de segurança usam `--d-text-3` (5,4:1 no claro), não mais
  `--d-text-4` (3,23:1).
- O "Não" das tabelas usa `--d-warn-text`, que mantém o significado de atenção com contraste suficiente.
- Os títulos do fluxo de dados passaram de `h4` para `h3`, na ordem correta depois do `h2` da seção.
- O wordmark é um link com texto visível; não depende de `aria-label` para ser entendido, embora tenha o rótulo.
- O foco visível continua nos links e botões; o wordmark usa o foco padrão do site.
- O Lighthouse de `/seguranca` passou de 95 para 100 em acessibilidade, no computador e no celular.

## Responsivo

| Largura | Fonte do wordmark | Altura aproximada |
| --- | --- | --- |
| 320 px | 70 px | 64 px |
| 390 px | 82 px | 73 px |
| 768 px | 161 px | 132 px |
| 1440 px | 300 px | 242 px |

O wordmark não cria rolagem horizontal em nenhuma das larguras. O `overflow: hidden` é só uma proteção.

## O que é nosso

- A tipografia Geist, o texto "WhatsAI", o link para a home e o rodapé com status/links/aviso legal.
- Os tokens neutros e as correções de acessibilidade.
- O desenho sólido do wordmark.

## O que ficou de fora, de propósito

- As letras hatched, as alças de edição, a animação e o desenho do opencode.
- O wordmark no rodapé da documentação, para não competir com a sidebar.
- O verde de interface em links, botões, menus e ícones.
- Qualquer requisição externa, CDN, cookie ou telemetria nova.

## Alternativas consideradas

1. **Manter o verde como accent nas páginas públicas.** O dono pediu neutro; o preto/branco mantém a leitura e não
   compete com os estados semânticos.
2. **Copiar o wordmark hatched do opencode.** Seria copiar um desenho proprietário e adicionar interação sem
   necessidade. A versão sólida em Geist é mais leve e acessível.
3. **Colocar o wordmark também no rodapé da documentação.** A sidebar do `/docs` já carrega a marca; um título de
   300 px ali competiria com o conteúdo. Se for pedido, usar uma variante menor.
4. **Animar o wordmark.** A página não tem animação de entrada; o wordmark estático é mais rápido e não distrai.
5. **Deixar o wordmark com a cor de accent suave.** O texto cheio preto/branco dá mais presença de marca e mantém o
   contraste.

## Limitações e próximos passos

- O wordmark aumenta a altura do rodapé (cerca de 242 px no desktop e 73 px no celular). É parte do pedido de um
  título grande; se o dono quiser um rodapé mais curto, reduzir a fonte.
- O rodapé da documentação não recebeu o wordmark. A recomendação é manter compacto.
- O verde semântico (status, checks e notas) continua; se o dono quiser remover todo verde, isso é uma decisão separada
  sobre os estados.
- Antes do merge: repetir o Lighthouse em produção (`/` e `/seguranca`) e conferir a publicação na Vercel. A mudança é
  estática e leva `[skip render]`.
