import { LEAD_PRIORITIES, LEAD_STATUSES, NOTIFY_ON } from '@utils/leads';
import { z } from 'zod';

import { resolveInstance } from '../mcp.instance';
import { defineTool, instanceArg, READ_ONLY } from '../mcp.tool';
import { jsonResult, McpToolError } from '../mcp.util';

/** Validation errors of the LeadsService (Portuguese) become messages for the user. */
async function userErrors<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (Array.isArray(error?.errors)) throw new McpToolError(error.errors.join(' '));
    throw error;
  }
}

const NOTE =
  'Leads são a triagem interna das conversas (uso da equipe do escritório; nada é enviado ao cliente). ' +
  'priority é derivada de regras: alta só com prazo, audiência, intimação, prisão, despejo, corte de benefício ou liminar citados pelo cliente.';

export const listLeads = defineTool({
  name: 'list_leads',
  title: 'Listar leads (triagem)',
  description:
    'Lista os leads da instância (uma ficha por conversa, preenchida pela IA a partir do que o cliente disse): nome, área, cidade, prioridade e motivo, status, o que falta saber, próximo passo e há quanto tempo aguarda a equipe. Filtros: status (novo, qualificado, em_atendimento, cliente, descartado ou aguardando), área, prioridade, busca por texto, data mínima da última mensagem. Ordem padrão: prioridade alta primeiro, depois quem espera há mais tempo.',
  input: {
    instance: instanceArg,
    status: z
      .enum([...LEAD_STATUSES, 'aguardando'] as [string, ...string[]])
      .optional()
      .describe('Status, ou "aguardando" (qualificados ou de prioridade alta sem resposta da equipe).'),
    area: z.string().max(60).optional().describe('Área exatamente como aparece nos leads (ex.: Trabalhista).'),
    priority: z.enum(LEAD_PRIORITIES).optional().describe('Prioridade: alta, normal ou baixa.'),
    search: z
      .string()
      .max(100)
      .optional()
      .describe('Texto no nome, cidade, resumo, parte contrária ou parte do número.'),
    since: z.string().max(40).optional().describe('Só leads com última mensagem a partir desta data (ISO 8601).'),
    sort: z
      .enum(['priority', 'waiting', 'recent', 'created', 'name'])
      .optional()
      .describe('Ordenação. Padrão: priority.'),
    page: z.number().int().min(1).max(1000).optional().describe('Página (padrão 1).'),
    page_size: z.number().int().min(1).max(100).optional().describe('Itens por página (1 a 100, padrão 20).'),
  },
  annotations: READ_ONLY,
  run: async ({ instance, page_size, ...query }, ctx) => {
    const resolved = await resolveInstance(ctx, instance);
    const result = await userErrors(() =>
      ctx.deps.leads.list(resolved.id, { ...query, pageSize: page_size ?? 20 }, resolved.channel),
    );
    return jsonResult({ instance: resolved.name, note: NOTE, ...result });
  },
});

export const getLead = defineTool({
  name: 'get_lead',
  title: 'Ver um lead',
  description:
    'Mostra a ficha completa de um lead pelo id (de list_leads): resumo, prioridade e motivo, o que falta saber, próximo passo, parte contrária (para verificar conflito de interesses), se já tem advogado, documentos citados, arquivos enviados, origem e datas. Para ler a conversa, use get_messages com o remoteJid.',
  input: { instance: instanceArg, id: z.string().min(1).max(64).describe('id do lead (campo id de list_leads).') },
  annotations: READ_ONLY,
  run: async ({ instance, id }, ctx) => {
    const resolved = await resolveInstance(ctx, instance);
    const lead = await ctx.deps.leads.get(resolved.id, id);
    if (!lead) throw new McpToolError('lead não encontrado nesta instância.');
    return jsonResult({ instance: resolved.name, note: NOTE, lead });
  },
});

const optionalText = (max: number, description: string) =>
  z.string().max(max).nullable().optional().describe(`${description} null limpa o campo.`);

export const updateLead = defineTool({
  name: 'update_lead',
  title: 'Alterar um lead',
  description:
    'Altera campos de um lead como a equipe faria no painel: status, prioridade (e motivo), nome, área, cidade, próximo passo, resumo, parte contrária, se já tem advogado, o que falta saber. Cada campo alterado fica travado: a IA não muda mais esse campo, e um status definido aqui nunca é mudado pela IA. Nada é enviado ao cliente. SUBSTITUI os valores atuais: confirme com o usuário. A resposta traz os valores anteriores.',
  input: {
    instance: instanceArg,
    id: z.string().min(1).max(64).describe('id do lead.'),
    status: z.enum(LEAD_STATUSES).optional().describe('Novo status.'),
    priority: z.enum(LEAD_PRIORITIES).optional().describe('Prioridade definida pela equipe.'),
    priority_reason: optionalText(160, 'Motivo da prioridade.'),
    name: optionalText(120, 'Nome do cliente.'),
    area: optionalText(60, 'Área do direito.'),
    city: optionalText(80, 'Cidade.'),
    next_step: optionalText(200, 'Próximo passo da equipe.'),
    summary: optionalText(600, 'Resumo do caso.'),
    opposing_party: optionalText(120, 'Parte contrária.'),
    has_lawyer: z.boolean().nullable().optional().describe('Já tem advogado neste caso (null = não informado).'),
    missing_info: z
      .array(z.string().max(80))
      .max(8)
      .optional()
      .describe('O que ainda falta saber (substitui a lista).'),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  run: async (args, ctx) => {
    const fields: [string, string][] = [
      ['status', 'status'],
      ['priority', 'priority'],
      ['priority_reason', 'priorityReason'],
      ['name', 'name'],
      ['area', 'area'],
      ['city', 'city'],
      ['next_step', 'nextStep'],
      ['summary', 'summary'],
      ['opposing_party', 'opposingParty'],
      ['has_lawyer', 'hasLawyer'],
      ['missing_info', 'missingInfo'],
    ];
    const input: Record<string, any> = {};
    for (const [arg, field] of fields) if ((args as any)[arg] !== undefined) input[field] = (args as any)[arg];
    if (!Object.keys(input).length) throw new McpToolError('nenhum campo para alterar foi informado.');

    const resolved = await resolveInstance(ctx, args.instance);
    const result = await userErrors(() => ctx.deps.leads.update(resolved.id, args.id, input));
    if (!result) throw new McpToolError('lead não encontrado nesta instância.');
    return jsonResult({ updated: true, instance: resolved.name, previous: result.previous, lead: result.lead });
  },
});

export const getLeadSettings = defineTool({
  name: 'get_lead_settings',
  title: 'Configurações de leads',
  description:
    'Mostra as configurações da triagem de leads da instância: se a análise automática está ligada, as áreas do escritório, o modelo usado e os avisos para a equipe (desligados por padrão; números e quando avisar).',
  input: { instance: instanceArg },
  annotations: READ_ONLY,
  run: async ({ instance }, ctx) => {
    const resolved = await resolveInstance(ctx, instance);
    const { configured, settings } = await ctx.deps.leads.getStoredSettings(resolved.id);
    return jsonResult({
      instance: resolved.name,
      configured,
      settings,
      note: configured ? undefined : 'Sem configuração salva: análise ligada, avisos desligados, áreas padrão.',
    });
  },
});

export const updateLeadSettings = defineTool({
  name: 'update_lead_settings',
  title: 'Alterar configurações de leads',
  description:
    'Altera as configurações da triagem de leads: ligar/desligar a análise automática, lista de áreas, modelo de extração (null = o modelo do bot) e avisos internos para a equipe por WhatsApp (ligado, números com DDI e DDD, quando: qualificado, urgente ou ambos). Os avisos vão só para os números da equipe, nunca para o cliente. Campos ausentes não mudam. SUBSTITUI os valores: confirme com o usuário.',
  input: {
    instance: instanceArg,
    enabled: z.boolean().optional().describe('Análise automática das conversas.'),
    areas: z.array(z.string().min(1).max(60)).min(1).max(20).optional().describe('Áreas do escritório.'),
    extraction_model: z.string().max(100).nullable().optional().describe('Modelo da OpenAI; null = o do bot.'),
    notify_enabled: z.boolean().optional().describe('Avisar a equipe.'),
    notify_numbers: z.array(z.string().max(20)).max(5).optional().describe('Números da equipe (DDI + DDD + número).'),
    notify_on: z.enum(NOTIFY_ON).optional().describe('Quando avisar.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  run: async (args, ctx) => {
    const input: Record<string, any> = {};
    if (args.enabled !== undefined) input.enabled = args.enabled;
    if (args.areas !== undefined) input.areas = args.areas;
    if (args.extraction_model !== undefined) input.extractionModel = args.extraction_model;
    const notify: Record<string, any> = {};
    if (args.notify_enabled !== undefined) notify.enabled = args.notify_enabled;
    if (args.notify_numbers !== undefined) notify.numbers = args.notify_numbers;
    if (args.notify_on !== undefined) notify.on = args.notify_on;
    if (Object.keys(notify).length) input.notify = notify;
    if (!Object.keys(input).length) throw new McpToolError('nenhum campo para alterar foi informado.');

    const resolved = await resolveInstance(ctx, args.instance);
    const result = await userErrors(() => ctx.deps.leads.saveSettings(resolved.id, input));
    return jsonResult({ updated: true, instance: resolved.name, previous: result.previous, settings: result.settings });
  },
});

export const leadTools = [listLeads, getLead, updateLead, getLeadSettings, updateLeadSettings];
