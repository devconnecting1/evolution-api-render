import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { botModelList, isBotChatModel, modelLabel } from '@api/integrations/chatbot/openai/openai-models';

describe('OpenAI models for the bot (panel list)', () => {
  test('only chat models the bot can call', () => {
    for (const id of [
      'gpt-6-luna',
      'gpt-6.1-sol',
      'gpt-5.4-mini',
      'gpt-4o',
      'o3',
      'chat-latest',
      'ft:gpt-6-luna:org::x',
    ]) {
      assert.equal(isBotChatModel(id), true, id);
    }
    for (const id of [
      'gpt-5.5-pro',
      'gpt-6-cyber',
      'gpt-transcribe',
      'whisper-1',
      'gpt-4o-mini-tts',
      'gpt-realtime-2',
      'gpt-image-2',
      'text-embedding-3-small',
      'gpt-5-search-api',
      'gpt-5.3-codex',
      'gpt-audio-mini',
      'gpt-live-1',
      'ft:gpt-4o-mini-transcribe:org::x',
    ]) {
      assert.equal(isBotChatModel(id), false, id);
    }
  });

  test('labels: recommendation, price compared to Luna, shutdown date', () => {
    assert.equal(modelLabel('gpt-6-luna'), 'gpt-6-luna · recomendado · o mais barato');
    assert.equal(modelLabel('gpt-6-astra'), 'gpt-6-astra · o mais capaz · 100× o preço do Luna');
    assert.equal(
      modelLabel('gpt-4o-mini-2024-07-18'),
      'gpt-4o-mini-2024-07-18 · descontinuado, desliga em 14/01/2027 (use gpt-6-luna)',
    );
    assert.equal(modelLabel('gpt-5.1'), 'gpt-5.1');
  });

  test('list: snapshots folded into their alias, recommended first, deprecated last', () => {
    const list = botModelList(
      [
        'gpt-4o-mini',
        'gpt-4o-mini-2024-07-18',
        'gpt-6-astra',
        'whisper-1',
        'gpt-5.1',
        'gpt-6-luna',
        'gpt-5.4-mini-2026-03-17',
        'gpt-5.5-pro',
        'gpt-6.1-terra',
      ].map((id) => ({ id, object: 'model' })),
    );
    assert.deepEqual(
      list.map((m) => m.id),
      ['gpt-6-luna', 'gpt-5.4-mini-2026-03-17', 'gpt-6.1-terra', 'gpt-6-astra', 'gpt-5.1', 'gpt-4o-mini'],
    );
    assert.equal(list[0].recommended, true);
    assert.equal(list.at(-1)!.status, 'deprecated');
    assert.equal((list.at(-1) as any).shutdown, '2027-01-14');
    assert.equal(list[0].object, 'model');
    assert.deepEqual(botModelList(undefined), []);
  });
});
