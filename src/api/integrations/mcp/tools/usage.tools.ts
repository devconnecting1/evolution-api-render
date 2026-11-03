import { z } from 'zod';

import { resolveInstance } from '../mcp.instance';
import { defineTool, instanceArg, READ_ONLY } from '../mcp.tool';
import { jsonResult, McpToolError } from '../mcp.util';

export const getUsage = defineTool({
  name: 'get_usage',
  title: 'Uso do plano (respostas da IA)',
  description:
    'Mostra quantas respostas a IA deu no mês e hoje contra o plano da instância (franquia, percentual, excedente em blocos de 1.000), os últimos 30 dias, os contatos que mais receberam respostas hoje (números mascarados) e os limites configurados (horário de atendimento, limites diários, ação ao passar do limite).',
  input: { instance: instanceArg },
  annotations: READ_ONLY,
  run: async ({ instance }, ctx) => {
    const resolved = await resolveInstance(ctx, instance);
    const [stored, summary] = await Promise.all([
      ctx.deps.usage.getLimits(resolved.id),
      ctx.deps.usage.getSummary(resolved.id),
    ]);

    return jsonResult({
      instance: resolved.name,
      configured: stored !== null,
      note: stored
        ? undefined
        : 'Sem plano configurado: a IA responde sem limite (as respostas são contadas mesmo assim).',
      ...summary,
    });
  },
});

const cap = (description: string) =>
  z.number().int().min(1).max(10_000_000).nullable().optional().describe(`${description} null = sem limite.`);

const timeRange = z.tuple([
  z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'use HH:MM'),
  z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'use HH:MM'),
]);
const dayRanges = z.array(timeRange).max(4).optional();

export const updateLimits = defineTool({
  name: 'update_limits',
  title: 'Alterar plano e limites',
  description:
    'Altera o plano e os limites de respostas da IA de uma instância: plano (Essencial 2.000, Profissional 5.000, Premium 10.000 por mês, ou Personalizado), franquia mensal, limite diário e por contato por dia, ação ao passar da franquia (continue = responde e conta excedente; pause = para de responder; message = envia uma mensagem uma vez por dia por contato), alerta em %, horário de atendimento e mensagem fora do horário. Campos ausentes não mudam; null remove o limite. SUBSTITUI os valores atuais: confirme com o usuário. A resposta traz os valores anteriores para desfazer.',
  input: {
    instance: instanceArg,
    plan: z
      .enum(['Essencial', 'Profissional', 'Premium', 'Personalizado'])
      .nullable()
      .optional()
      .describe('Plano. Sem monthly_responses, um plano padrão usa a franquia dele.'),
    monthly_responses: cap('Respostas da IA incluídas por mês.'),
    daily_responses: cap('Máximo de respostas por dia.'),
    per_contact_daily_responses: cap('Máximo de respostas por contato por dia.'),
    over_limit_action: z.enum(['continue', 'pause', 'message']).optional().describe('O que fazer ao passar do limite.'),
    over_limit_message: z.string().max(1000).nullable().optional().describe('Mensagem da ação "message".'),
    alert_percent: z.number().int().min(1).max(100).optional().describe('Alerta na Observabilidade a partir deste %.'),
    business_hours: z
      .object({
        enabled: z.boolean().optional(),
        mode: z.enum(['always', 'inside', 'outside']).optional(),
        timezone: z.string().min(1).max(64).optional(),
        week: z
          .object({
            sun: dayRanges,
            mon: dayRanges,
            tue: dayRanges,
            wed: dayRanges,
            thu: dayRanges,
            fri: dayRanges,
            sat: dayRanges,
          })
          .optional(),
      })
      .optional()
      .describe(
        'Horário de atendimento. mode: always (IA sempre), inside (IA só dentro do horário), outside (IA só fora). week: {"mon":[["09:00","18:00"]], ...}; faixa com fim menor que o início passa da meia-noite.',
      ),
    outside_hours_message: z
      .string()
      .max(1000)
      .nullable()
      .optional()
      .describe('Mensagem fora do horário (modo inside).'),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  run: async (args, ctx) => {
    const fields: [string, string][] = [
      ['plan', 'planName'],
      ['monthly_responses', 'monthlyResponses'],
      ['daily_responses', 'dailyResponses'],
      ['per_contact_daily_responses', 'perContactDailyResponses'],
      ['over_limit_action', 'overLimitAction'],
      ['over_limit_message', 'overLimitMessage'],
      ['alert_percent', 'alertPercent'],
      ['business_hours', 'businessHours'],
      ['outside_hours_message', 'outsideHoursMessage'],
    ];
    const input: Record<string, any> = {};
    for (const [arg, field] of fields) {
      if ((args as any)[arg] !== undefined) input[field] = (args as any)[arg];
    }
    if (!Object.keys(input).length) throw new McpToolError('nenhum campo para alterar foi informado.');

    const resolved = await resolveInstance(ctx, args.instance);
    let result: { previous: any; limits: any };
    try {
      result = await ctx.deps.usage.saveLimits(resolved.id, input);
    } catch (error) {
      if (Array.isArray(error?.errors)) throw new McpToolError(error.errors.join(' '));
      throw error;
    }

    return jsonResult({
      updated: true,
      instance: resolved.name,
      previous: result.previous,
      limits: result.limits,
      note: result.previous ? undefined : 'A instância não tinha limites: antes, a IA respondia sem limite.',
    });
  },
});

export const usageTools = [getUsage, updateLimits];
