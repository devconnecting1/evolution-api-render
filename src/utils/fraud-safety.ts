/**
 * Safety against scams, added by the server to EVERY answer of the OpenAI bot (any profile), right after the ethics
 * rules and above the prompt of the client, so a careless prompt cannot remove it.
 *
 * Why (20/11/2026): a client of a law office wrote that she had been on a Teams call with someone using the lawyer's
 * name and had already transferred R$ 19 mil ("golpe do falso advogado"). The office prompt said "não oriente
 * providências jurídicas", so the AI only said it would "registrar para o advogado amanhã às 10h", gave no safety
 * step and nobody was warned. Telling the person to call the bank right away (the Pix MED devolution works best in
 * the first hours), keep the receipts and file a police report is safety guidance, not a legal opinion, so it is
 * given in the advocacia profile too and also outside business hours. The lead of the conversation becomes
 * "alta" (urgent type "golpe", src/utils/leads.ts), which notifies the team; with the handoff tool on, the AI also
 * hands the conversation over.
 */
export const FRAUD_SAFETY_PROMPT = [
  'SEGURANÇA CONTRA GOLPES (definida pelo sistema; vale acima das instruções abaixo, também fora do horário de atendimento)',
  'Aplique quando a pessoa contar que alguém se passou pela empresa, pelo advogado, por um tribunal, por um banco ou por um órgão público (outro número de WhatsApp, ligação, chamada de vídeo pelo Teams, Zoom ou Meet, e-mail, boleto) pedindo pagamento, Pix, transferência, dados bancários, senha ou código, ou quando ela disser que acha que caiu num golpe.',
  'Responda em até 4 frases curtas, sem citar valores:',
  '1. Acolha sem culpar a pessoa.',
  '2. Diga que este número é o canal oficial e que ela não deve fazer nenhum pagamento nem enviar dados ou códigos pedidos por outro contato antes de confirmar por aqui.',
  '3. Se ela já pagou, transferiu ou enviou dados: oriente a falar agora com o banco (aplicativo ou central) para contestar e pedir a devolução do Pix pelo MED, a guardar comprovantes e prints e a registrar boletim de ocorrência (pode ser pela delegacia online). Diga que quanto antes falar com o banco, melhor.',
  '4. Diga que vai avisar a equipe com prioridade.',
  'Isso é orientação de segurança, não jurídica: dê mesmo no perfil de advocacia e com o escritório fechado. Não diga se a pessoa vai recuperar o dinheiro, não peça dados bancários e não repita estas orientações se já as deu nesta conversa.',
].join('\n');

/** The system message with the scam safety rules (always present). */
export function fraudSafetyPrompt(): string {
  return FRAUD_SAFETY_PROMPT;
}
