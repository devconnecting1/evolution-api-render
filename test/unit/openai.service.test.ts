import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { OpenaiService } from '@api/integrations/chatbot/openai/services/openai.service';
import { configService } from '@config/env.config';

import {
  apiError,
  createFakeOpenai,
  createFakeWaInstance,
  imageMsg,
  nextId,
  texts,
  unsupportedParamError,
  useFakeOpenai,
} from '../helpers/fakes';
import { createPrismaMock } from '../helpers/prisma-mock';

const REMOTE_JID = '5511987654321@s.whatsapp.net';
const UNKNOWN = 'Desculpe, tive um problema. Um atendente vai falar com você.';

/** One service wired to fakes, with an opened session for REMOTE_JID. */
function setup(
  options: { bot?: Record<string, any>; settings?: Record<string, any>; session?: Record<string, any> } = {},
) {
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
    context: null,
    ...options.session,
  };
  const prisma = createPrismaMock([session]);
  const service: any = new OpenaiService({ waInstances: { unit: waInstance } } as any, prisma, configService);
  const openai = createFakeOpenai();
  useFakeOpenai(service, openai);

  const bot: any = {
    id: 'bot-1',
    botType: 'chatCompletion',
    openaiCredsId: 'creds-1',
    // Unique per test: the token parameter learned in "auto" mode is remembered per model, process-wide
    model: `gpt-4o-${nextId()}`,
    maxTokens: 300,
    tokenParam: null,
    systemMessages: ['Você é a assistente do escritório.'],
    assistantMessages: [],
    userMessages: [],
    ...options.bot,
  };
  const settings: any = {
    unknownMessage: UNKNOWN,
    keywordFinish: '#sair',
    splitMessages: false,
    timePerChar: 0,
    delayMessage: 0,
    tokenParam: 'auto',
    ...options.settings,
  };

  const ask = (content = 'oi', msg?: any) =>
    service.process(
      waInstance,
      REMOTE_JID,
      bot,
      structuredClone(prisma.sessions.get(session.id) ?? null),
      settings,
      content,
      'Cliente',
      msg,
    );

  return { service, prisma, waInstance, openai, bot, settings, session, ask };
}

const tokenKeys = (request: any) => Object.keys(request).filter((key) => key.includes('tokens'));

describe('OpenaiService: tokenParam resolution', { concurrency: true }, () => {
  const resolve = (bot: any, settings?: any) =>
    (new OpenaiService({} as any, {} as any, configService) as any).resolveTokenParam(bot, settings);

  test('auto: reasoning models (o-series, gpt-5, gpt-6, fine-tuned) use max_completion_tokens', () => {
    for (const model of [
      'o1',
      'o1-mini',
      'o3',
      'o4-mini',
      'gpt-5',
      'gpt-5-mini',
      'gpt-5.1',
      'GPT-5',
      'gpt-6-luna',
      'ft:gpt-5:org:x',
    ]) {
      assert.deepEqual(
        resolve({ model, tokenParam: null }, { tokenParam: 'auto' }),
        { mode: 'auto', param: 'max_completion_tokens' },
        model,
      );
    }
  });

  test('auto: other models use max_tokens', () => {
    for (const model of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-3.5-turbo', 'ft:gpt-4o:org:x', 'omni-x', '']) {
      assert.deepEqual(
        resolve({ model, tokenParam: null }, { tokenParam: 'auto' }),
        { mode: 'auto', param: 'max_tokens' },
        model,
      );
    }
  });

  test('precedence: bot > settings > auto; unknown values fall back to auto', () => {
    assert.deepEqual(resolve({ model: 'gpt-4o', tokenParam: 'max_completion_tokens' }, { tokenParam: 'max_tokens' }), {
      mode: 'max_completion_tokens',
      param: 'max_completion_tokens',
    });
    assert.deepEqual(resolve({ model: 'gpt-5', tokenParam: null }, { tokenParam: 'max_tokens' }), {
      mode: 'max_tokens',
      param: 'max_tokens',
    });
    assert.deepEqual(resolve({ model: 'gpt-5', tokenParam: undefined }, undefined), {
      mode: 'auto',
      param: 'max_completion_tokens',
    });
    assert.deepEqual(resolve({ model: 'gpt-4o', tokenParam: 'max_output_tokens' }, { tokenParam: 'max_tokens' }), {
      mode: 'auto',
      param: 'max_tokens',
    });
  });
});

describe('OpenaiService: token parameter sent to Chat Completions', { concurrency: true }, () => {
  test('sends the resolved parameter with maxTokens (500 when empty)', async () => {
    const t = setup({ bot: { model: `gpt-5-${nextId()}`, maxTokens: null } });
    t.openai.reply('ok');
    await t.ask();

    assert.equal(t.openai.requests.length, 1);
    assert.deepEqual(tokenKeys(t.openai.requests[0]), ['max_completion_tokens']);
    assert.equal(t.openai.requests[0].max_completion_tokens, 500);
  });

  test('auto: 400 Unsupported parameter retries once with the other one and learns it for the model', async () => {
    const t = setup();
    t.openai.reply(unsupportedParamError('max_tokens'), 'primeira resposta');
    await t.ask('oi');

    assert.equal(t.openai.requests.length, 2);
    assert.deepEqual(tokenKeys(t.openai.requests[0]), ['max_tokens']);
    assert.deepEqual(tokenKeys(t.openai.requests[1]), ['max_completion_tokens']);
    assert.equal(t.openai.requests[1].max_completion_tokens, 300);
    assert.deepEqual(texts(t.waInstance), ['primeira resposta']);

    // Learned: the next message goes straight to max_completion_tokens
    t.openai.reply('segunda resposta');
    await t.ask('tudo bem?');
    assert.equal(t.openai.requests.length, 3);
    assert.deepEqual(tokenKeys(t.openai.requests[2]), ['max_completion_tokens']);
    assert.deepEqual(texts(t.waInstance), ['primeira resposta', 'segunda resposta']);
  });

  test('forced mode: retries once but does not learn', async () => {
    const t = setup({ bot: { tokenParam: 'max_tokens' } });
    t.openai.reply(unsupportedParamError('max_tokens'), 'r1', unsupportedParamError('max_tokens'), 'r2');
    await t.ask('a');
    await t.ask('b');

    assert.deepEqual(
      t.openai.requests.map((request) => tokenKeys(request)[0]),
      ['max_tokens', 'max_completion_tokens', 'max_tokens', 'max_completion_tokens'],
    );
    assert.deepEqual(texts(t.waInstance), ['r1', 'r2']);
  });

  test('retry happens only once: a second rejection ends in the fallback, never in a loop', async () => {
    const t = setup();
    t.openai.reply(unsupportedParamError('max_tokens'), unsupportedParamError('max_completion_tokens'));
    await t.ask();

    assert.equal(t.openai.requests.length, 2);
    assert.deepEqual(texts(t.waInstance), [UNKNOWN]);
  });

  test('other 400 errors (or a rejection of the other parameter) are not retried', async () => {
    const t = setup();
    t.openai.reply(apiError(400, "The model 'gpt-x' does not exist"));
    await t.ask();
    assert.equal(t.openai.requests.length, 1);

    t.openai.reply(unsupportedParamError('max_completion_tokens'));
    await t.ask();
    assert.equal(t.openai.requests.length, 2, 'param in the error is not the one that was sent');
    assert.deepEqual(texts(t.waInstance), [UNKNOWN, UNKNOWN]);
  });

  test('errors without `param` are recognised by the message (axios-like shape too)', async () => {
    const t = setup();
    const plain = Object.assign(new Error("400 Unsupported value: 'max_tokens' does not support this model"), {
      status: 400,
    });
    const axiosLike = {
      message: 'Request failed',
      response: { status: 400, data: { error: { param: 'max_tokens', message: 'Unsupported parameter' } } },
    };
    t.openai.reply(plain, 'ok 1');
    await t.ask();

    const t2 = setup();
    t2.openai.reply(axiosLike as any, 'ok 2');
    await t2.ask();

    assert.equal(t.openai.requests.length, 2);
    assert.equal(t2.openai.requests.length, 2);
    assert.deepEqual([...texts(t.waInstance), ...texts(t2.waInstance)], ['ok 1', 'ok 2']);
  });
});

describe('OpenaiService: errors never reach the customer', { concurrency: true }, () => {
  const errorMessage = 'Incorrect API key provided: sk-proj-SECRET';

  test('OpenAI error: only unknownMessage is sent, never the raw error', async () => {
    const t = setup();
    const logged: string[] = [];
    t.service.logger.error = (value: any) => void logged.push(String(value));
    t.openai.reply(apiError(401, errorMessage));
    await t.ask();

    assert.deepEqual(texts(t.waInstance), [UNKNOWN]);
    assert.ok(!JSON.stringify(t.waInstance.sent).includes('SECRET'));
    assert.ok(
      logged.some((line) => line.includes('Incorrect API key')),
      'the error is logged in full',
    );
  });

  for (const unknownMessage of ['', '   ', null, undefined]) {
    test(`unknownMessage ${JSON.stringify(unknownMessage)}: nothing is sent`, async () => {
      const t = setup({ settings: { unknownMessage } });
      t.openai.reply(apiError(500, errorMessage));
      await t.ask();
      assert.deepEqual(t.waInstance.sent, []);
    });
  }

  test('empty completion (reasoning model out of tokens) is an error, not an empty or "undefined" message', async () => {
    const t = setup();
    t.openai.reply(() => t.openai.completion(null, 'length'));
    await t.ask();
    assert.deepEqual(texts(t.waInstance), [UNKNOWN]);
  });

  test('unknownMessage is not sent when the session was paused or removed meanwhile', async () => {
    const t = setup();
    t.openai.reply(() => {
      t.prisma.sessions.get(t.session.id).status = 'paused';
      throw apiError(500, errorMessage);
    });
    await t.ask();
    assert.deepEqual(t.waInstance.sent, []);

    const t2 = setup();
    t2.openai.reply(() => {
      t2.prisma.sessions.delete(t2.session.id);
      throw apiError(500, errorMessage);
    });
    await t2.ask();
    assert.deepEqual(t2.waInstance.sent, []);
  });

  test('assistant run that does not complete ends in the fallback', async () => {
    const t = setup({
      bot: { botType: 'assistant', assistantId: 'asst_1' },
      session: { sessionId: 'thread_existing' },
    });
    t.openai.beta.threads.runs.retrieve = async () => ({ status: 'failed', last_error: { message: errorMessage } });
    await t.ask();
    assert.deepEqual(texts(t.waInstance), [UNKNOWN]);
  });

  test('audio that cannot be transcribed ends in the fallback (no network call)', async () => {
    const t = setup();
    await t.ask('audioMessage|MSGID', { key: { id: 'MSGID' }, message: { audioMessage: {} } });
    assert.deepEqual(texts(t.waInstance), [UNKNOWN]);
    assert.equal(t.openai.requests.length, 0);
  });
});

describe('OpenaiService: images', { concurrency: true }, () => {
  const PNG = Buffer.from('fake-png-bytes').toString('base64');

  const lastUserContent = (t: ReturnType<typeof setup>) => t.openai.requests.at(-1).messages.at(-1).content;

  test('base64 in the payload (data URL prefix) is sent as a data URL with its mimetype and the caption', async () => {
    const t = setup();
    const msg = imageMsg(REMOTE_JID, { caption: 'olha isso', base64: `data:image/png;base64,${PNG}` });
    await t.ask(`imageMessage|${msg.key.id}|olha isso`, msg);

    assert.deepEqual(lastUserContent(t), [
      { type: 'text', text: 'olha isso' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
    ]);
  });

  test('bare base64 uses the declared mimetype; no caption means no text part', async () => {
    const t = setup();
    const msg = imageMsg(REMOTE_JID, { base64: PNG, mimetype: 'image/webp; codecs=x' });
    await t.ask(`imageMessage|${msg.key.id}`, msg);
    assert.deepEqual(lastUserContent(t), [{ type: 'image_url', image_url: { url: `data:image/webp;base64,${PNG}` } }]);
  });

  test('downloads through the channel when the payload has no base64', async () => {
    const t = setup();
    t.waInstance.media = { base64: PNG, mimetype: 'image/png' };
    const msg = imageMsg(REMOTE_JID);
    await t.ask(`imageMessage|${msg.key.id}`, msg);
    assert.deepEqual(lastUserContent(t), [{ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } }]);
  });

  test('image that cannot be obtained: text only with a note, the flow goes on', async () => {
    const t = setup();
    t.waInstance.media = new Error('media expired');
    const msg = imageMsg(REMOTE_JID, { caption: 'meu documento' });
    await t.ask(`imageMessage|${msg.key.id}|meu documento`, msg);

    assert.deepEqual(lastUserContent(t), [{ type: 'text', text: 'meu documento\n[imagem não pôde ser processada]' }]);
    assert.equal(texts(t.waInstance).length, 1, 'the answer is still sent');
  });

  test('history never stores base64: images become a placeholder, old image blocks are stripped', async () => {
    const legacyHistory = [
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://mmg.whatsapp.net/expired' } }] },
      { role: 'assistant', content: 'resposta antiga' },
    ];
    const t = setup({ session: { context: JSON.stringify({ history: legacyHistory }) } });
    const msg = imageMsg(REMOTE_JID, { caption: 'nova', base64: PNG });
    await t.ask(`imageMessage|${msg.key.id}|nova`, msg);

    const sentMessages = t.openai.requests[0].messages;
    assert.ok(!JSON.stringify(sentMessages.slice(0, -1)).includes('mmg.whatsapp.net'), 'old image block stripped');
    assert.deepEqual(sentMessages.at(-3).content, [{ type: 'text', text: '[imagem]' }]);

    const saved = JSON.parse(t.prisma.sessions.get(t.session.id).context);
    assert.ok(!JSON.stringify(saved).includes(PNG), 'no base64 in session.context');
    assert.deepEqual(saved.history.at(-2).content, [
      { type: 'text', text: 'nova' },
      { type: 'text', text: '[imagem]' },
    ]);
  });

  test('assistant mode uploads the image as a vision file', async () => {
    const t = setup({ bot: { botType: 'assistant', assistantId: 'asst_1' }, session: { sessionId: 'thread_1' } });
    const uploads: any[] = [];
    const threadMessages: any[] = [];
    t.openai.files.create = async (params: any) => {
      uploads.push(params);
      return { id: 'file-123' };
    };
    t.openai.beta.threads.messages.create = async (_thread: string, data: any) => void threadMessages.push(data);
    t.openai.beta.threads.messages.list = async () => ({
      data: [{ content: [{ type: 'text', text: { value: 'vi a imagem' } }] }],
    });

    const msg = imageMsg(REMOTE_JID, { base64: PNG, mimetype: 'image/png' });
    await t.ask(`imageMessage|${msg.key.id}`, msg);

    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].purpose, 'vision');
    assert.deepEqual(threadMessages[0].content, [
      { type: 'text', text: '[imagem]' },
      { type: 'image_file', image_file: { file_id: 'file-123' } },
    ]);
    assert.deepEqual(texts(t.waInstance), ['vi a imagem']);
  });
});

describe('OpenaiService: sending', { concurrency: true }, () => {
  test('every part sent by the bot is flagged fromChatbot (so its echo is never taken for a human)', async () => {
    const t = setup({ settings: { splitMessages: true } });
    t.openai.reply('Parte 1\n\nParte 2 ![foto](https://example.test/foto.png)');
    await t.ask();

    assert.deepEqual(
      t.waInstance.sent.map((s) => [s.kind, s.fromChatbot]),
      [
        ['text', true],
        ['text', true],
        ['media', true],
      ],
    );
    assert.equal(t.waInstance.sent[2].data.media, 'https://example.test/foto.png');
  });

  test('a late answer is discarded when a human wrote meanwhile, and the session stays paused', async () => {
    const t = setup();
    t.openai.reply(() => {
      // The owner answers while the model is still thinking (pause written by the controller)
      Object.assign(t.prisma.sessions.get(t.session.id), {
        status: 'paused',
        parameters: { humanLastMessageAt: new Date().toISOString() },
      });
      return t.openai.completion('resposta tardia');
    });
    await t.ask();

    assert.deepEqual(t.waInstance.sent, []);
    assert.equal(t.prisma.sessions.get(t.session.id).status, 'paused');
  });

  test('a session reopened by a race after the human wrote is put back to paused', async () => {
    const t = setup();
    t.openai.reply(() => {
      Object.assign(t.prisma.sessions.get(t.session.id), {
        status: 'opened',
        parameters: { humanLastMessageAt: new Date().toISOString() },
      });
      return t.openai.completion('resposta tardia');
    });
    await t.ask();

    assert.deepEqual(t.waInstance.sent, []);
    assert.equal(t.prisma.sessions.get(t.session.id).status, 'paused');
  });

  test('a paused session reaching process() is not answered', async () => {
    const t = setup({ session: { status: 'paused', parameters: { humanLastMessageAt: new Date().toISOString() } } });
    await t.ask();
    assert.equal(t.openai.requests.length, 0);
    assert.deepEqual(t.waInstance.sent, []);
  });
});

describe('OpenaiService: presence after the bot turn (#2469/#2537)', { concurrency: true }, () => {
  const states = (t: ReturnType<typeof setup>) => t.waInstance.presence.map((p: any) => p.state);

  test('alwaysOnline off: "unavailable" once, after the last "paused" of the answer', async () => {
    const t = setup({ settings: { splitMessages: true } });
    t.waInstance.localSettings = { alwaysOnline: false };
    t.openai.reply('parte 1\n\nparte 2');
    await t.ask();

    assert.deepEqual(texts(t.waInstance), ['parte 1', 'parte 2']);
    const sequence = states(t);
    assert.equal(sequence.filter((s: string) => s === 'unavailable').length, 1);
    assert.equal(sequence.at(-1), 'unavailable');
    assert.equal(sequence.at(-2), 'paused');
    assert.equal(t.waInstance.presence.at(-1).jid, undefined, 'a global presence, not a chat state');
  });

  test('also after the fallback and after a discarded answer', async () => {
    const failing = setup();
    failing.openai.reply(apiError(500, 'boom'));
    await failing.ask();
    assert.deepEqual(texts(failing.waInstance), [UNKNOWN]);
    assert.equal(states(failing).at(-1), 'unavailable');

    const discarded = setup();
    discarded.openai.reply(() => {
      Object.assign(discarded.prisma.sessions.get(discarded.session.id), {
        status: 'paused',
        parameters: { humanLastMessageAt: new Date().toISOString() },
      });
      return discarded.openai.completion('resposta tardia');
    });
    await discarded.ask();
    assert.deepEqual(discarded.waInstance.sent, []);
    assert.equal(states(discarded).at(-1), 'unavailable');
  });

  test('alwaysOnline on: never "unavailable"', async () => {
    const t = setup();
    t.waInstance.localSettings = { alwaysOnline: true };
    await t.ask();

    assert.equal(texts(t.waInstance).length, 1);
    assert.ok(!states(t).includes('unavailable'));
  });

  test('Cloud API: no presence at all', async () => {
    const t = setup();
    t.waInstance.integration = 'WHATSAPP-BUSINESS';
    await t.ask();

    assert.equal(texts(t.waInstance).length, 1);
    assert.deepEqual(states(t), []);
  });

  test('a failing "unavailable" never affects the answer', async () => {
    const t = setup();
    t.waInstance.client.sendPresenceUpdate = async (state: string) => {
      if (state === 'unavailable') throw new Error('Connection Closed');
    };
    await t.ask();

    assert.deepEqual(texts(t.waInstance), ['resposta 1']);
  });
});
