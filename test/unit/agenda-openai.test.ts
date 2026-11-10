import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { modelsWithoutTools } from '@api/integrations/chatbot/openai/agenda-ai';
import { OpenaiService } from '@api/integrations/chatbot/openai/services/openai.service';
import { AgendaService } from '@api/services/agenda.service';
import { UsageService } from '@api/services/usage.service';
import { configService } from '@config/env.config';

import { createAgendaTables } from '../helpers/agenda-mock';
import { createFakeOpenai, createFakeWaInstance, nextId, texts, useFakeOpenai } from '../helpers/fakes';
import { createPrismaMock } from '../helpers/prisma-mock';

const REMOTE_JID = '5511987654321@s.whatsapp.net';
const ALWAYS = Object.fromEntries(
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => [day, [['00:00', '24:00']]]),
);

async function setup(agendaPatch: Record<string, any> | null = {}) {
  const instanceId = nextId('inst');
  const waInstance = createFakeWaInstance('agenda', instanceId);
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
    context: null,
  };
  const prisma = createPrismaMock([session]);
  const tables = createAgendaTables([{ id: instanceId, name: 'agenda' }]);
  Object.assign(prisma, {
    agendaSettings: tables.agendaSettings,
    appointment: tables.appointment,
    instance: tables.instance,
    $transaction: tables.$transaction,
  });
  const agenda = new AgendaService(prisma, { waInstances: { agenda: waInstance } }, { cacheTtlMs: 0 });
  (waInstance as any).connectionStatus = { state: 'open' };
  if (agendaPatch) {
    await agenda.saveSettings(instanceId, { enabled: true, minNoticeHours: 0, availability: ALWAYS, ...agendaPatch });
  }
  const usage = new UsageService(prisma);
  const service: any = new OpenaiService(
    { waInstances: { agenda: waInstance } } as any,
    prisma,
    configService,
    usage,
    null,
    agenda,
  );
  const openai = createFakeOpenai();
  useFakeOpenai(service, openai);
  const bot: any = {
    id: 'bot-1',
    botType: 'chatCompletion',
    openaiCredsId: 'creds-1',
    model: `gpt-6-luna-${nextId()}`,
    maxTokens: 2000,
    tokenParam: null,
    systemMessages: ['Você é a assistente do escritório.'],
    assistantMessages: [],
    userMessages: [],
  };
  const settings: any = {
    unknownMessage: '',
    keywordFinish: '#sair',
    splitMessages: false,
    timePerChar: 0,
    delayMessage: 0,
  };
  const ask = (content: string) =>
    service.process(
      waInstance,
      REMOTE_JID,
      bot,
      structuredClone(prisma.sessions.get(session.id)),
      settings,
      content,
      'Maria',
      {
        key: { id: nextId('MSG'), remoteJid: REMOTE_JID, fromMe: false },
        pushName: 'Maria',
      },
    );
  const answers = async () =>
    (await prisma.usageCounter.findMany({ where: { instanceId, type: 'month' } })).reduce(
      (sum: number, row: any) => sum + row.responses,
      0,
    );
  return { prisma, agenda, waInstance, openai, bot, ask, answers, instanceId, tables };
}

const toolCall = (name: string, args: any) => ({
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

describe('OpenaiService + Agenda', () => {
  test('agenda off: request unchanged (no tools, no system note)', async () => {
    const { openai, ask } = await setup(null);
    openai.reply('Olá!');
    await ask('oi');
    assert.equal(openai.requests.length, 1);
    assert.equal(openai.requests[0].tools, undefined);
    assert.ok(!openai.requests[0].messages.some((m: any) => /Agenda \(ferramentas/.test(m.content ?? '')));
  });

  test('agenda on: tool loop books server-side, one reply, counted once', async () => {
    const { openai, ask, waInstance, tables, answers } = await setup();
    let slot: string;
    openai.reply(
      () => toolCall('consultar_horarios', { dias: 2 }),
      (params: any) => {
        const result = JSON.parse(params.messages[params.messages.length - 1].content);
        slot = result.horarios[0].inicio_iso;
        return toolCall('agendar', { inicio_iso: slot, nome: 'Maria Teste' });
      },
      'Agendado! Até lá.',
    );
    await ask('quero marcar um horário');
    assert.equal(openai.requests.length, 3);
    assert.equal(openai.requests[0].tool_choice, 'auto');
    assert.ok(openai.requests[0].tools.some((tool: any) => tool.function.name === 'agendar'));
    assert.equal(openai.requests[0].messages[1].role, 'system');
    assert.match(openai.requests[0].messages[1].content, /Agenda \(ferramentas/);
    assert.ok('max_completion_tokens' in openai.requests[0]);
    assert.deepEqual(texts(waInstance), ['Agendado! Até lá.']);
    const rows = [...tables.appointment.rows.values()];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].remoteJid, REMOTE_JID);
    assert.equal(rows[0].contactName, 'Maria Teste');
    assert.equal(await answers(), 1);
  });

  test('a model without tools is answered without them (and remembered)', async () => {
    const { openai, ask, bot, waInstance } = await setup();
    const error: any = new Error("400 Unsupported parameter: 'tools' is not supported with this model.");
    error.status = 400;
    openai.reply(error, 'Resposta sem agenda.');
    await ask('oi');
    assert.equal(openai.requests.length, 2);
    assert.equal(openai.requests[1].tools, undefined);
    assert.deepEqual(texts(waInstance), ['Resposta sem agenda.']);
    assert.ok(modelsWithoutTools.has(bot.model));
    openai.reply('De novo.');
    await ask('oi de novo');
    assert.equal(openai.requests[2].tools, undefined);
  });

  test('"1" right after a reminder confirms without calling OpenAI and is not counted', async () => {
    const { openai, ask, agenda, instanceId, tables, waInstance, answers } = await setup();
    const { appointment } = await agenda.createAppointment(instanceId, {
      remoteJid: REMOTE_JID,
      startsAt: new Date(Date.now() + 3 * 3_600_000),
      source: 'manual',
      enforceAvailability: false,
    });
    tables.appointment.rows.get(appointment.id).awaitingReplyAt = new Date();
    await ask('1');
    assert.equal(openai.requests.length, 0);
    assert.match(texts(waInstance)[0], /está confirmado/);
    assert.equal(tables.appointment.rows.get(appointment.id).status, 'confirmado');
    assert.equal(await answers(), 0);
    // The next "1" is a normal message for the AI
    openai.reply('Como posso ajudar?');
    await ask('1');
    assert.equal(openai.requests.length, 1);
  });
});
