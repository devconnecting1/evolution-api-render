import { z } from 'zod';

import { resolveInstance } from '../mcp.instance';
import { defineTool, instanceArg, READ_ONLY } from '../mcp.tool';
import { McpContext } from '../mcp.types';
import { jsonResult, McpToolError } from '../mcp.util';

const STATUS: Record<string, string> = {
  em_dia: 'Em dia',
  novidade: 'Nova movimentação',
  erro: 'Erro',
  aguardando: 'Aguardando consulta',
};

function service(ctx: McpContext) {
  if (!ctx.deps.processos) throw new McpToolError('o módulo Processos não está disponível neste servidor.');
  return ctx.deps.processos;
}

/** Errors of the service (ProcessosError: status + PT-BR message) become messages the AI can act on. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (typeof error?.status === 'number' && error?.message) throw new McpToolError(String(error.message));
    throw error;
  }
}

const processArg = z.string().min(1).max(40).describe('Id do processo (veja list_processes).');

const summary = (p: any) => ({
  id: p.id,
  numero: p.numeroCnj,
  tribunal: String(p.tribunalAlias ?? '').toUpperCase(),
  apelido: p.apelido ?? null,
  cliente: p.clientName ?? null,
  classe: p.classe ?? null,
  ultimaMovimentacao: p.lastMovement ?? null,
  atualizadoEm: p.lastSyncedAt ?? null,
  situacao: STATUS[p.status] ?? p.status,
  novidades: p.unseen ?? 0,
  erro: p.lastError ?? null,
  arquivado: p.active === false,
});

export const listProcesses = defineTool({
  name: 'list_processes',
  title: 'Processos monitorados',
  description:
    'Lista os processos judiciais acompanhados pela instância (DataJud do CNJ): número, tribunal, apelido, cliente, classe, última movimentação, situação (Em dia / Nova movimentação / Erro) e quantas novidades não vistas. Filtros: view (all, news, archived), tribunal (ex.: tjrj) e busca por texto ou número.',
  input: {
    instance: instanceArg,
    view: z
      .enum(['all', 'news', 'archived'])
      .optional()
      .describe('all = ativos (padrão), news = com novidade, archived.'),
    tribunal: z.string().max(20).optional().describe('Alias do tribunal, ex.: tjrj, trt1, trf2.'),
    q: z.string().max(120).optional().describe('Busca por apelido, cliente, classe ou número.'),
    limit: z.number().int().min(1).max(200).optional().describe('Máximo de processos (padrão 50).'),
  },
  annotations: READ_ONLY,
  run: async (args, ctx) => {
    const resolved = await resolveInstance(ctx, args.instance);
    const result = await call(() => service(ctx).list(resolved.id, args));
    const limit = args.limit ?? 50;
    return jsonResult({
      instance: resolved.name,
      counts: result.counts,
      total: result.items.length,
      processes: result.items.slice(0, limit).map(summary),
      note: 'Dados públicos do DataJud/CNJ, que podem atrasar dias. Não substitui a consulta aos canais oficiais.',
    });
  },
});

export const getProcess = defineTool({
  name: 'get_process',
  title: 'Detalhe de um processo',
  description:
    'Mostra um processo monitorado com a capa (classe, assuntos, órgão julgador, ajuizamento), o contato vinculado, os avisos ligados e as últimas movimentações (mais recentes primeiro), além das publicações do DJEN ligadas a ele.',
  input: {
    instance: instanceArg,
    process_id: processArg,
    movements: z.number().int().min(1).max(100).optional().describe('Quantas movimentações (padrão 20).'),
  },
  annotations: READ_ONLY,
  run: async (args, ctx) => {
    const resolved = await resolveInstance(ctx, args.instance);
    const p = await call(() => service(ctx).get(resolved.id, args.process_id, args.movements ?? 20));
    return jsonResult({
      instance: resolved.name,
      ...summary({ ...p, lastMovement: p.movements?.[0] ?? null }),
      assuntos: p.assuntos ?? null,
      orgaoJulgador: p.orgaoJulgador ?? null,
      dataAjuizamento: p.dataAjuizamento ?? null,
      contatoVinculado: p.remoteJid ?? null,
      avisos: {
        equipe: p.notifyTeam,
        cliente: p.notifyClient,
        iaPodeResponder: p.allowAiAnswer,
        segredoDeJustica: p.segredoJustica,
      },
      movimentacoes: (p.movements ?? []).map((m: any) => ({
        data: m.occurredAt,
        nome: m.name,
        complemento: m.complement ?? null,
        vista: m.seen,
      })),
      publicacoes: p.publications ?? [],
    });
  },
});

export const addProcess = defineTool({
  name: 'add_process',
  title: 'Adicionar processo ao monitoramento',
  description:
    'Adiciona um processo à lista de monitoramento pelo número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO, valida o dígito verificador e detecta o tribunal). A primeira consulta ao DataJud roda em segundo plano e não gera avisos. Não envia nada a ninguém.',
  input: {
    instance: instanceArg,
    numero: z.string().min(20).max(40).describe('Número CNJ, com ou sem pontuação.'),
    apelido: z.string().max(120).optional().describe('Apelido interno (ex.: "Silva x Banco").'),
    cliente: z.string().max(120).optional().describe('Nome do cliente.'),
    tribunal: z.string().max(20).optional().describe('Alias do DataJud, só se a detecção pelo número não servir.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  run: async (args, ctx) => {
    const resolved = await resolveInstance(ctx, args.instance);
    const row = await call(() =>
      service(ctx).add(resolved.id, {
        numero: args.numero,
        apelido: args.apelido,
        clientName: args.cliente,
        tribunalAlias: args.tribunal,
      }),
    );
    return jsonResult({
      added: true,
      instance: resolved.name,
      id: row.id,
      numero: row.numeroCnj,
      tribunal: String(row.tribunalAlias).toUpperCase(),
      note: 'A primeira consulta ao DataJud roda em segundo plano (pode levar ~30 s). Avisos ao cliente ficam desligados.',
    });
  },
});

export const listPublications = defineTool({
  name: 'list_publications',
  title: 'Publicações do DJEN',
  description:
    'Lista as intimações/publicações do DJEN (Comunica PJe) encontradas para as OABs acompanhadas: tribunal, processo, tipo, data de disponibilização, primeiras linhas do texto e link. Filtros: só não vistas, tribunal e período.',
  input: {
    instance: instanceArg,
    unseen: z.boolean().optional().describe('Só as não vistas.'),
    tribunal: z.string().max(20).optional().describe('Sigla do tribunal, ex.: TJRJ.'),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('Data inicial (AAAA-MM-DD).'),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('Data final (AAAA-MM-DD).'),
    limit: z.number().int().min(1).max(100).optional().describe('Máximo (padrão 20).'),
  },
  annotations: READ_ONLY,
  run: async (args, ctx) => {
    const resolved = await resolveInstance(ctx, args.instance);
    const result = await call(() => service(ctx).listPublications(resolved.id, { ...args, limit: args.limit ?? 20 }));
    return jsonResult({
      instance: resolved.name,
      total: result.total,
      publications: result.items.map((p: any) => ({
        id: p.id,
        tribunal: p.siglaTribunal,
        processo: p.processNumber,
        tipo: p.tipo,
        disponibilizadaEm: p.disponibilizadaEm,
        inicio: String(p.texto ?? '').slice(0, 400),
        link: p.link,
        vista: !!p.seenAt,
        processoMonitorado: p.Process ? { id: p.Process.id, apelido: p.Process.apelido } : null,
      })),
      note: 'O DJEN é a fonte oficial de intimações, mas esta lista é uma cópia: confira sempre no tribunal.',
    });
  },
});

export const syncProcess = defineTool({
  name: 'sync_process',
  title: 'Sincronizar processo agora',
  description:
    'Consulta o DataJud agora para um processo monitorado e grava as movimentações novas (no máximo 1 vez por minuto por processo). Pode levar ~30 s. Avisos à equipe só saem para movimentações novas, depois da primeira importação.',
  input: { instance: instanceArg, process_id: processArg },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  run: async (args, ctx) => {
    const resolved = await resolveInstance(ctx, args.instance);
    const { result, process } = await call(() => service(ctx).manualSync(resolved.id, args.process_id));
    return jsonResult({
      instance: resolved.name,
      ok: result.ok,
      novas: result.created,
      erro: result.error ?? null,
      processo: summary({ ...process, lastMovement: process.movements?.[0] ?? null }),
    });
  },
});

export const getProcessSettings = defineTool({
  name: 'get_process_settings',
  title: 'Configurações de Processos',
  description:
    'Mostra as configurações do monitoramento de processos da instância (ligado, verificar a cada N horas, dias do DJEN, números da equipe que recebem os avisos, horário de silêncio, mensagem ao cliente) e as OABs acompanhadas no DJEN.',
  input: { instance: instanceArg },
  annotations: READ_ONLY,
  run: async ({ instance }, ctx) => {
    const svc = service(ctx);
    const resolved = await resolveInstance(ctx, instance);
    const [settings, oabs] = await Promise.all([
      call(() => svc.getSettings(resolved.id)),
      call(() => svc.listOab(resolved.id)),
    ]);
    return jsonResult({
      instance: resolved.name,
      settings,
      oabs: (oabs ?? []).map((o: any) => ({
        id: o.id,
        oab: `${o.numeroOab}/${o.ufOab}`,
        label: o.label ?? null,
        active: o.active !== false,
        lastCheckedAt: o.lastCheckedAt ?? null,
      })),
    });
  },
});

export const updateProcessSettings = defineTool({
  name: 'update_process_settings',
  title: 'Alterar configurações de Processos',
  description:
    'Altera o monitoramento de processos: ligar/desligar, verificar a cada N horas (2 a 48), dias do DJEN (1 a 30) e números da equipe que recebem os avisos (DDI+DDD+número; a lista SUBSTITUI a atual). Também pode adicionar uma OAB para acompanhar as publicações do DJEN. Campos ausentes não mudam. Confirme com o usuário. Devolve os valores anteriores.',
  input: {
    instance: instanceArg,
    enabled: z.boolean().optional(),
    check_every_hours: z.number().int().min(2).max(48).optional(),
    djen_days: z.number().int().min(1).max(30).optional(),
    notify_numbers: z.array(z.string().min(10).max(20)).max(10).optional(),
    add_oab: z
      .object({
        numero: z.string().min(1).max(10).describe('Número da OAB, ex.: 123456 ou 123456A.'),
        uf: z.string().length(2).describe('UF da OAB, ex.: RJ.'),
        label: z.string().max(120).optional().describe('Apelido, ex.: "Dr. Fulano".'),
      })
      .optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  run: async (args, ctx) => {
    const svc = service(ctx);
    const input: Record<string, any> = {};
    if (args.enabled !== undefined) input.enabled = args.enabled;
    if (args.check_every_hours !== undefined) input.checkEveryHours = args.check_every_hours;
    if (args.djen_days !== undefined) input.djenDays = args.djen_days;
    if (args.notify_numbers !== undefined) input.notifyNumbers = args.notify_numbers;
    if (!Object.keys(input).length && !args.add_oab) throw new McpToolError('nenhum campo para alterar foi informado.');

    const resolved = await resolveInstance(ctx, args.instance);
    const result = Object.keys(input).length ? await call(() => svc.saveSettings(resolved.id, input)) : null;
    const oab = args.add_oab
      ? await call(() =>
          svc.addOab(resolved.id, {
            numeroOab: args.add_oab.numero,
            ufOab: args.add_oab.uf,
            label: args.add_oab.label,
          }),
        )
      : null;
    return jsonResult({
      updated: true,
      instance: resolved.name,
      previous: result?.previous ?? null,
      settings: result?.settings ?? null,
      oabAdded: oab ? { id: oab.id, oab: `${oab.numeroOab}/${oab.ufOab}`, label: oab.label ?? null } : null,
    });
  },
});

export const processosTools = [
  listProcesses,
  getProcess,
  addProcess,
  listPublications,
  syncProcess,
  getProcessSettings,
  updateProcessSettings,
];
