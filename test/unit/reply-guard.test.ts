import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  analyzeReply,
  dropRepeatedWithin,
  FALLBACK_ACKNOWLEDGEMENT,
  guardReply,
  isQuestion,
  keepLastQuestion,
  limitLength,
  MAX_REPLY_CHARS,
  policyIssues,
  splitSentences,
} from '@api/integrations/chatbot/openai/reply-guard';

describe('reply guard: repetition', () => {
  test('the same question asked again after the customer answered is detected (rephrased too)', () => {
    const previous = ['Entendi. Qual o nome do seu plano de saúde?'];
    for (const candidate of [
      'Qual o nome do seu plano de saúde?',
      'Poderia me informar o nome do plano de saúde?',
      'Certo! E qual é o nome do plano de saúde?',
    ]) {
      const issues = analyzeReply(candidate, previous);
      assert.ok(
        issues.some((issue) => issue.kind === 'repeated_question'),
        candidate,
      );
    }
  });

  test('the very same short question is a repetition too', () => {
    const issues = analyzeReply('Certo. Como você se chama?', ['Certo. Como você se chama?']);
    assert.deepEqual(
      issues.map((issue) => issue.kind),
      ['repeated_question'],
    );
  });

  test('a different question is not a repetition', () => {
    const previous = ['Qual o nome do seu plano de saúde?'];
    assert.deepEqual(analyzeReply('Em qual cidade você mora?', previous), []);
    assert.deepEqual(analyzeReply('Quando o plano negou a cirurgia?', previous), []);
  });

  test('a repeated statement ("vou sinalizar como urgente") is detected; short courtesies are not', () => {
    const previous = ['Vou sinalizar o seu caso como urgente para a equipe.', 'Entendi.', 'Obrigado!'];
    const issues = analyzeReply(
      'Certo. Vou sinalizar o seu caso como urgente para a equipe. Entendi. Obrigado!',
      previous,
    );
    assert.deepEqual(
      issues.map((issue) => issue.kind),
      ['repeated_sentence'],
    );
  });

  test('regenerates once with the repeated sentence in the instruction, then uses the new text', async () => {
    const instructions: string[] = [];
    const result = await guardReply({
      candidate: 'Qual o nome do seu plano de saúde?',
      previousReplies: ['Qual o nome do seu plano de saúde?'],
      regenerate: async (instruction) => {
        instructions.push(instruction);
        return 'Certo, plano Assim. Em qual cidade você mora?';
      },
    });
    assert.equal(instructions.length, 1);
    assert.match(instructions[0], /Não diga nem pergunte de novo: "Qual o nome do seu plano de saúde\?"/);
    assert.equal(result.text, 'Certo, plano Assim. Em qual cidade você mora?');
    assert.equal(result.regenerated, true);
  });

  test('still repeating after the regeneration: the repeated sentence is removed', async () => {
    const result = await guardReply({
      candidate: 'Anotei as informações. Qual o nome do seu plano de saúde?',
      previousReplies: ['Qual o nome do seu plano de saúde?'],
      regenerate: async () => 'Anotei as informações. Qual o nome do seu plano de saúde?',
    });
    assert.equal(result.text, 'Anotei as informações.');
    assert.deepEqual(result.removed, ['Qual o nome do seu plano de saúde?']);
  });

  test('nothing left: a short acknowledgement, never an empty message', async () => {
    const result = await guardReply({
      candidate: 'Qual o nome do seu plano de saúde?',
      previousReplies: ['Qual o nome do seu plano de saúde?'],
    });
    assert.equal(result.text, FALLBACK_ACKNOWLEDGEMENT);
    assert.equal(FALLBACK_ACKNOWLEDGEMENT, 'Certo, entendi. Vou passar isso para a equipe.');
    assert.doesNotMatch(FALLBACK_ACKNOWLEDGEMENT, /obrigad[oa]/i, 'neutral: no gendered word');
    assert.equal(result.fallback, true);
  });

  test('never the same message as an earlier reply, even when only a short sentence is left', async () => {
    const previous = ['Está tudo anotado. A equipe vai falar com você em breve.', 'Está tudo anotado.'];
    const result = await guardReply({
      candidate: 'Está tudo anotado. A equipe vai falar com você em breve.',
      previousReplies: previous,
    });
    assert.equal(result.text, FALLBACK_ACKNOWLEDGEMENT);
    const again = await guardReply({
      candidate: 'Está tudo anotado.',
      previousReplies: [...previous, FALLBACK_ACKNOWLEDGEMENT],
    });
    assert.equal(again.text, 'Combinado!');
  });

  test('a regeneration that fails keeps the first candidate (minus repetitions)', async () => {
    const result = await guardReply({
      candidate: 'Anotado. Qual o nome do seu plano de saúde?',
      previousReplies: ['Qual o nome do seu plano de saúde?'],
      regenerate: async () => {
        throw new Error('timeout');
      },
    });
    assert.equal(result.text, 'Anotado.');
    assert.equal(result.regenerated, false);
  });
});

describe('reply guard: policy (internal notes, advocacia)', () => {
  test('internal notes and the ad text are never mentioned, with or without a profile', () => {
    for (const sentence of [
      'Vi o texto que veio junto com a sua mensagem.',
      'Pelo rascunho, o assunto é energia.',
      'Segundo a nota interna, hoje é segunda.',
    ]) {
      assert.ok(
        policyIssues(sentence, {}).some((issue) => issue.kind === 'internal_note'),
        sentence,
      );
    }
  });

  test('advocacia: fees, promises and legal opinions are flagged; questions about the case are not', () => {
    const advocacia = { advocacia: true };
    assert.ok(policyIssues('A consulta custa R$ 300.', advocacia).some((i) => i.kind === 'fees'));
    assert.ok(policyIssues('Os honorários são de 30% do valor.', advocacia).some((i) => i.kind === 'fees'));
    assert.ok(policyIssues('Pode ficar tranquila, a senhora vai ganhar.', advocacia).some((i) => i.kind === 'promise'));
    assert.ok(policyIssues('Você tem direito à indenização.', advocacia).some((i) => i.kind === 'legal_opinion'));

    assert.deepEqual(policyIssues('O advogado vai avaliar se você tem direito.', advocacia), []);
    assert.deepEqual(policyIssues('Em qual cidade você mora?', advocacia), []);
    assert.deepEqual(policyIssues('A consulta custa R$ 300.', {}), [], 'no profile: no fee rule');
  });
});

describe('reply guard: shape', () => {
  test('sentences and questions', () => {
    assert.deepEqual(splitSentences('Oi! Tudo bem? Sou a assistente.\nQual o seu nome?'), [
      'Oi!',
      'Tudo bem?',
      'Sou a assistente.',
      'Qual o seu nome?',
    ]);
    assert.equal(isQuestion('Qual o seu nome?'), true);
    assert.equal(isQuestion('Qual o seu nome.'), false);
  });

  test('dots inside numbers never split a sentence (OAB, money, process numbers)', () => {
    assert.deepEqual(
      splitSentences('O registro é OAB/RJ 000.000. Ficou R$ 1.500,00 e o nº 0001234-56.2026.8.19.0001?'),
      ['O registro é OAB/RJ 000.000.', 'Ficou R$ 1.500,00 e o nº 0001234-56.2026.8.19.0001?'],
    );
    assert.equal(
      keepLastQuestion('O registro é OAB/RJ 000.000. Qual o seu nome?').text,
      'O registro é OAB/RJ 000.000. Qual o seu nome?',
    );
  });

  test('at most one question: the last one is kept', () => {
    const { text, trimmed } = keepLastQuestion('Entendi. Qual o seu nome? E a sua cidade? Qual o assunto?');
    assert.equal(text, 'Entendi. Qual o assunto?');
    assert.equal(trimmed, 2);
  });

  test('a follow-up question keeps its main question ("Se sim, ..."), never alone', () => {
    assert.equal(keepLastQuestion('O bebê já nasceu? Se sim, em que mês?').text, 'O bebê já nasceu?');
    assert.equal(keepLastQuestion('Qual o seu nome? Em qual cidade? Caso não, tudo bem?').text, 'Em qual cidade?');
  });

  test('a sentence said twice in the same reply is kept once', () => {
    const sentence = 'Vou explicar com calma como funciona o atendimento do escritório.';
    const { text, removed } = dropRepeatedWithin(`${sentence} ${sentence} ${sentence} Qual o seu nome?`);
    assert.equal(text, `${sentence} Qual o seu nome?`);
    assert.equal(removed, 2);
  });

  test('long replies are cut at a sentence boundary and keep the question', () => {
    const long = `${'Esta é uma frase de explicação bem comprida. '.repeat(30)}Em qual cidade você mora?`;
    const { text, truncated } = limitLength(long);
    assert.equal(truncated, true);
    assert.ok(text.length <= MAX_REPLY_CHARS);
    assert.ok(text.endsWith('Em qual cidade você mora?'));
  });
});
