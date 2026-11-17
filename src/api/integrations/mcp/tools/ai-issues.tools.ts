import { AiReviewService } from '@api/services/ai-review.service';
import { ISSUE_INFO, SEVERITIES } from '@utils/ai-issues';
import { parseReviewPeriod, ReviewPeriodError } from '@utils/conversation-review';
import { z } from 'zod';

import { resolveInstance } from '../mcp.instance';
import { defineTool, instanceArg, READ_ONLY } from '../mcp.tool';
import { jsonResult, McpToolError } from '../mcp.util';

const day = (first: boolean) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD')
    .describe(`${first ? 'Primeiro' : 'Último'} dia do período (AAAA-MM-DD, horário de Brasília).`);

const FLAG_GUIDE = Object.entries(ISSUE_INFO)
  .map(([type, info]) => `${type} (${info.severity}): ${info.label}`)
  .join('; ');

export const findAiIssues = defineTool({
  name: 'find_ai_issues',
  title: 'Encontrar problemas da IA',
  description: `Procura sinais de problemas da IA nas conversas de um período (até 31 dias): cada conversa vem com uma referência mascarada (****1234), quantas mensagens cada um escreveu e os sinais com gravidade, hora, messageId e um trecho de até 120 caracteres (dados pessoais ocultados). São candidatos para revisão, não veredictos. Para ler a conversa inteira, chame get_messages com message_id de um sinal. Sinais: ${FLAG_GUIDE}. Somente leitura.`,
  input: {
    instance: instanceArg,
    from_date: day(true),
    to_date: day(false),
    cursor: z
      .string()
      .regex(/^\d{1,6}$/)
      .optional()
      .describe('Valor de nextCursor da página anterior.'),
    page_size: z.number().int().min(1).max(50).optional().describe('Conversas por página (1 a 50). Padrão: 20.'),
    min_severity: z.enum(SEVERITIES).optional().describe('Gravidade mínima: baixa, media ou alta. Padrão: baixa.'),
    unanswered_minutes: z
      .number()
      .int()
      .min(5)
      .max(1440)
      .optional()
      .describe('Minutos sem resposta para contar como "sem resposta" (5 a 1440). Padrão: 30.'),
  },
  annotations: READ_ONLY,
  run: async ({ instance, from_date, to_date, cursor, page_size, min_severity, unanswered_minutes }, ctx) => {
    let period;
    try {
      period = parseReviewPeriod(from_date, to_date);
    } catch (error) {
      if (error instanceof ReviewPeriodError) throw new McpToolError(error.message);
      throw error;
    }
    const resolved = await resolveInstance(ctx, instance);
    const result = await new AiReviewService(ctx.deps.prisma).findIssues(resolved.id, period, {
      offset: cursor ? Number(cursor) : 0,
      pageSize: page_size,
      minSeverity: min_severity,
      unansweredMinutes: unanswered_minutes,
    });

    return jsonResult({
      instance: resolved.name,
      period: { from: period.from, to: period.to, timeZone: 'America/Sao_Paulo' },
      ...result,
      note: 'Sinais automáticos: confira lendo a conversa (get_messages com message_id) antes de concluir. Nada foi alterado.',
    });
  },
});

export const aiIssueTools = [findAiIssues];
