# Guia comercial — WhatsAI

Material para explicar o serviço ao cliente: o que é, como implantar, planos, mensalidade, custos de IA e respostas para as objeções mais comuns.

## 1. O que é o serviço (pitch de 30 segundos)

Um atendente de IA no WhatsApp do próprio cliente, treinado com as informações do negócio. Ele responde 24/7, tira dúvidas, qualifica o contato, coleta os dados principais, agenda/encaminha e passa para um humano quando necessário.

- Não é disparo em massa: é atendimento de quem chega.
- Usa o número do cliente (chip dedicado), não um número da WhatsAI.
- Cada cliente tem agente isolado (instância + prompt + credenciais próprias).
- Funciona com texto e áudio (transcrição automática).
- Conexão **Cloud API oficial da Meta**, com custo por mensagem pago pelo cliente à Meta.

## 2. Como funciona a implantação

| Etapa | O que acontece | Prazo | Responsável |
|---|---|---|---|
| 1. Briefing | Entender serviços, tom de voz, horários, perguntas frequentes e regras de handoff | 1 dia | Cliente + WhatsAI |
| 2. Configuração | Escrever o prompt, criar a instância e o agente, ajustar limites | 1–2 dias | WhatsAI |
| 3. Conexão | WhatsAI conecta via token da Meta | 1–2 dias | Cliente + WhatsAI |
| 4. Testes | Simular conversas reais, corrigir respostas e validar handoff | 1–2 dias | WhatsAI + Cliente |
| 5. Go-live | Liberar o número, treinar a equipe e acompanhar a primeira semana | 1 dia | WhatsAI |

Prazo total: **5–10 dias úteis (Start)**, **7–12 (Pro)**, **9–15 (Premium)**, incluindo a verificação da Meta.

O cliente precisa entregar: número dedicado (chip), informações do negócio, chave OpenAI (Base) ou contratar o add-on e, se houver integração, acesso à agenda/CRM.

**API oficial (Cloud API):** além do número dedicado, o cliente precisa de Meta Business verificado (CNPJ), WABA, Phone Number ID, token permanente e cartão na Meta. A verificação pode levar alguns dias; por isso o prazo e o setup são maiores.

## 3. Planos e preços — Advocacia (API oficial)

Conexão oficial da Meta (Cloud API), via token. Exige Meta Business verificado, WABA, número dedicado, Phone Number ID, token permanente, webhook e cartão **do cliente**. **A Meta é sempre paga pelo cliente**, direto na WABA; não entra na mensalidade. A OpenAI pode ser do cliente (Base) ou add-on pago pela WhatsAI.

Premissas: 1.000 mensagens de serviço grátis/número/mês; excedente ~US$ 0,0068 (~R$ 0,037) no Brasil (out/2026); ~5 respostas por conversa; OpenAI ~R$ 0,03/conversa (estimativa conservadora).

| Plano | Setup | Mensalidade | Para quem | Inclui |
|---|---|---|---|---|
| **Start Oficial** | R$ 1.997 | R$ 447 | Escritório pequeno, 1 número | FAQ, qualificação básica e handoff; 1.000 conversas/mês de escopo; Meta: cliente paga direto; OpenAI do cliente; 1 h/mês; SLA 24 h úteis |
| **Pro Oficial** | R$ 2.997 | R$ 897 | Escritório com volume e agenda | Start + triagem estruturada, documentos por link, agendamento/lembrete, 1 integração; 3.000 conversas/mês; Meta: cliente paga direto; OpenAI do cliente; 2 h/mês; relatório; SLA 8 h úteis |
| **Premium Oficial** | R$ 5.497 | R$ 1.597 | Escritório com CRM/base própria | Pro + RAG/base de conhecimento, CRM/ERP via n8n, até 3 números; 8.000 conversas/mês; Meta: cliente paga direto; OpenAI do cliente; 4 h/mês; reunião mensal; SLA 4 h úteis |

- **Add-on OpenAI incluída:** +R$ 50 (Start), +R$ 100 (Pro) e +R$ 200 (Premium) no mensal; a WhatsAI paga a OpenAI dentro de um budget de proteção (US$ 10/25/60). O add-on cobre o uso típico; o excedente acima do budget é cobrado à parte ou o bot pausa.

| Plano | Base (OpenAI sua) | + OpenAI incluída |
|---|---|---|
| Start Oficial | R$ 447 | R$ 497 |
| Pro Oficial | R$ 897 | R$ 997 |
| Premium Oficial | R$ 1.597 | R$ 1.797 |

- **Excedente de escopo:** R$ 297 por +1.000 conversas (serviço). A Meta cobra o uso diretamente de você; não há repasse.
- **Áudio:** transcrição incluída até 300 min/mês; excedente ~US$ 0,006/min.
- **Templates fora da janela de 24 h:** pagos por você direto à Meta; 2 templates inclusos no setup, extra R$ 300 (serviço).
- **Setup:** cobre verificação, conexão oficial, templates e suporte; a Meta é paga por você direto.

**Plano padrão de venda:** Pro. Ofereça Start para ticket baixo e Premium para quem tem volume/CRM.

### 3.1 Quem paga o quê

| Modelo | Você paga | WhatsAI paga |
|---|---|---|
| **Oficial Base** | mensalidade + Meta + OpenAI | infraestrutura |
| **Oficial + OpenAI** | mensalidade + Meta | OpenAI + infraestrutura |

A Meta é **sempre paga por você**, direto na WABA, em qualquer modelo oficial. A OpenAI é sua no Base e incluída no add-on. O chip/número é sempre seu (ou cobrado à parte). A franquia de conversas é de escopo/serviço; a Meta cobra o uso à parte.

## 4. Planos para outros segmentos (API oficial)

| Segmento | Start (setup/mês) | Pro (setup/mês) | Premium (setup/mês) |
|---|---|---|---|
| Clínicas e consultórios | 2.297 / 497 | 3.497 / 997 | 6.497 / 1.797 |
| Imobiliárias | 2.497 / 547 | 3.997 / 1.097 | 7.497 / 1.997 |
| E-commerce | 2.997 / 697 | 4.497 / 1.197 | 8.497 / 2.297 |
| Infoprodutos | 2.297 / 547 | 3.497 / 997 | 6.497 / 1.797 |
| Serviços locais | 1.797 / 397 | 2.497 / 697 | 4.497 / 1.297 |

Valores já incluem a API oficial. A Meta é paga por você; a OpenAI pode ser add-on de +R$ 50/100/200. Volumes maiores: cote à parte.

## 5. O que está incluído na mensalidade

- Instância dedicada no ar, com monitoramento e reconexão automática.
- Agente OpenAI configurado e mantido (prompt, limites, handoff).
- Ajustes dentro das horas do plano (1 h Start, 2 h Pro, 4 h Premium).
- Suporte no SLA do plano (24 h úteis Start, 8 h Pro, 4 h Premium).
- Backup do banco e retenção padrão de 90 dias.
- Relatório mensal (Pro e Premium) e reunião mensal (Premium).
- Atualizações de segurança da plataforma.
- **Oficial Base:** conexão oficial, suporte e escopo; Meta e OpenAI são pagos por você direto.
- **Oficial + OpenAI:** a WhatsAI paga a OpenAI dentro do budget; a Meta continua sendo paga por você.

**Não está incluso:** tokens da OpenAI (quando o cliente usa a própria chave), chip/número, anúncios, integrações fora do escopo, desenvolvimento sob medida e disparo em massa. **Meta:** sempre paga por você; **OpenAI:** salvo add-on; **excedente de conversas**, templates fora da janela de 24 h e o que estiver fora do escopo.

## 6. Custos de IA (OpenAI/ChatGPT)

O bot usa a **API da OpenAI**, que é cobrada por token. **ChatGPT Plus não serve** — é interface de chat, não API.

Referência do **GPT-6 Luna**: US$ 0,10/1M tokens de entrada e US$ 0,50/1M de saída (contexto 1,05M; saída máx. 128k; corte de conhecimento 18/05/2026). Se o modelo estiver liberado na conta OpenAI usada (sua no Base, WhatsAI no add-on), use `model: "gpt-6-luna"`.

Premissas: prompt de sistema ~600 tokens, resposta do bot ~140 tokens, ~170 tokens novos por troca; US$ 1 ≈ R$ 5,50. Cada pessoa = 1 conversa no mês (quem volta várias vezes divide o número).

| Conversa | Custo aprox. | Pessoas com R$ 5/mês | Pessoas com R$ 20/mês |
|---|---|---|---|
| 5 trocas | R$ 0,005 | ~1.000 | ~4.000 |
| 10 trocas | R$ 0,012 | ~400 | ~1.700 |
| 20 trocas | R$ 0,032 | ~150 | ~600 |

- Áudio transcrito: +~US$ 0,006/min (Whisper).
- `gpt-4o-mini` (US$ 0,15/1M entrada e US$ 0,60/1M saída) sai ~50% mais caro que o Luna.
- Duas formas: **Oficial Base** (chave do cliente; ele paga a OpenAI direto) ou **add-on OpenAI** (+R$ 50/100/200; a WhatsAI paga dentro do budget).
- Controle de custo: prompt enxuto, `maxTokens`, expiração de sessão e fair use.

**Em resumo:** centavos por conversa; o volume é que define a conta.

### 6.1 Custo da Meta (API oficial)

A API oficial não é gratuita: a Meta cobra por mensagem entregue.

| Item | Custo (Brasil, out/2026) |
|---|---|
| 1.000 mensagens de serviço/número/mês | R$ 0 (franquia) |
| Excedente de mensagem de serviço | ~US$ 0,0068 (~R$ 0,037) |
| Template de marketing | ~US$ 0,0625 (~R$ 0,34) |
| Template utility/authentication | ~US$ 0,0068 (~R$ 0,037) |

- 1.000 conversas ≈ 5.000 mensagens → 4.000 excedentes ≈ **R$ 148**.
- 3.000 conversas ≈ 15.000 mensagens → 14.000 excedentes ≈ **R$ 518**.
- 8.000 conversas ≈ 40.000 mensagens → 39.000 excedentes ≈ **R$ 1.443**.
- Respostas divididas em várias mensagens custam mais: configure o bot para responder em uma mensagem.
- Valores de referência; confirme o rate card da Meta para o país antes de fechar.
- A Meta é **sempre paga por você**, direto na WABA; a WhatsAI não inclui Meta em nenhum plano oficial.

### 6.2 Como o cliente paga OpenAI e Meta

**OpenAI (API, não ChatGPT Plus):**
1. Criar conta em https://platform.openai.com/.
2. Settings > Organization > Billing: cartão internacional + créditos (mínimo ~US$ 5) — https://platform.openai.com/settings/organization/billing/overview
3. Limits: orçamento mensal + alerta — https://platform.openai.com/settings/organization/limits
4. API keys: criar a project key "WhatsAI — [cliente]" — https://platform.openai.com/api-keys
5. Enviar a chave por canal seguro e acompanhar o uso em https://platform.openai.com/usage.

- No **Oficial Base**, a OpenAI é sempre sua: crie a conta/project/key e pague direto. No **add-on OpenAI**, a WhatsAI paga e você só acompanha o budget.

**Meta (Cloud API):**
1. Criar/verificar Meta Business (CNPJ) — https://business.facebook.com/
2. Criar app Business e adicionar WhatsApp — https://developers.facebook.com/apps/
3. WhatsApp Manager: WABA, número dedicado, verificação e nome de exibição — https://business.facebook.com/wa/manage/
4. Cartão em Business Settings > Payments (ou WhatsApp Manager > Billing) — https://business.facebook.com/billing_hub/payment_settings
5. System User com token permanente (`whatsapp_business_messaging`, `whatsapp_business_management`) — https://business.facebook.com/settings/system-users
6. Enviar Phone Number ID, WABA ID e token; webhook `https://evolution-api-x93o.onrender.com/webhook/meta`.
7. Acompanhar o billing no WhatsApp Manager.

- A Meta é sempre paga por você, em qualquer modelo oficial; estes passos são obrigatórios.

- Não há mensalidade da OpenAI nem da Meta; paga-se só pelo uso. Verificação da Meta é gratuita. Evite BSP (taxa extra por mensagem) — salvo se quiser fatura consolidada.
- Segurança: token/chave são credenciais; use gerenciador de senhas e restrinja o token ao WABA.

## 7. Add-ons

| Item | Preço |
|---|---|
| Integração extra (Chatwoot, n8n, Dify, Flowise, CRM) | R$ 897 setup + R$ 197/mês |
| +1.000 conversas/mês | R$ 297 |
| Instância/número extra (inclui 1.000 conversas de escopo) | R$ 497 setup + R$ 297/mês |
| Add-on OpenAI incluída | +R$ 50/100/200/mês (Start/Pro/Premium) |
| Template Meta (criação/submissão; custo da Meta à parte) | R$ 300 |
| Hora extra de ajuste | R$ 250 |
| Setup express (48 h) | +30% |
| Treinamento extra (1 sessão) | R$ 500 |
| Migração de histórico | R$ 500 |

## 8. Como explicar o preço (argumentos)

- Um atendente custa R$ 2.000+/mês (com encargos), trabalha 8 h/dia e 5 dias/semana. O bot atende 24/7 por uma fração disso.
- Quem responde primeiro fecha mais: o bot responde em segundos, inclusive fora do horário.
- O setup paga a implantação (prompt, testes, conexão, treinamento). A mensalidade paga operação e evolução.
- Ancore a comparação em **um atendente**, não em "um chatbot".
- Não venda hora; venda resultado: lead qualificado, agenda cheia, menos tempo perdido.
- Primeiros cases: desconto no setup (até 50%), nunca grátis; troque por depoimento e estudo de caso.

## 9. Perguntas frequentes e objeções

**"Isso vai substituir meu atendente?"**
Não. O bot faz a primeira linha e a triagem; o humano foca em fechar e nos casos complexos.

**"E se o WhatsApp bloquear o número?"**
A API oficial não bloqueia por conexão, mas a Meta pode limitar por política/qualidade e cobra por mensagem. O risco é menor que o de conexões não oficiais, mas não é zero.

**"Posso usar meu ChatGPT Plus?"**
Não. O bot precisa de uma API key com cobrança por uso. Plus é assinatura da interface.

**"Quanto vou gastar de IA?"**
No Oficial Base, você paga a OpenAI direto (centavos por conversa; seção 6). No add-on OpenAI, está na mensalidade. A Meta é sempre paga por você, à parte.

**"A API oficial da Meta é gratuita?"**
Não. Cada número tem 1.000 mensagens de serviço grátis/mês; acima disso, ~R$ 0,037 por mensagem, cobrado de você direto pela Meta. A franquia do plano é de escopo/serviço, não de custo Meta.

**"Preciso de CNPJ para a API oficial?"**
A Meta exige Meta Business verificado; na prática, CNPJ e documentos da empresa. A WhatsAI configura, mas a verificação é da Meta.

**"Posso usar meu número atual?"**
No oficial, o número precisa ser dedicado e não pode estar ativo no WhatsApp comum; a migração é feita no Meta Business.

**"Posso pagar OpenAI e Meta direto?"**
A Meta é sempre paga por você. A OpenAI pode ser sua (Oficial Base) ou add-on pago pela WhatsAI. O passo a passo está na seção 6.2.

**"No Oficial, eu pago tudo?"**
No Oficial Base, você paga mensalidade + Meta + OpenAI. No Oficial + OpenAI, paga mensalidade + Meta; a OpenAI é incluída no budget. Em ambos, excedente de conversas e templates fora da janela são à parte.

**"Em quanto tempo fica pronto?"**
7–15 dias úteis (oficial, conforme verificação da Meta), após briefing e chave.

**"Preciso trocar de número?"**
O ideal é um chip dedicado. Pode ser o número atual, mas separar reduz risco e facilita a operação.

**"E a LGPD?"**
Contrato de operador de dados, retenção padrão de 90 dias, acesso restrito e orientação para não pedir documentos sensíveis pelo chat.

**"E se eu quiser cancelar?"**
Fidelidade de 6 meses, aviso de 30 dias e multa de 30% do saldo. Depois disso, os contatos são exportáveis.

**"Vocês garantem que o bot acerta tudo?"**
Não. Nenhum bot acerta 100%; por isso existem handoff, testes e ajustes. Não prometa parecer jurídico nem resultado.

## 10. Política comercial

- Pagamento: 50% na assinatura + 50% na entrega; mensalidade todo dia 5.
- Fidelidade 6 meses; reajuste anual pelo IPCA; cancelamento com 30 dias de aviso + multa de 30% do saldo.
- Fair use: "conversa" = contato com inatividade > 24 h; mensagens ilimitadas dentro da franquia de conversas. Nos Oficiais, o excedente de conversas é cobrado como serviço; a Meta cobra o uso à parte.
- **Oficial Base:** Meta e OpenAI pagos por você; add-on OpenAI +R$ 50/100/200; excedente de escopo R$ 297/+1.000; templates fora da janela pagos à Meta. A Meta pode reajustar o que cobra de você diretamente.
- Descontos: até 15% no plano anual; setup nunca gratuito (máx. 50% para os 2–3 primeiros cases).

## 11. Checklist antes de fechar

- [ ] Plano definido e escopo por escrito
- [ ] Número dedicado reservado
- [ ] Chave OpenAI do cliente ou add-on definido
- [ ] (Oficial) Meta Business verificado e cartão do cliente cadastrado
- [ ] (Oficial) WABA, Phone Number ID, token permanente e webhook
- [ ] (Oficial) Templates aprovados (se houver envio fora da janela de 24 h)
- [ ] (Base) Cliente criou conta OpenAI e enviou a project key
- [ ] (Add-on) Project OpenAI com budget e cartão da WhatsAI configurados
- [ ] Briefing respondido (serviços, horários, tom, handoff)
- [ ] Contrato + LGPD assinados
- [ ] Setup pago (50%) e data de go-live
- [ ] Expectativas alinhadas (limites, políticas da Meta, fair use)
- [ ] Treinamento agendado

## 12. O que não prometer

- Parecer jurídico ou resultado garantido.
- 100% de acerto ou disponibilidade de datacenter (o SLA é comercial).
- API oficial da Meta sem custo: a Meta cobra de você por mensagem (1.000 grátis/número/mês); não entra na mensalidade.
- Que a API oficial elimina qualquer bloqueio: a Meta ainda pode restringir por política/qualidade.
- Disparo em massa (fora do escopo e risco de bloqueio).
- Integrações que não estão no contrato.
