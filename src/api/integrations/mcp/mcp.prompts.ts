import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

export function resumoDoDiaText(instance: string, date: string): string {
  return [
    `Faça o resumo das conversas de WhatsApp da instância "${instance}" no dia ${date} (horário de Brasília).`,
    '',
    'Passos:',
    `1. Chame list_chats com instance="${instance}" (limit 50) e considere só as conversas com updatedAt nesse dia.`,
    '2. Para cada conversa relevante, chame get_messages (page 1, page_size 30) e leia as mensagens do dia.',
    '3. Chame list_paused_contacts para saber onde a equipe assumiu o atendimento.',
    '',
    'Entregue em português, curto e objetivo:',
    '- quantas conversas houve e quantas ainda esperam resposta (última mensagem do contato);',
    '- os assuntos principais e pedidos que exigem ação da equipe (com nome/número do contato);',
    '- onde a IA respondeu mal, inventou informação ou deveria ter passado para uma pessoa;',
    '- contatos com o bot pausado.',
    '',
    'Não envie nenhuma mensagem e não altere nada: é só leitura.',
  ].join('\n');
}

export function revisarAtendimentoText(instance: string, contact: string): string {
  return [
    `Revise o atendimento do contato ${contact} na instância "${instance}".`,
    '',
    'Passos:',
    `1. Chame get_messages com instance="${instance}" e contact="${contact}" (page 1, page_size 50; leia a página 2 se precisar de mais contexto).`,
    '2. Chame get_bot_config para conhecer o prompt e as regras do bot.',
    '3. Chame list_paused_contacts com o contato para ver se o bot está pausado.',
    '',
    'Entregue em português:',
    '- um resumo do que o cliente quer e do que já foi respondido;',
    '- erros ou riscos nas respostas (informação inventada, tom, promessas, dados sensíveis);',
    '- uma sugestão de próxima resposta, pronta para copiar.',
    '',
    'NÃO envie a resposta: só sugira. Enviar exige pedido explícito do usuário (send_text_message).',
  ].join('\n');
}

export function registerPrompts(server: McpServer): void {
  // registerPrompt's generics are too deep for the type checker (TS2589); the arguments are validated by zod
  const register = server.registerPrompt.bind(server) as (...args: any[]) => unknown;

  register(
    'resumo_do_dia',
    {
      title: 'Resumo do dia',
      description: 'Resume as conversas de uma instância num dia (só leitura).',
      argsSchema: {
        instance: z.string().min(1).describe('Nome da instância.'),
        date: z.string().optional().describe('Dia no formato AAAA-MM-DD. Padrão: hoje.'),
      },
    },
    ({ instance, date }: { instance: string; date?: string }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: resumoDoDiaText(instance, date || today()) } }],
    }),
  );

  register(
    'revisar_atendimento',
    {
      title: 'Revisar atendimento',
      description: 'Revisa a conversa de um contato e sugere uma resposta, sem enviar.',
      argsSchema: {
        instance: z.string().min(1).describe('Nome da instância.'),
        contact: z.string().min(3).describe('Número com DDI e DDD ou JID do contato.'),
      },
    },
    ({ instance, contact }: { instance: string; contact: string }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: revisarAtendimentoText(instance, contact) } }],
    }),
  );
}
