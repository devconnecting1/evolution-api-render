# Guia comercial — WhatsAI

Recomendação: cobrar uma **implementação de R$ 1.500 a 3.000** e uma **mensalidade de R$ 297 a 797**, conforme o porte do cliente. A conta usa o custo real do projeto mais o mercado brasileiro em 2026; com essa faixa a margem fica entre 85% e 90%.

### Quanto cada cliente custa

| Item | Custo estimado por cliente/mês |
|---|---|
| Servidor + banco (Render Standard + Neon Launch divididos por ~20 clientes) | ~R$ 10–20 |
| OpenAI com **gpt-4o-mini** (~1.000 respostas/mês) | ~R$ 3–5 |
| OpenAI com **gpt-4o** (~1.000 respostas/mês) | ~R$ 40–50 |
| WhatsApp **Baileys** | R$ 0 |
| WhatsApp **Cloud API**: respostas dentro de 24 h | gratuitas (há fontes dizendo que isso pode mudar a partir de out/2026) |
| WhatsApp **Cloud API**: mensagens de marketing | ~R$ 0,32 por mensagem |
| Tempo de suporte (1–3 h/mês) | é o maior custo real |

Considerado: ~2.000 tokens de entrada e 200 de saída por resposta, com prompt e histórico. Com o **gpt-4o-mini**, o custo de IA fica quase zero; use o gpt-4o só para quem precisa de mais qualidade.

### Preço sugerido

**Implementação (cobrança única)**

| Pacote | O que inclui | Preço |
|---|---|---|
| Essencial | 1 número, prompt personalizado, base de perguntas frequentes, pausa humana, testes, treinamento de 1 h | **R$ 1.500 – 2.500** |
| Profissional | Essencial + integrações (agenda, planilha, CRM, n8n), transcrição de áudio, imagens | **R$ 3.000 – 6.000** |
| Oficial / Enterprise | Cloud API com verificação Meta, Coexistence, templates, fluxos sob medida | **R$ 6.000+** |

**Mensalidade**

| Plano | Franquia | Preço |
|---|---|---|
| Essencial | até ~1.000 respostas da IA/mês, 1 número, 1 ajuste de prompt/mês | **R$ 297 – 397** |
| Profissional | até ~3.000 respostas, relatório mensal, ajustes ilimitados, suporte em horário comercial | **R$ 597 – 797** |
| Premium | volume alto, integrações, SLA, Cloud API oficial | **R$ 1.200+** |
| Excedente | resposta acima da franquia | R$ 0,10 – 0,20 cada |

**Como estruturar a cobrança**
- **Contrato mínimo de 6 meses.** Com contrato de 12 meses, dê 30 a 50% de desconto na implementação, porque isso aumenta muito o fechamento.
- **Chave OpenAI:** use a sua chave, embutida no preço, ou peça a do cliente, cobrando menos e repassando o custo. Para clientes pequenos, embutir é mais simples. Para volume alto, use a chave do cliente.
- **Margem:** no plano Essencial a R$ 397, o custo direto fica entre R$ 20 e 60, o que dá **85–90% de margem** antes do seu tempo.

### Cuidados que entram no preço e no contrato
1. **Baileys não é oficial.** O WhatsApp pode banir o número, principalmente se o cliente fizer disparos em massa. Coloque isso no contrato e ofereça a Cloud API como opção "segura", mais cara.
2. **Regras da Meta para IA em 2026 estão mudando.** Há notícias de restrição a "assistentes de IA de uso geral" e de cobrança por mensagens a chatbots de IA, inclusive no Brasil, com disputa judicial. Bots de atendimento da própria empresa costumam ser permitidos, mas acompanhe e deixe uma cláusula de reajuste caso a Meta passe a cobrar.
3. **LGPD:** inclua um termo de tratamento de dados, avise o contato de que ele fala com uma IA e não guarde mais do que precisa.
4. **Escritórios de advocacia:** o Provimento 205/2021 da OAB limita a publicidade. A IA não deve prometer resultado nem captar clientes ativamente, só fazer triagem e agendamento.

**Exemplo (escritório de advocacia):** implementação de R$ 2.000 (ou R$ 1.000 com contrato de 12 meses), mensalidade de R$ 497 no Profissional com gpt-4o-mini e franquia de 2.000 respostas.

Os preços de mercado vêm de fontes de terceiros e mudam rápido. Confirme os valores atuais da OpenAI e da Meta antes de fechar contrato.

**Fontes**
- [Digisac — quanto custa um chatbot para WhatsApp](https://digisac.com.br/blog/quanto-custa-um-chatbot-para-whatsapp-e-como-calcular-o-retorno)
- [Eesel — Chatbot de IA para WhatsApp em 2026: custos e regras da Meta](https://www.eesel.ai/es/blog/whatsapp-ai-chatbot)
- [Olhar Digital — Meta vai cobrar por mensagens enviadas para IAs no WhatsApp](https://olhardigital.com.br/2026/03/09/pro/meta-vai-cobrar-por-mensagens-enviadas-para-ias-no-whatsapp-entenda/)
- [Tecnoblog — Meta vai cobrar chatbots de IA por uso do WhatsApp](https://tecnoblog.net/noticias/meta-vai-cobrar-chatbots-de-ia-por-uso-do-whatsapp/)
- [Tecnoblog — WhatsApp proíbe presença do ChatGPT e outras IAs](https://tecnoblog.net/noticias/whatsapp-proibe-presenca-do-chatgpt-e-outras-ias/)
- [TI Inside — custos para conversas no WhatsApp Business](https://tiinside.com.br/13/07/2026/custos-para-conversas-no-whatsapp-business-podem-chegar-a-us-500/)
- [SendPulse — WhatsApp muda regras de cobrança (out/2026)](https://sendpulse.com/br/blog/whatsapp-muda-regras-de-cobranca-para-empresas-outubro-2026)
- [Meta — Pricing on the WhatsApp Business Platform](https://developers.facebook.com/docs/whatsapp/pricing)
- [ChatMaxima — WhatsApp API pricing Brazil (jul/2026)](https://chatmaxima.com/whatsapp-api-pricing/brazil/)
- [AgentDeals — WhatsApp API pricing 2026](https://agentdeals.dev/whatsapp-business-api-pricing-2026)
- [Kommo — updated pricing rules for WhatsApp Business](https://support.kommo.com/docs/updated-pricing-rules-for-whatsapp-business.md)
- [MorphLLM — OpenAI API pricing 2026](https://morphllm.com/openai-api-pricing)
- [AnotherWrapper — GPT-4o mini pricing](https://anotherwrapper.com/tools/llm-pricing/gpt-4o-mini-2024-07-18)
- [Curlscape — OpenAI API pricing guide 2026](https://curlscape.com/blog/openai-api-pricing-guide-2026)
