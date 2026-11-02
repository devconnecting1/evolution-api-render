## Preços (implantação + mensalidade)

| | Essencial | Profissional | Premium (API oficial) |
|---|---:|---:|---:|
| Mensalidade | R$ 397 | R$ 697 | R$ 1.297 |
| Implantação, contrato de 6 meses | R$ 1.500 | R$ 2.900 | a partir de R$ 4.900 |
| Implantação, contrato de 12 meses | R$ 990 | R$ 1.900 | a partir de R$ 3.500 |
| Respostas da IA por mês | 2.000 | 5.000 | 10.000 |
| Números | 1 | até 2 | 1 (+ sob consulta) |
| Ajustes nas instruções por mês | 2 | 4 | 8 |
| Áudio, foto e PDF | Sim | Sim | Sim |

- **Excedente:** R$ 49 por bloco de 1.000 respostas. **Piloto assistido de 14 dias:** R$ 490, abatido da implantação.
- **Contrato mínimo de 6 meses**; o de 12 meses tem a implantação mais barata da tabela.
- Detalhes para o cliente no **Guia comercial**. Custos, margens e roteiro de vendas ficam no Guia de Vendas interno, fora deste manual.

## O que é automático e o que é serviço

- **Automático:** respostas 24 h, memória (2 a 100 mensagens), áudio, foto e PDF, junção de mensagens seguidas, pausa quando a equipe responde (WhatsApp Web; na API oficial só com Coexistence e o campo `smb_message_echoes` assinado), retomada após o tempo combinado.
- **Serviço da nossa equipe:** instruções, integrações (n8n ou webhook, sob medida), relatório mensal, monitoramento, pausa manual a pedido do cliente (o cliente não acessa o painel).
- **Não existe hoje:** aviso automático para a equipe quando o cliente pede uma pessoa; relatório automático; marcação no banco de quais mensagens foram da IA.
- **Tempo de resposta real:** ~20 a 40 s (espera para juntar mensagens + OpenAI).

## Onboarding em 6 passos

1. Fechar plano, conexão (WhatsApp Web ou API oficial), prazo do contrato e escopo das integrações.
2. Coletar informações do negócio e escrever as instruções (base: `prompts/exemplo-advocacia.md`).
3. Criar a instância: WhatsApp Web (QR code) ou API oficial (Meta Business verificado, WABA, cartão do cliente; webhook com `messages` e `smb_message_echoes`).
4. Configurar a OpenAI: um project key por instância, com limite de gasto.
5. Testar com o roteiro (áudio, foto, PDF, pedido de pessoa, pausa e retomada).
6. Treinar a equipe, entrar no ar e acompanhar os primeiros dias.

## Links rápidos

- Painel: `/`
- API: `https://evolution-api-x93o.onrender.com`
- Webhook Meta: `https://evolution-api-x93o.onrender.com/webhook/meta`
- OpenAI billing: `https://platform.openai.com/settings/organization/billing/overview`
- Meta billing: `https://business.facebook.com/billing_hub/payment_settings`

## Regras de ouro

- **Meta:** uma WABA por cliente; cartão sempre do cliente; sem repasse.
- **OpenAI:** uma key por instância; nunca uma key para todos.
- **ChatGPT Plus não serve**; o bot usa API key.
- **Cloud API** não elimina bloqueio por política; a Meta pode limitar por qualidade.
- Não prometer parecer jurídico, resultado, 100% de acerto ou "a IA nunca erra preço".

> Valores de 02/11/2026. Confirme o rate card da Meta e o preço da OpenAI antes de fechar.
