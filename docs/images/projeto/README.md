# Imagens do guia do projeto

Capturas usadas em [`readmes/GUIA-DO-PROJETO.md`](../../../readmes/GUIA-DO-PROJETO.md).

## Como foram geradas

- **Painel:** `manager/dist` servido localmente e **API simulada** por interceptação de rede no Playwright. O app
  foi autenticado com `localStorage` (`apiUrl`, `token`, `version`) e todos os endpoints foram respondidos por
  fixtures locais. `window.WebSocket` foi substituído por uma classe inerte e qualquer host externo foi bloqueado.
- **Site:** `manager/dist` servido localmente com as rotas de `manager/dist/vercel.json`; nenhuma requisição externa.
- **Zero acesso à produção:** nenhuma chamada HTTP/WebSocket saiu da máquina.
- **Dados fictícios:** “Escritório Exemplo Advogados”, contatos e conversas inventados. Nenhum dado de cliente real.
- **Tema:** claro/escuro conforme `wa-theme` (painel) e `prefers-color-scheme`/`data-theme` (site).

Os scripts de geração **não** estão versionados; a recomendação P1 do guia é transformá-los em
`scripts/docs-screenshots/` com fixtures fictícias, para regenerar as capturas e permitir teste visual.

## Convenção de nome

`<área>-<tela>-<tema>-<largura>.png`, por exemplo `painel-conversas-dark-1440.png` e
`site-seguranca-light-390.png`. A home inteira tem o sufixo `full`.
