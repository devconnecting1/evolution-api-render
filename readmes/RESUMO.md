## Planos oficiais

| Plano | Setup | Base/mês | + OpenAI/mês |
|---|---:|---:|---:|
| Start | R$ 1.997 | R$ 447 | R$ 497 |
| Pro | R$ 2.997 | R$ 897 | R$ 997 |
| Premium | R$ 5.497 | R$ 1.597 | R$ 1.797 |

- **Meta:** sempre paga pelo cliente, direto na WABA; não entra na mensalidade.
- **OpenAI Base:** o cliente usa a própria conta/key e paga direto.
- **OpenAI add-on:** +R$ 50/100/200 (Start/Pro/Premium); a WhatsAI paga dentro do budget US$ 10/25/60; excedente à parte ou bot pausa.
- **Franquia:** 1.000 / 3.000 / 8.000 conversas/mês; excedente R$ 297/+1.000 (serviço).
- **Meta:** 1.000 mensagens de serviço grátis/número/mês; excedente ~R$ 0,037.

## Quem paga o quê

| Modelo | Cliente | WhatsAI |
|---|---|---|
| Oficial Base | mensalidade + Meta + OpenAI | infraestrutura |
| Oficial + OpenAI | mensalidade + Meta | OpenAI + infraestrutura |

## Onboarding em 6 passos

1. Fechar plano e modalidade da OpenAI (Base ou add-on).
2. Meta Business verificado, WABA, número dedicado e **cartão do cliente**.
3. Criar a instância oficial no painel (Cloud API).
4. Configurar OpenAI: chave do cliente (Base) ou project/key + budget (add-on).
5. Subir prompt, testar fluxo, handoff e templates.
6. Treinar, entregar e acompanhar uso/custos.

## Links rápidos

- Painel: `/`
- API: `https://evolution-api-x93o.onrender.com`
- Webhook Meta: `https://evolution-api-x93o.onrender.com/webhook/meta`
- OpenAI billing: `https://platform.openai.com/settings/organization/billing/overview`
- Meta billing: `https://business.facebook.com/billing_hub/payment_settings`

## Regras de ouro

- **Meta:** uma WABA por cliente; cartão sempre do cliente; sem repasse.
- **OpenAI:** uma conta pode ser compartilhada, mas **uma key por instância**; nunca uma key para todos.
- **ChatGPT Plus não serve**; o bot usa API key.
- **Cloud API** não elimina bloqueio por política; a Meta pode limitar por qualidade.
- Não prometer parecer jurídico, resultado ou 100% de acerto.

> Valores de referência (out/2026). Confirme o rate card da Meta e o preço da OpenAI antes de fechar.
