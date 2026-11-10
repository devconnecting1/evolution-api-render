import { describeHumanPause, isHumanPaused, resolveHumanResumeMinutes, withManualPause } from '@utils/humanPause';
import { z } from 'zod';

import { ResolvedInstance, resolveInstance } from '../mcp.instance';
import { contactArg, defineTool, instanceArg, READ_ONLY } from '../mcp.tool';
import { McpContext } from '../mcp.types';
import { isoDate, jsonResult, maskSecret, McpToolError, normalizeContactJid } from '../mcp.util';

const MAX_PROMPT_CHARS = 20_000;

const truncatePrompt = (value: unknown) =>
  typeof value === 'string' && value.length > MAX_PROMPT_CHARS
    ? `${value.slice(0, MAX_PROMPT_CHARS)}… [cortado em ${MAX_PROMPT_CHARS} caracteres]`
    : value;

const messagesList = (value: unknown) => (Array.isArray(value) ? value.map(truncatePrompt) : (value ?? null));

function botView(bot: any, creds: Map<string, any>) {
  const cred = creds.get(bot.openaiCredsId);

  return {
    id: bot.id,
    enabled: bot.enabled,
    description: bot.description ?? null,
    botType: bot.botType,
    model: bot.model ?? null,
    maxTokens: bot.maxTokens ?? null,
    tokenParam: bot.tokenParam ?? null,
    assistantId: bot.assistantId ?? null,
    functionUrl: bot.functionUrl ?? null,
    systemMessages: messagesList(bot.systemMessages),
    assistantMessages: messagesList(bot.assistantMessages),
    userMessages: messagesList(bot.userMessages),
    trigger: { type: bot.triggerType ?? null, operator: bot.triggerOperator ?? null, value: bot.triggerValue ?? null },
    expireMinutes: bot.expire ?? null,
    keywordFinish: bot.keywordFinish ?? null,
    humanResumeMinutes: bot.humanResumeMinutes ?? null,
    delayMessage: bot.delayMessage ?? null,
    unknownMessage: bot.unknownMessage ?? null,
    listeningFromMe: bot.listeningFromMe ?? null,
    stopBotFromMe: bot.stopBotFromMe ?? null,
    keepOpen: bot.keepOpen ?? null,
    debounceTime: bot.debounceTime ?? null,
    splitMessages: bot.splitMessages ?? null,
    timePerChar: bot.timePerChar ?? null,
    ignoreJids: bot.ignoreJids ?? null,
    historyMessages: bot.historyMessages ?? null,
    media: {
      transcribeAudio: bot.transcribeAudio ?? null,
      transcriptionModel: bot.transcriptionModel ?? null,
      maxAudioSeconds: bot.maxAudioSeconds ?? null,
      readImages: bot.readImages ?? null,
      readDocuments: bot.readDocuments ?? null,
      maxDocumentMB: bot.maxDocumentMB ?? null,
    },
    credential: cred ? { id: cred.id, name: cred.name ?? null, apiKey: maskSecret(cred.apiKey) } : null,
    updatedAt: isoDate(bot.updatedAt),
  };
}

async function loadBots(ctx: McpContext, instanceId: string): Promise<any[]> {
  return (
    (await ctx.deps.prisma.openaiBot.findMany({ where: { instanceId }, orderBy: { createdAt: 'asc' }, take: 50 })) ?? []
  );
}

export const getBotConfig = defineTool({
  name: 'get_bot_config',
  title: 'Configuração do bot OpenAI',
  description:
    'Mostra o(s) bot(s) OpenAI da instância e as configurações padrão: modelo, prompt (mensagens de sistema), gatilho, expire, pausa humana (humanResumeMinutes), palavra de encerramento, mídia e histórico. A chave da OpenAI vem mascarada.',
  input: { instance: instanceArg },
  annotations: READ_ONLY,
  run: async ({ instance }, ctx) => {
    const resolved = await resolveInstance(ctx, instance);

    const [bots, settings, creds] = await Promise.all([
      loadBots(ctx, resolved.id),
      ctx.deps.prisma.openaiSetting.findFirst({ where: { instanceId: resolved.id } }),
      ctx.deps.prisma.openaiCreds.findMany({
        where: { instanceId: resolved.id },
        select: { id: true, name: true, apiKey: true },
        take: 20,
      }),
    ]);

    const credsById = new Map<string, any>((creds ?? []).map((cred: any) => [cred.id, cred]));

    const settingsView = settings
      ? {
          expireMinutes: settings.expire ?? null,
          keywordFinish: settings.keywordFinish ?? null,
          humanResumeMinutes: settings.humanResumeMinutes ?? 0,
          delayMessage: settings.delayMessage ?? null,
          unknownMessage: settings.unknownMessage ?? null,
          listeningFromMe: settings.listeningFromMe ?? null,
          stopBotFromMe: settings.stopBotFromMe ?? null,
          keepOpen: settings.keepOpen ?? null,
          debounceTime: settings.debounceTime ?? null,
          splitMessages: settings.splitMessages ?? null,
          timePerChar: settings.timePerChar ?? null,
          ignoreJids: settings.ignoreJids ?? null,
          tokenParam: settings.tokenParam ?? null,
          ethicsProfile: settings.ethicsProfile ?? 'none',
          historyMessages: settings.historyMessages ?? null,
          fallbackBotId: settings.openaiIdFallback ?? null,
          credentialId: settings.openaiCredsId ?? null,
          media: {
            transcribeAudio: settings.transcribeAudio ?? null,
            transcriptionModel: settings.transcriptionModel ?? null,
            maxAudioSeconds: settings.maxAudioSeconds ?? null,
            readImages: settings.readImages ?? null,
            readDocuments: settings.readDocuments ?? null,
            maxDocumentMB: settings.maxDocumentMB ?? null,
          },
        }
      : null;

    return jsonResult({
      instance: resolved.name,
      openaiIntegrationEnabled: ctx.deps.openaiController?.integrationEnabled !== false,
      note: 'Campos do bot com null herdam o valor das settings. expireMinutes não tem efeito no bot OpenAI (manual, seção 12).',
      settings: settingsView,
      bots: bots.map((bot) => botView(bot, credsById)),
      credentials: (creds ?? []).map((cred: any) => ({
        id: cred.id,
        name: cred.name ?? null,
        apiKey: maskSecret(cred.apiKey),
      })),
    });
  },
});

/** Every address of the contact's chat (phone and LID) so a session stored under either is found. */
async function contactJids(resolved: ResolvedInstance, contact: string): Promise<string[]> {
  const jid = normalizeContactJid(contact);
  if (!resolved.channel?.resolveEquivalentJids) return [jid];

  try {
    return await resolved.channel.resolveEquivalentJids(jid);
  } catch {
    return [jid];
  }
}

async function sessionsOf(ctx: McpContext, instanceId: string, botIds: string[], jids?: string[], take = 200) {
  if (!botIds.length) return [];

  return (
    (await ctx.deps.prisma.integrationSession.findMany({
      where: { instanceId, botId: { in: botIds }, ...(jids ? { remoteJid: { in: jids } } : {}) },
      orderBy: { updatedAt: 'desc' },
      take,
    })) ?? []
  );
}

function sessionView(session: any, bots: Map<string, any>, settings: any, now = Date.now()) {
  const humanPause = describeHumanPause(session, resolveHumanResumeMinutes(bots.get(session.botId), settings), now);

  return {
    remoteJid: session.remoteJid,
    pushName: session.pushName ?? null,
    status: session.status,
    paused: isHumanPaused(session),
    botId: session.botId ?? null,
    humanPause,
    updatedAt: isoDate(session.updatedAt),
  };
}

export const listPausedContacts = defineTool({
  name: 'list_paused_contacts',
  title: 'Contatos com o bot pausado',
  description:
    'Lista os contatos em que o bot OpenAI está pausado (pausa humana quando a equipe responde, ou pausa manual), com o motivo e quando volta sozinho. Com include_active=true mostra também as sessões ativas; com contact, o estado de um contato.',
  input: {
    instance: instanceArg,
    contact: contactArg.optional(),
    include_active: z.boolean().optional().describe('Inclui sessões ativas e encerradas. Padrão: false (só pausadas).'),
    limit: z.number().int().min(1).max(200).optional().describe('Máximo de sessões (1 a 200). Padrão: 50.'),
  },
  annotations: READ_ONLY,
  run: async ({ instance, contact, include_active, limit = 50 }, ctx) => {
    const resolved = await resolveInstance(ctx, instance);
    const bots = await loadBots(ctx, resolved.id);
    const jids = contact ? await contactJids(resolved, contact) : undefined;

    const [sessions, settings] = await Promise.all([
      sessionsOf(
        ctx,
        resolved.id,
        bots.map((bot) => bot.id),
        jids,
        500,
      ),
      ctx.deps.prisma.openaiSetting.findFirst({ where: { instanceId: resolved.id } }),
    ]);

    const botsById = new Map<string, any>(bots.map((bot) => [bot.id, bot]));
    const now = Date.now();
    const views = sessions
      .map((session: any) => sessionView(session, botsById, settings, now))
      .filter((view: any) => include_active || view.paused);

    return jsonResult({
      instance: resolved.name,
      contact: jids,
      count: Math.min(views.length, limit),
      totalMatching: views.length,
      sessions: views.slice(0, limit),
      note:
        contact && !sessions.length
          ? 'Nenhuma sessão de bot para este contato: o bot responde normalmente quando ele escrever (se o gatilho casar).'
          : undefined,
    });
  },
});

function pickBot(bots: any[], botId?: string) {
  if (botId) {
    const bot = bots.find((item) => item.id === botId);
    if (!bot) throw new McpToolError(`bot "${botId}" não encontrado nesta instância (veja get_bot_config).`);
    return bot;
  }

  const enabled = bots.filter((bot) => bot.enabled);
  if (enabled.length === 1) return enabled[0];
  if (!bots.length) throw new McpToolError('esta instância não tem bot OpenAI.');

  throw new McpToolError('a instância tem mais de um bot: informe bot_id (veja get_bot_config).');
}

const WRITE_SESSION = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

async function changeStatus(
  ctx: McpContext,
  resolved: ResolvedInstance,
  remoteJid: string,
  status: 'paused' | 'opened',
) {
  if (ctx.deps.openaiController?.integrationEnabled === false) {
    throw new McpToolError('a integração OpenAI está desativada neste servidor (OPENAI_ENABLED).');
  }

  // Same path as POST /openai/changeStatus/:instance (manual pause / reactivation, webhook openai.change_status)
  await ctx.deps.openaiController.changeStatus({ instanceName: resolved.name }, { remoteJid, status });
}

export const pauseBotForContact = defineTool({
  name: 'pause_bot_for_contact',
  title: 'Pausar o bot para um contato',
  description:
    'Pausa o bot OpenAI para um contato (pausa manual: só volta com resume_bot_for_contact, nunca sozinha). Use quando uma pessoa da equipe vai assumir a conversa. Se o contato ainda não tem sessão, cria uma já pausada.',
  input: {
    instance: instanceArg,
    contact: contactArg,
    bot_id: z
      .string()
      .max(100)
      .optional()
      .describe('Bot a usar se for preciso criar a sessão (só com mais de um bot).'),
  },
  annotations: WRITE_SESSION,
  run: async ({ instance, contact, bot_id }, ctx) => {
    const resolved = await resolveInstance(ctx, instance);
    const bots = await loadBots(ctx, resolved.id);
    if (!bots.length) throw new McpToolError('esta instância não tem bot OpenAI.');

    const jids = await contactJids(resolved, contact);
    const sessions = await sessionsOf(
      ctx,
      resolved.id,
      bots.map((bot) => bot.id),
      jids,
      20,
    );
    const botsById = new Map<string, any>(bots.map((bot) => [bot.id, bot]));

    let created = false;
    if (sessions.length) {
      for (const remoteJid of new Set<string>(sessions.map((session: any) => session.remoteJid))) {
        await changeStatus(ctx, resolved, remoteJid, 'paused');
      }
    } else {
      if (ctx.deps.openaiController?.integrationEnabled === false) {
        throw new McpToolError('a integração OpenAI está desativada neste servidor (OPENAI_ENABLED).');
      }

      // Same shape as the session the human takeover creates, marked as a manual pause
      const bot = pickBot(bots, bot_id);
      const jid = jids.find((item) => item.endsWith('@s.whatsapp.net')) ?? jids[0];
      await ctx.deps.prisma.integrationSession.create({
        data: {
          remoteJid: jid,
          pushName: null,
          sessionId: jid,
          status: 'paused',
          awaitUser: false,
          botId: bot.id,
          instanceId: resolved.id,
          type: 'openai',
          parameters: withManualPause(null),
        },
      });
      created = true;
    }

    const [after, settings] = await Promise.all([
      sessionsOf(
        ctx,
        resolved.id,
        bots.map((bot) => bot.id),
        jids,
        20,
      ),
      ctx.deps.prisma.openaiSetting.findFirst({ where: { instanceId: resolved.id } }),
    ]);

    return jsonResult({
      paused: true,
      createdSession: created,
      instance: resolved.name,
      contact: jids,
      sessions: after.map((session: any) => sessionView(session, botsById, settings)),
    });
  },
});

export const resumeBotForContact = defineTool({
  name: 'resume_bot_for_contact',
  title: 'Reativar o bot para um contato',
  description:
    'Reativa o bot OpenAI para um contato pausado (pausa humana ou manual). O bot volta a responder na próxima mensagem do contato.',
  input: { instance: instanceArg, contact: contactArg },
  annotations: WRITE_SESSION,
  run: async ({ instance, contact }, ctx) => {
    const resolved = await resolveInstance(ctx, instance);
    const bots = await loadBots(ctx, resolved.id);
    const jids = await contactJids(resolved, contact);
    const sessions = await sessionsOf(
      ctx,
      resolved.id,
      bots.map((bot) => bot.id),
      jids,
      20,
    );

    const paused = sessions.filter((session: any) => isHumanPaused(session));
    if (!paused.length) {
      return jsonResult({
        resumed: false,
        instance: resolved.name,
        contact: jids,
        note: sessions.length
          ? 'O bot já está ativo para este contato.'
          : 'Este contato não tem sessão de bot: o bot já responde normalmente.',
      });
    }

    for (const remoteJid of new Set<string>(paused.map((session: any) => session.remoteJid))) {
      await changeStatus(ctx, resolved, remoteJid, 'opened');
    }

    const [after, settings] = await Promise.all([
      sessionsOf(
        ctx,
        resolved.id,
        bots.map((bot) => bot.id),
        jids,
        20,
      ),
      ctx.deps.prisma.openaiSetting.findFirst({ where: { instanceId: resolved.id } }),
    ]);
    const botsById = new Map<string, any>(bots.map((bot) => [bot.id, bot]));

    return jsonResult({
      resumed: true,
      instance: resolved.name,
      contact: jids,
      sessions: after.map((session: any) => sessionView(session, botsById, settings)),
    });
  },
});

const minutes = (description: string) => z.number().int().min(0).max(10080).optional().describe(description);

export const updateBotSettings = defineTool({
  name: 'update_bot_settings',
  title: 'Alterar o bot OpenAI',
  description:
    'Altera campos do bot OpenAI de uma instância (lista fechada): prompt (mensagens de sistema), modelo, expire, minutos da pausa humana, palavra de encerramento e ativo/inativo. SUBSTITUI os valores atuais: confirme com o usuário. A resposta traz os valores anteriores para desfazer.',
  input: {
    instance: instanceArg,
    bot_id: z.string().max(100).optional().describe('Bot a alterar (obrigatório se a instância tiver mais de um).'),
    system_prompt: z
      .string()
      .min(1)
      .max(MAX_PROMPT_CHARS)
      .optional()
      .describe('Novo prompt: substitui todas as mensagens de sistema por este texto.'),
    system_messages: z
      .array(z.string().min(1).max(MAX_PROMPT_CHARS))
      .min(1)
      .max(10)
      .optional()
      .describe('Alternativa ao system_prompt: a lista completa de mensagens de sistema.'),
    model: z
      .string()
      .regex(/^[\w.:-]{2,100}$/, 'modelo inválido')
      .optional()
      .describe('Modelo da OpenAI (ex.: gpt-6-luna).'),
    expire_minutes: minutes('expire em minutos (0 a 10080). Sem efeito prático no bot OpenAI.'),
    pause_minutes: minutes('humanResumeMinutes: minutos até o bot voltar após a equipe responder (0 = só manual).'),
    keyword_finish: z.string().min(1).max(100).optional().describe('Palavra que encerra a sessão (ex.: #sair).'),
    enabled: z.boolean().optional().describe('Liga ou desliga o bot.'),
    ethics_profile: z
      .enum(['none', 'advocacia'])
      .optional()
      .describe(
        'Regras éticas que o sistema coloca acima do prompt, para a instância toda: "advocacia" (Código de Ética e Disciplina da OAB e Provimento 205/2021: sem consulta jurídica, sem promessa de resultado, sem valores de honorários, sem captação, sigilo) ou "none".',
      ),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  run: async (args, ctx) => {
    if (args.system_prompt && args.system_messages) {
      throw new McpToolError('use system_prompt ou system_messages, não os dois.');
    }

    const changes: Record<string, any> = {};
    if (args.system_prompt !== undefined) changes.systemMessages = [args.system_prompt];
    if (args.system_messages !== undefined) changes.systemMessages = args.system_messages;
    if (args.model !== undefined) changes.model = args.model;
    if (args.expire_minutes !== undefined) changes.expire = args.expire_minutes;
    if (args.pause_minutes !== undefined) changes.humanResumeMinutes = args.pause_minutes;
    if (args.keyword_finish !== undefined) changes.keywordFinish = args.keyword_finish;
    if (args.enabled !== undefined) changes.enabled = args.enabled;

    if (!Object.keys(changes).length && args.ethics_profile === undefined)
      throw new McpToolError('nenhum campo para alterar foi informado.');
    if (ctx.deps.openaiController?.integrationEnabled === false) {
      throw new McpToolError('a integração OpenAI está desativada neste servidor (OPENAI_ENABLED).');
    }

    const resolved = await resolveInstance(ctx, args.instance);

    // instance-wide setting (default settings of the OpenAI bot): changed directly, the bot is not touched
    let ethics: { before: string; after: string } | null = null;
    if (args.ethics_profile !== undefined) {
      const row = await ctx.deps.prisma.openaiSetting.findFirst({
        where: { instanceId: resolved.id },
        select: { id: true, ethicsProfile: true },
      });
      if (!row) throw new McpToolError('a instância ainda não tem as configurações padrão do bot OpenAI.');
      await ctx.deps.prisma.openaiSetting.update({
        where: { id: row.id },
        data: { ethicsProfile: args.ethics_profile },
      });
      ethics = { before: row.ethicsProfile ?? 'none', after: args.ethics_profile };
      if (!Object.keys(changes).length) {
        return jsonResult({ updated: true, instance: resolved.name, changes: { ethicsProfile: ethics } });
      }
    }

    const bot = pickBot(await loadBots(ctx, resolved.id), args.bot_id);

    // The REST update (PUT /openai/update) takes the whole bot: send the current values with the changes on top
    const updated = await ctx.deps.openaiController.updateBot({ instanceName: resolved.name }, bot.id, {
      ...bot,
      ...changes,
    });

    const diff = Object.fromEntries(
      Object.keys(changes).map((field) => [
        field,
        { before: messagesList(bot[field]) ?? null, after: messagesList(updated?.[field] ?? changes[field]) },
      ]),
    );

    return jsonResult({
      updated: true,
      instance: resolved.name,
      botId: bot.id,
      changes: ethics ? { ...diff, ethicsProfile: ethics } : diff,
    });
  },
});

export const botTools = [getBotConfig, listPausedContacts, pauseBotForContact, resumeBotForContact, updateBotSettings];
