## Preços (implantação + mensalidade)

| | Essencial | Profissional | Premium (API oficial) |
|---|---:|---:|---:|
| Mensalidade | R$ 437 | R$ 767 | R$ 1.427 |
| Implantação, cobrada uma vez | R$ 1.800 | R$ 3.500 | a partir de R$ 6.400 |
| Respostas da IA por mês | 2.000 | 5.000 | 10.000 |
| Números incluídos | 1 | 1 | 1 |
| Número adicional (mesmos recursos e franquia) | R$ 287/mês + R$ 590 | R$ 497/mês + R$ 1.080 | R$ 927/mês + a partir de R$ 1.800 + Meta |
| Ajustes nas instruções por mês | 2 | 4 | 8 |
| Áudio, foto e PDF | Sim | Sim | Sim |

- **Excedente:** R$ 49 por bloco de 1.000 respostas. **Piloto assistido de 14 dias:** R$ 690, abatido da implantação.
- **Sem fidelidade:** mês a mês, cancelamento com 30 dias de aviso e sem multa. Anual antecipado: 10% de desconto.
- **Número adicional = outra instância** (IA, banco Neon e espaço no Render próprios), com os recursos e a franquia do plano: ~65% da mensalidade.
- Detalhes para o cliente no **Guia comercial**. Custos, margens e roteiro de vendas ficam no Guia de Vendas interno, fora deste manual.

## O que é automático e o que é serviço

- **Automático:** respostas 24 h, triagem de Leads, Agenda com lembretes e Processos (quando ligados), memória (2 a 100 mensagens), áudio, foto e PDF, junção de mensagens seguidas, pausa quando a equipe responde (WhatsApp Web; na API oficial só com Coexistence e o campo `smb_message_echoes` assinado), retomada após o tempo combinado.
- **Serviço da nossa equipe:** instruções, integrações (n8n ou webhook, sob medida), relatório mensal, monitoramento (Observabilidade, inclusive a chave OpenAI de cada cliente), pausa manual a pedido do cliente (o cliente não acessa o painel).
- **Não existe hoje:** aviso automático para a equipe quando o cliente pede uma pessoa; relatório automático; marcação no banco de quais mensagens foram da IA.
- **Tempo de resposta real:** ~20 a 40 s (espera para juntar mensagens + OpenAI).

## Onboarding em 7 passos

1. Fechar plano, conexão (WhatsApp Web ou API oficial), quantos números e escopo das integrações.
2. Coletar informações do negócio e escrever as instruções (base: `prompts/exemplo-advocacia.md`).
3. Criar a instância com **Banco próprio** (padrão; Compartilhado só para testes ou sem cota): WhatsApp Web (QR code) ou API oficial (Meta Business verificado, WABA, cartão do cliente; webhook com `messages` e `smb_message_echoes`). Atalho para WhatsApp Web: `scripts/novo-cliente.sh`.
4. Configurar a OpenAI: um project key por instância, com limite de gasto. **Testar a chave** (cartão OpenAI da Observabilidade ou `POST /openai-health/<instância>/test`): válida, modelo liberado e com crédito.
5. Configurar **Plano e limites** (franquia, horário de atendimento, mensagens) e, conforme o plano, Leads, Agenda e Processos.
6. Testar com o roteiro (áudio, foto, PDF, pedido de pessoa, pausa e retomada).
7. Treinar a equipe, entrar no ar e acompanhar os primeiros dias.

## Links rápidos

- Site: `/` · Painel: `/manager` · Manual: no GitHub (`README-WHATSAI.md`) e no MCP (`whatsai://docs`); `/readme` redireciona para `/manager`
- API: URL do serviço web, configurada no painel do Render
- Webhook Meta: `<URL da API>/webhook/meta`
- OpenAI billing: `https://platform.openai.com/settings/organization/billing/overview`
- Meta billing: `https://business.facebook.com/billing_hub/payment_settings`

## Regras de ouro

- **Meta:** uma WABA por cliente; cartão sempre do cliente; sem repasse.
- **OpenAI:** uma key por instância; nunca uma key para todos.
- **ChatGPT Plus não serve**; o bot usa API key.
- **Cloud API** não elimina bloqueio por política; a Meta pode limitar por qualidade.
- Não prometer parecer jurídico, resultado, 100% de acerto ou "a IA nunca erra preço".

> Valores de 10/11/2026 (propostas anteriores mantêm seus preços durante a validade). Confirme o rate card da Meta e o preço da OpenAI antes de fechar.
