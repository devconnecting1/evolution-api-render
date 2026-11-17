import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { CONTEXT_NOTE_HEADER } from '@api/integrations/chatbot/openai/ai-context';
import { HANDOFF_TOOL_NAME } from '@api/integrations/chatbot/openai/handoff-ai';
import { OpenaiService } from '@api/integrations/chatbot/openai/services/openai.service';
import { configService } from '@config/env.config';
import { isHumanPaused, isManualPause } from '@utils/humanPause';

import { createFakeOpenai, createFakeWaInstance, nextId, texts, useFakeOpenai } from '../helpers/fakes';
import { createPrismaMock } from '../helpers/prisma-mock';

const REMOTE_JID = '5521900000001@s.whatsapp.net';

function setup(options: { settings?: Record<string, any>; context?: any; leads?: any } = {}) {
  const instanceId = nextId('inst');
  const waInstance = createFakeWaInstance('unit', instanceId);
  const session = {
    id: nextId('sess'),
    remoteJid: REMOTE_JID,
    sessionId: REMOTE_JID,
    instanceId,
    botId: 'bot-1',
    type: 'openai',
    status: 'opened',
    awaitUser: false,
    parameters: null,
    context: options.context ? JSON.stringify(options.context) : null,
  };
  const prisma = createPrismaMock([session]);
  const service: any = new OpenaiService(
    { waInstances: { unit: waInstance } } as any,
    prisma,
    configService,
    undefined,
    options.leads ?? null,
  );
  const openai = createFakeOpenai();
  useFakeOpenai(service, openai);
  const bot: any = {
    id: 'bot-1',
    botType: 'chatCompletion',
    openaiCredsId: 'creds-1',
    model: `gpt-4o-${nextId()}`,
    maxTokens: 300,
    tokenParam: null,
    systemMessages: ['Você é a assistente do escritório.'],
    assistantMessages: [],
    userMessages: [],
  };
  const settings: any = {
    unknownMessage: 'Falha.',
    keywordFinish: '#sair',
    splitMessages: false,
    timePerChar: 0,
    delayMessage: 0,
    tokenParam: 'auto',
    ...options.settings,
  };
  const ask = (content: string, msg?: any) =>
    service.process(
      waInstance,
      REMOTE_JID,
      bot,
      structuredClone(prisma.sessions.get(session.id)),
      settings,
      content,
      'Cliente',
      msg,
    );
  const saved = () => JSON.parse(prisma.sessions.get(session.id).context);
  return { service, prisma, waInstance, openai, session, ask, saved };
}

const toolCall = (name: string, args: any) => () => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: nextId('call'), type: 'function', function: { name, arguments: JSON.stringify(args) } }],
      },
      finish_reason: 'tool_calls',
    },
  ],
});

describe('OpenaiService guardrails', () => {
  test('the context note is the last system message, right before the customer message', async () => {
    const t = setup();
    await t.ask('oi');
    const messages = t.openai.requests[0].messages;
    assert.equal(messages.at(-1).role, 'user');
    assert.equal(messages.at(-2).role, 'system');
    assert.ok(messages.at(-2).content.startsWith(CONTEXT_NOTE_HEADER));
    assert.match(messages.at(-2).content, /- Agora: .+ \(horário de Brasília/);
    assert.equal(messages[0].content, 'Você é a assistente do escritório.', 'static prompt stays first');
  });

  test('a repeated question is regenerated once; the new answer is sent and remembered', async () => {
    const t = setup({
      context: {
        history: [
          { role: 'user', content: 'meu plano negou a cirurgia' },
          { role: 'assistant', content: 'Sinto muito. Qual o nome do seu plano de saúde?' },
        ],
      },
    });
    t.openai.reply('Entendi. Qual o nome do seu plano de saúde?', 'Certo, plano Assim. Em qual cidade você mora?');
    await t.ask('Assim');

    assert.equal(t.openai.requests.length, 2, 'one regeneration');
    assert.match(t.openai.requests[1].messages.at(-1).content, /Não diga nem pergunte de novo/);
    assert.deepEqual(texts(t.waInstance), ['Certo, plano Assim. Em qual cidade você mora?']);
    assert.equal(t.saved().history.at(-1).content, 'Certo, plano Assim. Em qual cidade você mora?');
    assert.equal(t.saved().botReplies.at(-1), 'Certo, plano Assim. Em qual cidade você mora?');
  });

  test('advocacia: a fee in the answer is never sent', async () => {
    const t = setup({ settings: { ethicsProfile: 'advocacia' } });
    t.openai.reply('A consulta custa R$ 300. Qual o seu nome?', 'A consulta custa R$ 300. Qual o seu nome?');
    await t.ask('quanto custa?');
    assert.deepEqual(texts(t.waInstance), ['Qual o seu nome?']);
  });

  test('Click-to-WhatsApp: the ad goes to the note, never into the customer text', async () => {
    const t = setup();
    const msg = {
      key: { id: nextId('MSG'), remoteJid: REMOTE_JID, fromMe: false },
      message: { conversation: 'oi' },
      contextInfo: { externalAdReply: { title: 'Ficou sem luz?', body: 'Interrupção de energia por mais de 24h.' } },
    };
    await t.ask('oi\nexternalAdReplyBody|Interrupção de energia por mais de 24h.', msg);
    const messages = t.openai.requests[0].messages;
    assert.ok(!JSON.stringify(messages.at(-1)).includes('externalAdReplyBody'));
    assert.match(messages.at(-2).content, /O contato chegou por um anúncio: Ficou sem luz\? — Interrupção/);
    assert.ok(!JSON.stringify(t.saved().history).includes('externalAdReplyBody'), 'not stored either');
  });

  test('handoffTool off: no tools are sent', async () => {
    const t = setup();
    await t.ask('quero falar com o advogado');
    assert.equal(t.openai.requests[0].tools, undefined);
  });

  test('handoffTool on: the farewell is sent, then the AI is paused for the contact and the team is told', async () => {
    const team = createFakeWaInstance('team', 'x');
    const leads = { getSettings: async () => ({ notify: { enabled: true, numbers: ['5521911112222'] } }) };
    const t = setup({ settings: { handoffTool: true }, leads });
    t.waInstance.textMessage = (data: any, ...args: any[]) => team.textMessage(data, ...args);
    t.openai.reply(
      toolCall(HANDOFF_TOOL_NAME, { motivo: 'pedido_humano', resumo: 'Quer falar com o advogado sobre FGTS.' }),
      'Certo! Uma pessoa da equipe vai continuar o atendimento por aqui.',
    );
    await t.ask('quero falar com o advogado');

    assert.ok(t.openai.requests[0].tools.some((tool: any) => tool.function.name === HANDOFF_TOOL_NAME));
    const sent = texts(team);
    assert.equal(sent[0], 'Certo! Uma pessoa da equipe vai continuar o atendimento por aqui.');
    assert.match(sent[1], /^Atendimento transferido para a equipe — Cliente pediu para falar com uma pessoa\./);
    assert.equal(team.sent[1].data.number, '5521911112222');
    const session = t.prisma.sessions.get(t.session.id);
    assert.equal(session.status, 'paused');
    assert.ok(isHumanPaused(session) && isManualPause(session), 'manual pause: only the team reactivates');
  });
});

describe('OpenAI controller: groups', () => {
  test('group chats are never handed to the OpenAI bot (groupsIgnore off by default)', async () => {
    const { OpenaiController } = await import('@api/integrations/chatbot/openai/controllers/openai.controller');
    const settingsRepository = { findFirst: async () => ({ ignoreJids: [] }) };
    const controller: any = new OpenaiController(
      new OpenaiService({ waInstances: {} } as any, {} as any, configService),
      {} as any,
      { waInstances: {} } as any,
    );
    controller.settingsRepository = settingsRepository;
    let reachedSession = false;
    controller.resolveSessionJids = async () => {
      reachedSession = true;
      return [];
    };
    await controller.emit({
      instance: { instanceName: 'unit', instanceId: 'inst-1' },
      remoteJid: '120363000000000000@g.us',
      msg: { key: { id: 'G1', remoteJid: '120363000000000000@g.us', fromMe: false }, message: { conversation: 'oi' } },
    });
    assert.equal(reachedSession, false);

    // Control: a contact goes on to the session lookup
    await controller.emit({
      instance: { instanceName: 'unit', instanceId: 'inst-1' },
      remoteJid: REMOTE_JID,
      msg: { key: { id: 'C1', remoteJid: REMOTE_JID, fromMe: false }, message: { conversation: 'oi' } },
    });
    assert.equal(reachedSession, true);
  });
});
