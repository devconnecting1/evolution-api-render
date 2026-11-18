import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  closestSupportedLevel,
  isReasoningEffortError,
  isToolsWithReasoningError,
  normalizeReasoningEffort,
  reasoningProfile,
  resolveReasoningEffort,
} from '@api/integrations/chatbot/openai/reasoning-effort';
import { OpenaiService } from '@api/integrations/chatbot/openai/services/openai.service';
import { configService } from '@config/env.config';
import OpenAI from 'openai';

import { createFakeOpenai, createFakeWaInstance, nextId, texts, useFakeOpenai } from '../helpers/fakes';
import { createPrismaMock } from '../helpers/prisma-mock';

const REMOTE_JID = '5521900000002@s.whatsapp.net';

function setup(options: { bot?: Record<string, any>; settings?: Record<string, any> } = {}) {
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
  };
  const prisma = createPrismaMock([session]);
  const service: any = new OpenaiService({ waInstances: { unit: waInstance } } as any, prisma, configService);
  const openai = createFakeOpenai();
  useFakeOpenai(service, openai);
  const bot: any = {
    id: nextId('bot'),
    botType: 'chatCompletion',
    openaiCredsId: 'creds-1',
    model: 'gpt-6-luna',
    maxTokens: 8000,
    tokenParam: null,
    reasoningEffort: null,
    systemMessages: ['Você é a assistente do escritório.'],
    assistantMessages: [],
    userMessages: [],
    ...options.bot,
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
  const ask = (content: string) =>
    service.process(
      waInstance,
      REMOTE_JID,
      bot,
      structuredClone(prisma.sessions.get(session.id)),
      settings,
      content,
      'Cliente',
    );
  return { openai, waInstance, ask };
}

const effortError = (value: string) =>
  OpenAI.APIError.generate(
    400,
    {
      error: {
        message: `Unsupported value: 'reasoning_effort' does not support '${value}' with this model.`,
        type: 'invalid_request_error',
        param: 'reasoning_effort',
        code: 'unsupported_value',
      },
    },
    undefined,
    new Headers(),
  );

const toolsEffortError = (model: string) =>
  OpenAI.APIError.generate(
    400,
    {
      error: {
        message:
          `Function tools with reasoning_effort are not supported for ${model} in /v1/chat/completions. ` +
          "To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
        type: 'invalid_request_error',
        param: 'reasoning_effort',
        code: null,
      },
    },
    undefined,
    new Headers(),
  );

describe('reasoning effort: levels per model (official model pages)', () => {
  test('gpt-6-luna and gpt-6-sol: none..max, default medium, tools only with none', () => {
    for (const model of ['gpt-6-luna', 'gpt-6-sol', 'GPT-6-Luna', 'ft:gpt-6-luna:org::abc', 'gpt-6-luna-2026-09-22']) {
      assert.deepEqual(
        reasoningProfile(model),
        { levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultLevel: 'medium', toolsOnlyWithNone: true },
        model,
      );
    }
  });

  test('other families', () => {
    assert.deepEqual(reasoningProfile('gpt-6.1-sol')?.levels, ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.deepEqual(reasoningProfile('gpt-6-astra')?.levels, ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.equal(reasoningProfile('gpt-6.1-terra')?.levels.includes('none'), true);
    assert.equal(reasoningProfile('gpt-5.5')?.defaultLevel, 'medium');
    assert.deepEqual(reasoningProfile('gpt-5.4-mini'), {
      levels: ['none', 'low', 'medium', 'high', 'xhigh'],
      defaultLevel: 'none',
      toolsOnlyWithNone: true,
    });
    assert.deepEqual(reasoningProfile('gpt-5.1')?.levels, ['none', 'low', 'medium', 'high']);
    assert.deepEqual(reasoningProfile('gpt-5-mini')?.levels, ['minimal', 'low', 'medium', 'high']);
    assert.deepEqual(reasoningProfile('o4-mini')?.levels, ['low', 'medium', 'high']);
    for (const model of ['gpt-4o', 'gpt-4.1-mini', 'gpt-5-chat-latest', '', null, undefined]) {
      assert.equal(reasoningProfile(model as any), null, String(model));
    }
  });

  test('normalize and closest level', () => {
    assert.equal(normalizeReasoningEffort('auto'), null);
    assert.equal(normalizeReasoningEffort(null), null);
    assert.equal(normalizeReasoningEffort(' HIGH '), 'high');
    assert.equal(normalizeReasoningEffort('ultra'), null);
    assert.equal(closestSupportedLevel('minimal', ['none', 'low', 'medium']), 'low');
    assert.equal(closestSupportedLevel('none', ['low', 'medium', 'high']), 'low');
    assert.equal(closestSupportedLevel('max', ['none', 'low', 'medium', 'high', 'xhigh']), 'xhigh');
  });

  test('resolve: automatic, chosen, unsupported and tools', () => {
    assert.deepEqual(resolveReasoningEffort('gpt-6-luna', null), { effective: 'medium' });
    assert.deepEqual(resolveReasoningEffort('gpt-6-luna', 'high'), { send: 'high', effective: 'high' });
    assert.deepEqual(resolveReasoningEffort('gpt-5.4-mini', 'max'), {
      send: 'xhigh',
      effective: 'xhigh',
      adjusted: 'unsupported',
    });
    assert.deepEqual(resolveReasoningEffort('gpt-6-luna', 'high', true), {
      send: 'none',
      effective: 'none',
      adjusted: 'tools',
    });
    assert.deepEqual(resolveReasoningEffort('gpt-6-luna', 'none', true), { send: 'none', effective: 'none' });
    assert.deepEqual(resolveReasoningEffort('gpt-5.4-mini', 'high', true), {
      send: 'none',
      effective: 'none',
      adjusted: 'tools',
    });
    assert.deepEqual(resolveReasoningEffort('gpt-5.2', 'high', true), { send: 'high', effective: 'high' });
    assert.deepEqual(resolveReasoningEffort('gpt-4o', 'high', true), { effective: null });
  });

  test('tools only with none (measured in the API on 18/11/2026)', () => {
    for (const model of ['gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-terra', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']) {
      assert.equal(reasoningProfile(model)?.toolsOnlyWithNone, true, model);
    }
    for (const model of ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano']) {
      assert.equal(reasoningProfile(model)?.toolsOnlyWithNone, true, model);
    }
    for (const model of ['gpt-5.2', 'gpt-5.1', 'gpt-5-mini', 'gpt-5-nano', 'o3', 'gpt-6-astra', 'gpt-6.1-sol']) {
      assert.equal(reasoningProfile(model)?.toolsOnlyWithNone, false, model);
    }
    assert.deepEqual(resolveReasoningEffort('gpt-5.6-luna', 'high', true), {
      send: 'none',
      effective: 'none',
      adjusted: 'tools',
    });
    assert.deepEqual(resolveReasoningEffort('gpt-5.6-luna', 'high', false), { send: 'high', effective: 'high' });
  });

  test('isToolsWithReasoningError', () => {
    assert.equal(isToolsWithReasoningError(toolsEffortError('gpt-6-luna')), true);
    assert.equal(isToolsWithReasoningError(effortError('max')), false);
    assert.equal(isToolsWithReasoningError({ status: 400, message: 'tools is not supported with this model' }), false);
    assert.equal(isToolsWithReasoningError({ status: 500, message: 'Function tools with reasoning_effort' }), false);
  });

  test('isReasoningEffortError', () => {
    assert.equal(isReasoningEffortError(effortError('max')), true);
    assert.equal(isReasoningEffortError({ status: 400, message: 'Unsupported parameter: max_tokens' }), false);
    assert.equal(isReasoningEffortError({ status: 500, param: 'reasoning_effort' }), false);
  });
});

describe('reasoning effort: request sent to Chat Completions', { concurrency: true }, () => {
  test('automatic: the parameter is left out (model default)', async () => {
    const t = setup();
    t.openai.reply('ok');
    await t.ask('oi');
    assert.equal('reasoning_effort' in t.openai.requests[0], false);
  });

  test('chosen level is sent', async () => {
    const t = setup({ bot: { reasoningEffort: 'high' } });
    t.openai.reply('ok');
    await t.ask('oi');
    assert.equal(t.openai.requests[0].reasoning_effort, 'high');
    assert.equal(t.openai.requests[0].max_completion_tokens, 8000);
  });

  test('models without reasoning never get it', async () => {
    const t = setup({ bot: { model: `gpt-4o-${nextId()}`, reasoningEffort: 'high' } });
    t.openai.reply('ok');
    await t.ask('oi');
    assert.equal('reasoning_effort' in t.openai.requests[0], false);
  });

  test('gpt-6-luna with tools (handoff): the request goes with none', async () => {
    const t = setup({ bot: { reasoningEffort: 'high' }, settings: { handoffTool: true } });
    t.openai.reply('ok');
    await t.ask('quero falar com o advogado');
    assert.ok(Array.isArray(t.openai.requests[0].tools) && t.openai.requests[0].tools.length > 0);
    assert.equal(t.openai.requests[0].reasoning_effort, 'none');
  });

  test('a 400 about reasoning_effort retries once without it and remembers the model', async () => {
    const model = `gpt-6-luna-${nextId()}`;
    const t = setup({ bot: { model, reasoningEffort: 'max' } });
    t.openai.reply(effortError('max'), 'primeira');
    await t.ask('oi');
    assert.equal(t.openai.requests.length, 2);
    assert.equal(t.openai.requests[0].reasoning_effort, 'max');
    assert.equal('reasoning_effort' in t.openai.requests[1], false);
    assert.deepEqual(texts(t.waInstance), ['primeira']);

    t.openai.reply('segunda');
    await t.ask('tudo bem?');
    assert.equal(t.openai.requests.length, 3);
    assert.equal('reasoning_effort' in t.openai.requests[2], false);
  });

  test('a model that refuses tools with a level is called again with none, keeps the level without tools', async () => {
    // gpt-5.2 is listed with tools at any level: a refusal is learned for that model only
    const model = `gpt-5.2-${nextId()}`;
    const t = setup({ bot: { model, reasoningEffort: 'high' }, settings: { handoffTool: true } });
    t.openai.reply(toolsEffortError(model), 'primeira');
    await t.ask('oi');
    assert.equal(t.openai.requests.length, 2);
    assert.equal(t.openai.requests[0].reasoning_effort, 'high');
    assert.equal(t.openai.requests[1].reasoning_effort, 'none');
    assert.ok(t.openai.requests[1].tools?.length > 0, 'the retry keeps the tools');
    assert.deepEqual(texts(t.waInstance), ['primeira']);

    t.openai.reply('segunda');
    await t.ask('tudo bem?');
    assert.equal(t.openai.requests.length, 3);
    assert.equal(t.openai.requests[2].reasoning_effort, 'none', 'learned: tools go with none at once');

    // Another bot of the same model without tools keeps its level (reasoning is not switched off for the model)
    const plain = setup({ bot: { model, reasoningEffort: 'high' } });
    plain.openai.reply('ok');
    await plain.ask('oi');
    assert.equal(plain.openai.requests[0].reasoning_effort, 'high');
  });

  test('a model without none (gpt-6.1-sol) answers without tools and keeps its level', async () => {
    const model = `gpt-6.1-sol-${nextId()}`;
    const t = setup({ bot: { model, reasoningEffort: 'high' }, settings: { handoffTool: true } });
    t.openai.reply(toolsEffortError(model), 'sem ferramentas');
    await t.ask('oi');
    assert.equal(t.openai.requests.length, 2);
    assert.ok(t.openai.requests[0].tools?.length > 0);
    assert.equal(t.openai.requests[1].tools, undefined);
    assert.equal(t.openai.requests[1].reasoning_effort, 'high');
    assert.deepEqual(texts(t.waInstance), ['sem ferramentas']);
  });
});
