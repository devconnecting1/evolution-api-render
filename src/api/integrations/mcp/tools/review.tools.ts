import { ReviewExportService } from '@api/services/review-export.service';
import { conversationMarkdown, parseReviewPeriod, ReviewPeriodError } from '@utils/conversation-review';
import { z } from 'zod';

import { resolveInstance } from '../mcp.instance';
import { defineTool, instanceArg, READ_ONLY } from '../mcp.tool';
import { McpToolError, ToolResult } from '../mcp.util';

const DEFAULT_PAGE_CHARS = 40_000;

const day = (field: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${field}: use AAAA-MM-DD`)
    .describe(`${field === 'from_date' ? 'Primeiro' : 'Último'} dia do período (AAAA-MM-DD, horário de Brasília).`);

/** One page of conversations, whole conversations only (the first one is cut when it alone passes the budget). */
export function reviewPage(markdowns: string[], start: number, budget: number) {
  const parts: string[] = [];
  let used = 0;
  let next = start;
  while (next < markdowns.length) {
    const text = markdowns[next];
    if (parts.length && used + text.length > budget) break;
    if (!parts.length && text.length > budget) {
      const lines = text.split('\n');
      let kept = '';
      let count = 0;
      for (const line of lines) {
        if (kept.length + line.length + 1 > budget) break;
        kept += `${line}\n`;
        count++;
      }
      parts.push(`${kept}[conversa cortada aqui: mais ${lines.length - count} linhas não cabem na página]\n`);
      next++;
      break;
    }
    parts.push(text);
    used += text.length;
    next++;
  }
  return { text: parts.join('\n'), next };
}

export const exportConversationsForReview = defineTool({
  name: 'export_conversations_for_review',
  title: 'Conversas para revisão da IA',
  description:
    'Lê as conversas de um período (até 31 dias) como texto compacto para revisar a IA: uma linha por mensagem com a hora e quem escreveu (Cliente, IA, Equipe (painel), Equipe (celular), API ou Número (não identificado)). Os contatos aparecem como ****1234; nomes não saem e e-mails, CPF, CNPJ e sequências longas de números são ocultados. Paginado por conversa: passe o cursor devolvido para ler a próxima página. Somente leitura.',
  input: {
    instance: instanceArg,
    from_date: day('from_date'),
    to_date: day('to_date'),
    cursor: z
      .string()
      .regex(/^\d{1,6}$/)
      .optional()
      .describe('Valor de next_cursor da página anterior.'),
    max_chars: z
      .number()
      .int()
      .min(2_000)
      .max(80_000)
      .optional()
      .describe(`Tamanho máximo da página em caracteres (2000 a 80000). Padrão: ${DEFAULT_PAGE_CHARS}.`),
  },
  annotations: READ_ONLY,
  run: async ({ instance, from_date, to_date, cursor, max_chars = DEFAULT_PAGE_CHARS }, ctx): Promise<ToolResult> => {
    let period;
    try {
      period = parseReviewPeriod(from_date, to_date);
    } catch (error) {
      if (error instanceof ReviewPeriodError) throw new McpToolError(error.message);
      throw error;
    }
    const resolved = await resolveInstance(ctx, instance);
    const collection = await new ReviewExportService(ctx.deps.prisma).collect(resolved.id, period);
    const total = collection.conversations.length;
    const start = cursor ? Number(cursor) : 0;
    if (start > total) throw new McpToolError('cursor inválido para este período.');

    const markdowns = collection.conversations.map(conversationMarkdown);
    const page = reviewPage(markdowns, start, max_chars);
    const header = [
      `Instância ${resolved.name} · ${period.from} a ${period.to} (Brasília) · ${total} conversas, ${collection.messages} mensagens`,
      total ? `Conversas ${start + 1} a ${page.next} de ${total}` : 'Nenhuma conversa no período.',
      collection.partial ? 'Atenção: leitura parcial (limite de mensagens). Use um período menor.' : '',
    ].filter(Boolean);
    const footer =
      page.next < total ? `next_cursor: ${page.next}` : total ? 'Fim: não há mais conversas neste período.' : '';

    return {
      content: [{ type: 'text', text: [...header, '', page.text, footer].filter((part) => part !== '').join('\n') }],
    };
  },
});

export const reviewTools = [exportConversationsForReview];
