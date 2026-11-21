import '../helpers/setup';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { handoffSystemPrompt, handoffTool } from '@api/integrations/chatbot/openai/handoff-ai';
import { ethicsSystemPrompt } from '@utils/ethics';
import { FRAUD_SAFETY_PROMPT, fraudSafetyPrompt } from '@utils/fraud-safety';
import { derivePriority, parseExtraction, URGENT_LABELS, URGENT_TYPES } from '@utils/leads';

// 20/11/2026: a client reported the "golpe do falso advogado" (Teams call, transfer already made). The AI gave no
// safety step and nobody was warned. These tests keep the three fixes in place.
describe('golpe: orientação de segurança, ficha urgente e transferência', () => {
  test('a regra de segurança traz os passos que protegem a pessoa e vale para qualquer perfil', () => {
    const text = fraudSafetyPrompt();
    assert.equal(text, FRAUD_SAFETY_PROMPT);
    for (const step of ['canal oficial', 'banco', 'MED', 'boletim de ocorrência', 'comprovantes', 'avisar a equipe']) {
      assert.ok(text.includes(step), `falta: ${step}`);
    }
    assert.match(text, /fora do horário/);
    assert.match(text, /não jurídica/);
    // no amount in the reply: the advocacia guard removes sentences with values in reais
    assert.match(text, /sem citar valores/);
  });

  test('o serviço manda a regra em toda resposta, logo depois das regras éticas e antes das instruções do cliente', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'src', 'api', 'integrations', 'chatbot', 'openai', 'services', 'openai.service.ts'),
      'utf8',
    );
    const ethics = source.indexOf("...(ethics ? [{ role: 'system', content: ethics }] : []),");
    const fraud = source.indexOf("{ role: 'system', content: fraudSafetyPrompt() },");
    const client = source.indexOf('...filled(openaiBot.systemMessages)');
    assert.ok(ethics > 0 && fraud > ethics && client > fraud);
  });

  test('o perfil de advocacia libera as orientações de segurança no caso de golpe', () => {
    assert.match(
      ethicsSystemPrompt('advocacia') as string,
      /Golpe relatado .* orientações de segurança são permitidas/,
    );
  });

  test('golpe é motivo de transferência para a equipe', () => {
    assert.match(handoffSystemPrompt(), /4\) golpe/);
    assert.match(handoffTool().function.description, /golpe/);
  });

  test('golpe com dinheiro ou dados deixa a ficha em prioridade alta, sem contagem de dias', () => {
    assert.ok((URGENT_TYPES as readonly string[]).includes('golpe'));
    assert.ok(URGENT_LABELS.golpe);
    const fact = 'transferiu após ligação pelo Teams em nome do advogado';
    const now = new Date('2026-11-21T12:00:00Z');
    assert.deepEqual(
      derivePriority({ urgentType: 'golpe', urgentFact: fact, urgentDate: '2026-11-19', noLegalNeed: false }, {}, now),
      { priority: 'alta', priorityReason: `Golpe: ${fact}` },
    );
    // already solved by the client (the bank returned the money): normal, but visible
    assert.equal(
      derivePriority({ urgentType: 'golpe', urgentFact: fact, urgentResolved: true, noLegalNeed: false }, {}, now)
        .priority,
      'normal',
    );
    // the model can return the new type
    const parsed = parseExtraction(JSON.stringify({ urgentType: 'golpe', urgentFact: fact }), []);
    assert.equal(parsed?.urgentType, 'golpe');
  });
});
