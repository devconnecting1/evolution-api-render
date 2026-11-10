import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { LeadsConflictError, LeadsService, LeadsValidationError } from '@api/services/leads.service';
import {
  buildTranscript,
  csvCell,
  deriveAwaitingSince,
  deriveMissingInfo,
  derivePriority,
  detectSource,
  extractionJsonSchema,
  formatPhone,
  leadsToCsv,
  mergeExtraction,
  mergeLeadSettings,
  normalizeLeadSettings,
  notificationText,
  parseExtraction,
  scrubDocuments,
  shouldExtract,
  shouldNotify,
  suggestStatus,
  validateLeadPatch,
  validateLeadSettings,
  validateLeadSettingsInput,
} from '@utils/leads';

import { createFakeExtractor, createLeadsTables, extraction } from '../helpers/leads-mock';

const AREAS = ['Trabalhista', 'Previdenciário (BPC/INSS)', 'Família', 'Consumidor', 'Cível', 'Criminal', 'Outro'];
const HOUR = 3600_000;
// Every name, number and story below is fictional
const CLIENT = '5521900000001@s.whatsapp.net';

// ------------------------------------------------------------------------------------------------ rules

describe('Leads: trigger rules', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');

  test('needs 3 client messages', () => {
    assert.equal(shouldExtract({ clientMessages: 2, newClientMessages: 2, lead: null, now }).run, false);
    assert.equal(shouldExtract({ clientMessages: 3, newClientMessages: 3, lead: null, now }).run, true);
  });

  test('a lead never analysed (no lastExtractedAt) is analysed', () => {
    assert.equal(shouldExtract({ clientMessages: 3, newClientMessages: 0, lead: { status: 'novo' }, now }).run, true);
  });

  test('after an analysis, only 3 new client messages trigger another one', () => {
    const lead = { lastExtractedAt: new Date(now - HOUR), status: 'qualificado', statusSource: 'ai' };
    assert.equal(shouldExtract({ clientMessages: 10, newClientMessages: 2, lead, now }).run, false);
    assert.equal(shouldExtract({ clientMessages: 10, newClientMessages: 3, lead, now }).run, true);
  });

  test('a lead still "novo" by the AI after 24 h is analysed again with one new message', () => {
    const lead = { lastExtractedAt: new Date(now - 25 * HOUR), status: 'novo', statusSource: 'ai' };
    assert.equal(shouldExtract({ clientMessages: 5, newClientMessages: 1, lead, now }).run, true);
    assert.equal(shouldExtract({ clientMessages: 5, newClientMessages: 0, lead, now }).run, false);
    assert.equal(
      shouldExtract({ clientMessages: 5, newClientMessages: 1, lead: { ...lead, statusSource: 'manual' }, now }).run,
      false,
      'the team decided: no extra analysis',
    );
    assert.equal(
      shouldExtract({
        clientMessages: 5,
        newClientMessages: 1,
        lead: { ...lead, lastExtractedAt: new Date(now - HOUR) },
        now,
      }).run,
      false,
    );
  });
});

describe('Leads: parsing the model answer', () => {
  test('reads JSON in a code fence, maps the area and drops document numbers', () => {
    const parsed = parseExtraction(
      '```json\n' +
        JSON.stringify(
          extraction({
            name: '  Joana   Exemplo ',
            area: 'trabalhista',
            city: 'Cidade Fictícia - RJ',
            summary: 'Demitida sem receber verbas. CPF 123.456.789-09 e processo 0001234-56.2026.5.01.0001.',
            urgentType: 'audiencia',
            urgentFact: 'audiência em 12/11',
            missingInfo: ['data da demissão', 'data da demissão', 'tem contrato assinado?'],
            documentsMentioned: ['carteira de trabalho', 'RG 12345678'],
            opposingParty: 'Empresa Fictícia Ltda',
            hasLawyer: false,
          }),
        ) +
        '\n```',
      AREAS,
    );
    assert.ok(parsed);
    assert.equal(parsed.name, 'Joana Exemplo');
    assert.equal(parsed.area, 'Trabalhista');
    assert.equal(parsed.urgentType, 'audiencia');
    assert.equal(parsed.urgentFact, 'audiência em 12/11');
    assert.doesNotMatch(parsed.summary, /123\.456|0001234/);
    assert.match(parsed.summary, /\[número removido\]/);
    assert.deepEqual(parsed.missingInfo, ['data da demissão', 'tem contrato assinado?']);
    assert.deepEqual(parsed.documentsMentioned, ['carteira de trabalho', 'RG [número removido]']);
    assert.equal(parsed.hasLawyer, false);
  });

  test('unknown area becomes "Outro"; an urgent fact without a valid type is dropped; bad JSON is null', () => {
    const parsed = parseExtraction(
      JSON.stringify(extraction({ area: 'Tributário', urgentType: 'ansiedade', urgentFact: 'quer rápido' })),
      AREAS,
    );
    assert.equal(parsed.area, 'Outro');
    assert.equal(parsed.urgentType, null);
    assert.equal(parsed.urgentFact, null);
    assert.equal(parseExtraction('não sei', AREAS), null);
    assert.equal(parseExtraction('{"name": ', AREAS), null);
    assert.equal(parseExtraction('[1,2]', AREAS), null);
    assert.equal(parseExtraction(null, AREAS), null);
  });

  test('scrubDocuments keeps dates and short numbers', () => {
    assert.equal(
      scrubDocuments('audiência em 12/11/2026 às 14h, 3 filhos'),
      'audiência em 12/11/2026 às 14h, 3 filhos',
    );
    assert.equal(scrubDocuments('CNPJ 12.345.678/0001-90'), 'CNPJ [número removido]');
  });

  test('the JSON schema is strict, has no score and lists the areas', () => {
    const schema = extractionJsonSchema(['Trabalhista', 'Família']);
    assert.equal(schema.strict, true);
    assert.deepEqual(schema.schema.required.sort(), Object.keys(schema.schema.properties).sort());
    assert.equal('score' in schema.schema.properties, false);
    assert.deepEqual((schema.schema.properties.area as any).enum, ['Trabalhista', 'Família', 'Outro', null]);
  });
});

describe('Leads: transparent priority, status and missing information', () => {
  test('alta only with an explicit urgent fact, quoted as the reason', () => {
    assert.deepEqual(
      derivePriority({ urgentType: 'audiencia', urgentFact: 'audiência em 12/11', noLegalNeed: false }, {}),
      {
        priority: 'alta',
        priorityReason: 'audiência em 12/11',
      },
    );
    assert.equal(
      derivePriority({ urgentType: 'corte_beneficio', urgentFact: null, noLegalNeed: false }, {}).priorityReason,
      'corte ou suspensão de benefício, salário ou serviço',
    );
    assert.equal(
      derivePriority({ urgentType: null, urgentFact: null, noLegalNeed: false }, { area: 'Família' }).priority,
      'normal',
    );
  });

  test('baixa without legal need or outside the areas', () => {
    assert.equal(derivePriority({ urgentType: null, urgentFact: null, noLegalNeed: true }, {}).priority, 'baixa');
    assert.deepEqual(derivePriority({ urgentType: null, urgentFact: null, noLegalNeed: false }, { area: 'Outro' }), {
      priority: 'baixa',
      priorityReason: 'Assunto fora das áreas do escritório',
    });
  });

  test('qualificado with name + area + (city or clear need), never for "Outro" or no legal need', () => {
    assert.equal(suggestStatus({ name: 'A', area: 'Família', city: 'X' }, false), 'qualificado');
    assert.equal(suggestStatus({ name: 'A', area: 'Família' }, true), 'qualificado');
    assert.equal(suggestStatus({ name: 'A', area: 'Família' }, false), 'novo');
    assert.equal(suggestStatus({ name: 'A', area: 'Outro', city: 'X' }, true), 'novo');
    assert.equal(suggestStatus({ area: 'Família', city: 'X' }, true), 'novo');
    assert.equal(suggestStatus({ name: 'A', area: 'Família', city: 'X' }, true, true), 'novo');
  });

  test('missing info lists the basic fields first, without what is known', () => {
    assert.deepEqual(deriveMissingInfo({ name: 'A' }, ['cidade', 'data do fato', 'nome']), [
      'área do direito',
      'cidade',
      'data do fato',
    ]);
    assert.deepEqual(deriveMissingInfo({ name: 'A', area: 'Cível', city: 'X' }, ['nome', 'cidade']), []);
  });

  test('merge: a manual status and locked fields are never overridden; null keeps what was known', () => {
    const lead = {
      status: 'em_atendimento',
      statusSource: 'manual',
      name: 'Nome da Equipe',
      city: 'Cidade A',
      area: 'Família',
      manualFields: ['status', 'name'],
      documentsMentioned: ['contrato'],
    };
    const merged = mergeExtraction(
      lead,
      parseExtraction(
        JSON.stringify(
          extraction({
            name: 'Outro Nome',
            city: null,
            area: 'Cível',
            clearNeed: true,
            documentsMentioned: ['contrato', 'recibo'],
          }),
        ),
        AREAS,
      ),
    );
    assert.equal(merged.status, 'em_atendimento');
    assert.equal(merged.name, 'Nome da Equipe');
    assert.equal(merged.city, 'Cidade A');
    assert.equal(merged.area, 'Cível');
    assert.deepEqual(merged.documentsMentioned, ['contrato', 'recibo']);
  });

  test('merge: the AI only moves novo -> qualificado (never downgrades) and keeps a team priority', () => {
    const base = parseExtraction(JSON.stringify(extraction({ name: 'A', area: 'Família', city: 'X' })), AREAS);
    assert.equal(mergeExtraction(null, base).status, 'qualificado');
    assert.equal(
      mergeExtraction({ status: 'qualificado' }, parseExtraction(JSON.stringify(extraction()), AREAS)).status,
      'qualificado',
    );
    const locked = mergeExtraction(
      { priority: 'alta', priorityReason: 'Definida pela equipe', manualFields: ['priority'] },
      parseExtraction(JSON.stringify(extraction({ noLegalNeed: true })), AREAS),
    );
    assert.equal(locked.priority, 'alta');
    assert.equal(locked.priorityRank, 0);
    assert.equal(locked.priorityReason, 'Definida pela equipe');
  });
});

describe('Leads: awaiting the team', () => {
  const t = (iso: string) => new Date(iso);
  const base = {
    status: 'qualificado',
    priority: 'normal',
    current: null,
    lastHumanReplyAt: null,
    clientTimes: [] as number[],
  };

  test('an open actionable lead waits since the last client message when nobody replied', () => {
    const since = deriveAwaitingSince({ ...base, lastClientAt: t('2026-11-04T10:00:00Z') });
    assert.equal(since?.toISOString(), '2026-11-04T10:00:00.000Z');
  });

  test('a start already recorded is kept', () => {
    const since = deriveAwaitingSince({
      ...base,
      current: t('2026-11-04T08:00:00Z'),
      lastClientAt: t('2026-11-04T10:00:00Z'),
    });
    assert.equal(since?.toISOString(), '2026-11-04T08:00:00.000Z');
  });

  test('a human reply after the client message ends the wait; a new client message restarts it after the reply', () => {
    assert.equal(
      deriveAwaitingSince({
        ...base,
        lastHumanReplyAt: t('2026-11-04T11:00:00Z'),
        lastClientAt: t('2026-11-04T10:00:00Z'),
      }),
      null,
    );
    const since = deriveAwaitingSince({
      ...base,
      current: t('2026-11-04T08:00:00Z'),
      lastHumanReplyAt: t('2026-11-04T11:00:00Z'),
      lastClientAt: t('2026-11-04T12:30:00Z'),
      clientTimes: [
        Date.parse('2026-11-04T07:00:00Z'),
        Date.parse('2026-11-04T12:00:00Z'),
        Date.parse('2026-11-04T12:30:00Z'),
      ],
    });
    assert.equal(since?.toISOString(), '2026-11-04T12:00:00.000Z');
  });

  test('not actionable (novo, normal) or not open (em_atendimento) does not wait', () => {
    assert.equal(deriveAwaitingSince({ ...base, status: 'novo', lastClientAt: t('2026-11-04T10:00:00Z') }), null);
    assert.ok(
      deriveAwaitingSince({ ...base, status: 'novo', priority: 'alta', lastClientAt: t('2026-11-04T10:00:00Z') }),
    );
    assert.equal(
      deriveAwaitingSince({ ...base, status: 'em_atendimento', lastClientAt: t('2026-11-04T10:00:00Z') }),
      null,
    );
  });
});

describe('Leads: transcript and origin', () => {
  test('oldest first, roles, last 30 only, audio without transcription marked', () => {
    const entries = Array.from({ length: 35 }, (_, k) => ({
      fromMe: k % 2 === 1,
      text: `mensagem ${k}`,
      timestamp: 1_793_000_000 + k * 60,
    }));
    entries.push({ fromMe: false, text: '[áudio]', timestamp: 1_793_100_000, untranscribedAudio: true } as any);
    const transcript = buildTranscript(entries, ['mensagem 34', 'Meu nome é Joana e moro em Cidade Fictícia']);
    const lines = transcript.text.split('\n');
    assert.match(lines[0], /\] Cliente: mensagem 6$/);
    assert.match(lines[1], /\] Escritório: mensagem 7$/);
    assert.ok(lines.some((line) => /Cliente: \[áudio sem transcrição\]/.test(line)));
    assert.equal(transcript.untranscribedAudio, 1);
    assert.match(transcript.text, /Cliente: Meu nome é Joana/);
    assert.equal(
      (transcript.text.match(/mensagem 34/g) ?? []).length,
      1,
      'history already in the transcript is not repeated',
    );
  });

  test('origin only from explicit tags of the first message', () => {
    assert.equal(detectSource('Olá! [origem: Instagram] quero falar com o advogado'), 'instagram');
    assert.equal(detectSource('oi https://site.exemplo/?utm_source=google&x=1'), 'google');
    assert.equal(detectSource('vi vocês no instagram'), null);
    assert.equal(detectSource(null), null);
  });
});

describe('Leads: notification', () => {
  const on = (on: string) =>
    normalizeLeadSettings({ notifyEnabled: true, notifyNumbers: ['5521900009999'], notifyOn: on });

  test('off by default and only once', () => {
    const lead = { status: 'qualificado', priority: 'normal', notifiedAt: null };
    assert.equal(shouldNotify(lead, normalizeLeadSettings(null)), false);
    assert.equal(shouldNotify(lead, on('ambos')), true);
    assert.equal(shouldNotify({ ...lead, notifiedAt: new Date() }, on('ambos')), false);
  });

  test('qualificado / urgente / ambos, open leads only', () => {
    const urgent = { status: 'novo', priority: 'alta', notifiedAt: null };
    assert.equal(shouldNotify(urgent, on('qualificado')), false);
    assert.equal(shouldNotify(urgent, on('urgente')), true);
    assert.equal(shouldNotify({ status: 'qualificado', priority: 'normal' }, on('urgente')), false);
    assert.equal(shouldNotify({ status: 'cliente', priority: 'alta' }, on('ambos')), false);
  });

  test('text: name · area · city · priority, summary and wa.me link', () => {
    const text = notificationText({
      remoteJid: CLIENT,
      name: 'Joana Exemplo',
      area: 'Trabalhista',
      city: 'Cidade Fictícia',
      status: 'qualificado',
      priority: 'alta',
      priorityReason: 'audiência em 12/11',
      summary: 'Resumo fictício.',
    });
    assert.equal(
      text,
      'Novo lead qualificado — Joana Exemplo · Trabalhista · Cidade Fictícia · prioridade alta (audiência em 12/11)\nResumo fictício.\nConversa: https://wa.me/5521900000001',
    );
    assert.match(notificationText({ remoteJid: '123@lid', status: 'novo', priority: 'alta' }), /número oculto/);
  });
});

describe('Leads: CSV for Brazilian Excel', () => {
  test('BOM, semicolons, CRLF, quotes, formula injection and phone as text', () => {
    const csv = leadsToCsv([
      {
        remoteJid: CLIENT,
        name: '=HYPERLINK("x")',
        area: 'Família',
        city: 'Cidade; Fictícia',
        status: 'qualificado',
        priority: 'alta',
        priorityReason: 'audiência em 12/11',
        summary: 'Disse "urgente"\nsegunda linha',
        missingInfo: ['cidade', 'data do fato'],
        hasLawyer: false,
        mediaCount: 2,
        createdAt: '2026-11-04T15:30:00Z',
      },
    ]);
    assert.ok(csv.startsWith('\uFEFFNome;Telefone;Área;Cidade;Prioridade;'));
    assert.ok(csv.endsWith('\r\n'));
    const [, row] = csv.slice(1).split('\r\n');
    assert.ok(
      row.startsWith(
        `"'=HYPERLINK(""x"")";55 (21) 90000-0001;Família;"Cidade; Fictícia";Alta;audiência em 12/11;Qualificado;`,
      ),
    );
    assert.match(row, /"Disse ""urgente""\nsegunda linha"/);
    assert.match(row, /;cidade, data do fato;/);
    assert.match(row, /;Não;/);
    assert.match(row, /04\/11\/2026 12:30$/);
    assert.equal(csv.includes('Score'), false);
    assert.equal(csvCell('+5521'), "'+5521");
    assert.equal(formatPhone('5521912345678'), '55 (21) 91234-5678');
  });
});

describe('Leads: settings and edit validation', () => {
  test('defaults: extraction on, notifications off', () => {
    const settings = normalizeLeadSettings(null);
    assert.equal(settings.enabled, true);
    assert.equal(settings.notify.enabled, false);
    assert.ok(settings.areas.includes('Previdenciário (BPC/INSS)'));
  });

  test('settings validation in Portuguese', () => {
    assert.deepEqual(
      validateLeadSettingsInput({ enabled: true, areas: ['Família'], notify: { numbers: ['+55 (21) 90000-9999'] } }),
      [],
    );
    assert.ok(validateLeadSettingsInput({ areas: [] }).length);
    assert.ok(validateLeadSettingsInput({ areas: ['A', 'a'] }).some((e) => /repetidas/.test(e)));
    assert.ok(validateLeadSettingsInput({ notify: { numbers: ['123'] } }).some((e) => /Número inválido/.test(e)));
    assert.ok(validateLeadSettingsInput({ notify: { on: 'sempre' } }).length);
    assert.ok(validateLeadSettingsInput({ extractionModel: 'gpt 4; drop' }).length);
    assert.ok(validateLeadSettingsInput({ bogus: 1 }).some((e) => /desconhecidos/.test(e)));
    const merged = mergeLeadSettings(normalizeLeadSettings(null), { notify: { enabled: true } });
    assert.ok(validateLeadSettings(merged).length, 'notifications need a number');
    assert.deepEqual(
      mergeLeadSettings(normalizeLeadSettings(null), { notify: { numbers: ['+55 21 90000-9999', '5521900009999'] } })
        .notify.numbers,
      ['5521900009999'],
    );
  });

  test('patch validation', () => {
    assert.deepEqual(validateLeadPatch({ status: 'cliente', hasLawyer: null, missingInfo: ['cidade'] }), []);
    assert.ok(validateLeadPatch({ status: 'ganho' }).length);
    assert.ok(validateLeadPatch({ score: 10 }).some((e) => /não podem ser alterados/.test(e)));
    assert.ok(validateLeadPatch({ priority: 'urgente' }).length);
    assert.ok(validateLeadPatch({}).length);
    assert.ok(validateLeadPatch({ name: 'x'.repeat(121) }).length);
  });
});

// ------------------------------------------------------------------------------------------------ service

function setup(options: { answers?: any[]; gate?: { allow: boolean; reason: string }; now?: () => number } = {}) {
  const tables = createLeadsTables();
  const extractor = createFakeExtractor(options.answers ?? [extraction()]);
  const sent: any[] = [];
  const channel = {
    textMessage: async (data: any, isIntegration: boolean, fromChatbot: boolean) => {
      sent.push({ data, isIntegration, fromChatbot });
      return {};
    },
    resolveEquivalentJids: async (jid: string) => [jid],
  };
  const usage = { checkBeforeAnswer: async () => options.gate ?? { allow: true, reason: 'ok' } };
  const service = new LeadsService(
    tables.prisma,
    usage,
    { waInstances: { escritorio: channel } },
    {
      openai: () => extractor.client,
      provider: 'postgresql',
      // the clock is one second after the newest message, as in real life
      now: options.now ?? (() => (tables.lastTs() + 1) * 1000),
    },
  );
  const reply = (remoteJid = CLIENT, model = 'gpt-6-luna') =>
    service.afterBotReply({
      instance: channel,
      instanceId: 'inst-1',
      instanceName: 'escritorio',
      remoteJid,
      apiKey: 'sk-test',
      model,
    });
  const conversation = (
    remoteJid = CLIENT,
    texts = ['Olá [origem: instagram]', 'Fui demitida', 'Meu nome é Joana'],
  ) => {
    for (const text of texts) {
      tables.addMessage('inst-1', remoteJid, text, false, { pushName: 'Jo' });
      tables.addMessage('inst-1', remoteJid, 'Entendi. Pode contar mais?', true);
    }
  };
  return { tables, extractor, sent, channel, service, reply, conversation };
}

const qualified = extraction({
  name: 'Joana Exemplo',
  area: 'Trabalhista',
  city: 'Cidade Fictícia',
  summary: 'Demitida sem receber as verbas rescisórias.',
  clearNeed: true,
  missingInfo: ['data da demissão'],
  opposingParty: 'Empresa Fictícia Ltda',
  documentsMentioned: ['carta de demissão'],
});

describe('LeadsService: extraction after a bot answer', () => {
  test('creates the lead in the background with the instance credential and structured output', async () => {
    const { tables, extractor, sent, service, reply, conversation } = setup({ answers: [qualified] });
    conversation();
    tables.addMessage('inst-1', CLIENT, null, false, {
      pushName: 'Jo',
      messageType: 'documentMessage',
      message: { documentMessage: { fileName: 'carta.pdf' } },
    });
    reply();
    assert.equal(tables.leads.length, 0, 'never inline with the answer');
    await service.idle();

    assert.equal(extractor.requests.length, 1);
    const body = extractor.requests[0];
    assert.equal(body.model, 'gpt-6-luna');
    assert.equal(body.response_format.type, 'json_schema');
    assert.ok(body.max_completion_tokens > 0, 'reasoning models use max_completion_tokens');
    assert.equal(body.temperature, undefined);
    assert.match(body.messages[0].content, /NUNCA copie CPF/);
    assert.match(body.messages[1].content, /Cliente: Fui demitida/);

    const [lead] = tables.leads;
    assert.equal(lead.remoteJid, CLIENT);
    assert.equal(lead.status, 'qualificado');
    assert.equal(lead.statusSource, 'ai');
    assert.equal(lead.priority, 'normal');
    assert.equal(lead.source, 'instagram');
    assert.equal(lead.mediaCount, 1);
    assert.equal(lead.opposingParty, 'Empresa Fictícia Ltda');
    assert.deepEqual(lead.missingInfo, ['data da demissão']);
    assert.ok(lead.awaitingHumanSince instanceof Date, 'qualified and nobody of the team answered');
    assert.equal(lead.extractedFromCount, 4);
    assert.equal(lead.pushName, 'Jo');
    assert.equal('score' in lead, false);
    assert.equal(sent.length, 0, 'nothing is sent (notifications off by default)');
  });

  test('older models use max_tokens and temperature 0', async () => {
    const { extractor, service, reply, conversation } = setup();
    conversation();
    reply(CLIENT, 'gpt-4o-mini');
    await service.idle();
    assert.equal(extractor.requests[0].max_tokens > 0, true);
    assert.equal(extractor.requests[0].temperature, 0);
  });

  test('skips groups, short conversations, disabled settings and blocked limits', async () => {
    const short = setup();
    short.conversation(CLIENT, ['oi', 'tudo bem?']);
    short.reply();
    short.reply('120363000000000000@g.us');
    await short.service.idle();
    assert.equal(short.extractor.requests.length, 0);

    const disabled = setup();
    disabled.conversation();
    await disabled.service.saveSettings('inst-1', { enabled: false });
    disabled.reply();
    await disabled.service.idle();
    assert.equal(disabled.extractor.requests.length, 0);

    const blocked = setup({ gate: { allow: false, reason: 'monthly' } });
    blocked.conversation();
    blocked.reply();
    await blocked.service.idle();
    assert.equal(blocked.extractor.requests.length, 0);

    const hours = setup({ gate: { allow: false, reason: 'hours' } });
    hours.conversation();
    hours.reply();
    await hours.service.idle();
    assert.equal(hours.extractor.requests.length, 1, 'business hours do not block the analysis');
  });

  test('runs again only after 3 new client messages, and never overrides the status set by the team', async () => {
    const { tables, extractor, service, reply, conversation } = setup({ answers: [qualified] });
    conversation();
    reply();
    await service.idle();
    const id = tables.leads[0].id;
    await service.update('inst-1', id, { status: 'descartado', name: 'Nome Corrigido' });

    conversation(CLIENT, ['mais uma']);
    reply();
    await service.idle();
    assert.equal(extractor.requests.length, 1, 'one new message is not enough');

    conversation(CLIENT, ['segunda', 'terceira']);
    reply();
    await service.idle();
    assert.equal(extractor.requests.length, 2);
    const lead = tables.leads[0];
    assert.equal(lead.status, 'descartado');
    assert.equal(lead.statusSource, 'manual');
    assert.equal(lead.name, 'Nome Corrigido');
    assert.equal(lead.awaitingHumanSince, null);
  });

  test('a failed call is only logged and not retried for 10 minutes; the bot is never affected', async () => {
    let now = Date.parse('2026-11-04T12:00:00Z');
    const { tables, extractor, service, reply, conversation } = setup({
      answers: [Object.assign(new Error('timeout'), { status: 504 }), qualified],
      now: () => now,
    });
    conversation();
    reply();
    await service.idle();
    assert.equal(tables.leads.length, 0);
    reply();
    await service.idle();
    assert.equal(extractor.requests.length, 1);
    now += 11 * 60_000;
    reply();
    await service.idle();
    assert.equal(extractor.requests.length, 2);
    assert.equal(tables.leads.length, 1);
  });

  test('falls back to JSON mode when the model rejects json_schema', async () => {
    const reject = Object.assign(
      new Error("Invalid parameter: 'response_format' of type 'json_schema' is not supported"),
      {
        status: 400,
        param: 'response_format',
      },
    );
    const { extractor, tables, service, reply, conversation } = setup({ answers: [reject, qualified] });
    conversation();
    reply(CLIENT, 'gpt-4o-mini');
    await service.idle();
    assert.equal(extractor.requests.length, 2);
    assert.equal(extractor.requests[1].response_format.type, 'json_object');
    assert.equal(tables.leads.length, 1);
  });

  test('audio the bot transcribed comes from the session history', async () => {
    const { tables, extractor, service, reply } = setup();
    tables.addMessage('inst-1', CLIENT, 'oi');
    tables.addMessage('inst-1', CLIENT, null, false, {
      messageType: 'audioMessage',
      message: { audioMessage: { seconds: 12 } },
    });
    tables.addMessage('inst-1', CLIENT, 'é isso');
    tables.sessions.push({
      instanceId: 'inst-1',
      remoteJid: CLIENT,
      updatedAt: new Date(),
      context: JSON.stringify({
        history: [{ role: 'user', content: 'Tenho audiência dia 12/11 e moro em Cidade Fictícia' }],
      }),
    });
    reply();
    await service.idle();
    assert.match(extractor.requests[0].messages[1].content, /Tenho audiência dia 12\/11/);
  });

  test('a team reply ends the wait', async () => {
    const { tables, service, reply, conversation } = setup({ answers: [qualified] });
    conversation();
    reply();
    await service.idle();
    assert.ok(tables.leads[0].awaitingHumanSince);
    service.recordHumanReply('inst-1', [CLIENT, '123@lid', '120363@g.us'], new Date());
    await service.idle();
    assert.equal(tables.leads[0].awaitingHumanSince, null);
    assert.ok(tables.leads[0].lastHumanReplyAt);
  });
});

describe('LeadsService: team notification', () => {
  test('one notice per lead to each team number, marked as a chatbot send, never to the client', async () => {
    const { tables, sent, service, reply, conversation } = setup({
      answers: [{ ...qualified, urgentType: 'audiencia', urgentFact: 'audiência em 12/11' }],
    });
    await service.saveSettings('inst-1', {
      notify: { enabled: true, numbers: ['5521900009999', '5521900009998'], on: 'ambos' },
    });
    conversation();
    reply();
    await service.idle();
    assert.deepEqual(
      sent.map((item) => item.data.number),
      ['5521900009999', '5521900009998'],
    );
    assert.equal(sent[0].fromChatbot, true);
    assert.match(
      sent[0].data.text,
      /^Novo lead qualificado — Joana Exemplo · Trabalhista · Cidade Fictícia · prioridade alta/,
    );
    assert.ok(tables.leads[0].notifiedAt);

    conversation(CLIENT, ['a', 'b', 'c']);
    reply();
    await service.idle();
    assert.equal(sent.length, 2, 'never twice');
  });

  test('a team number is never turned into a lead', async () => {
    const team = '5521900009999@s.whatsapp.net';
    const { extractor, service, reply, conversation } = setup();
    await service.saveSettings('inst-1', { notify: { numbers: ['5521900009999'] } });
    conversation(team);
    reply(team);
    await service.idle();
    assert.equal(extractor.requests.length, 0);
  });
});

describe('LeadsService: list, edit, export, backfill', () => {
  async function seeded() {
    const ctx = setup();
    const now = new Date('2026-11-04T12:00:00Z');
    const rows = [
      {
        remoteJid: '5521900000011@s.whatsapp.net',
        name: 'Ana Fictícia',
        status: 'qualificado',
        priority: 'normal',
        priorityRank: 1,
        awaitingHumanSince: new Date(now.getTime() - 3 * HOUR),
        area: 'Família',
      },
      {
        remoteJid: '5521900000012@s.whatsapp.net',
        name: 'Bruno Fictício',
        status: 'novo',
        priority: 'alta',
        priorityRank: 0,
        awaitingHumanSince: new Date(now.getTime() - HOUR),
        area: 'Trabalhista',
      },
      {
        remoteJid: '5521900000013@s.whatsapp.net',
        name: 'Carla Fictícia',
        status: 'qualificado',
        priority: 'normal',
        priorityRank: 1,
        awaitingHumanSince: new Date(now.getTime() - 5 * HOUR),
        area: 'Trabalhista',
        city: 'Cidade B',
      },
      {
        remoteJid: '5521900000014@s.whatsapp.net',
        name: 'Davi Fictício',
        status: 'cliente',
        priority: 'baixa',
        priorityRank: 2,
        area: 'Cível',
      },
    ];
    for (const [k, row] of rows.entries()) {
      await ctx.tables.prisma.lead.create({
        data: { instanceId: 'inst-1', lastMessageAt: new Date(now.getTime() - k * HOUR), ...row },
      });
    }
    return ctx;
  }

  test('default order: priority alta first, then the longest wait; counts per view', async () => {
    const { service } = await seeded();
    const result = await service.list('inst-1', {});
    assert.deepEqual(
      result.leads.map((lead: any) => lead.name),
      ['Bruno Fictício', 'Carla Fictícia', 'Ana Fictícia', 'Davi Fictício'],
    );
    assert.deepEqual(result.counts, {
      todos: 4,
      aguardando: 3,
      novo: 1,
      qualificado: 2,
      em_atendimento: 0,
      cliente: 1,
      descartado: 0,
    });
    assert.equal(result.leads[0].whatsappUrl, 'https://wa.me/5521900000012');
    assert.equal(result.leads[3].awaitingHumanSince, null);
  });

  test('filters: aguardando, status, area, priority, search, pagination; invalid status is a 400', async () => {
    const { service } = await seeded();
    assert.equal((await service.list('inst-1', { status: 'aguardando' })).total, 3);
    assert.equal((await service.list('inst-1', { status: 'qualificado', area: 'Trabalhista' })).total, 1);
    assert.equal((await service.list('inst-1', { priority: 'alta' })).leads[0].name, 'Bruno Fictício');
    assert.equal((await service.list('inst-1', { search: 'cidade b' })).leads[0].name, 'Carla Fictícia');
    assert.equal((await service.list('inst-1', { search: '000014' })).leads[0].name, 'Davi Fictício');
    const page = await service.list('inst-1', { pageSize: '2', page: '2', sort: 'name' });
    assert.deepEqual(
      page.leads.map((lead: any) => lead.name),
      ['Carla Fictícia', 'Davi Fictício'],
    );
    assert.equal(page.pages, 2);
    await assert.rejects(() => service.list('inst-1', { status: 'ganho' }), LeadsValidationError);
  });

  test('edit locks the fields, marks the status manual and returns the previous values', async () => {
    const { service, tables } = await seeded();
    const id = tables.leads[0].id;
    const result = await service.update('inst-1', id, {
      status: 'em_atendimento',
      priority: 'alta',
      city: '  Cidade C ',
    });
    assert.equal(result.previous.status, 'qualificado');
    assert.equal(result.lead.status, 'em_atendimento');
    assert.equal(result.lead.statusSource, 'manual');
    assert.equal(result.lead.priorityReason, 'Definida pela equipe');
    assert.equal(result.lead.city, 'Cidade C');
    assert.equal(result.lead.awaitingHumanSince, null);
    assert.deepEqual(result.lead.manualFields.sort(), ['city', 'priority', 'status']);
    assert.equal(tables.leads[0].priorityRank, 0);
    assert.equal(await service.update('inst-2', id, { city: 'x' }), null, 'other instances never see it');
    await assert.rejects(() => service.update('inst-1', id, { status: 'ganho' }), LeadsValidationError);
  });

  test('CSV export follows the filters', async () => {
    const { service } = await seeded();
    const csv = await service.exportCsv('inst-1', { status: 'cliente' });
    assert.equal(csv.trim().split('\r\n').length, 2);
    assert.match(csv, /Davi Fictício/);
  });

  test('backfill: dry run counts, the run analyses sequentially, a second run is refused', async () => {
    const ctx = setup({ answers: [qualified] });
    ctx.tables.bots.push({
      instanceId: 'inst-1',
      enabled: true,
      openaiCredsId: 'cred-1',
      model: 'gpt-4o-mini',
      createdAt: new Date(),
    });
    ctx.tables.creds.push({ id: 'cred-1', apiKey: 'sk-test-backfill' });
    const now = Math.floor(Date.now() / 1000);
    for (let k = 0; k < 3; k++) {
      const jid = `552190000002${k}@s.whatsapp.net`;
      for (let m = 0; m < (k === 2 ? 2 : 3); m++)
        ctx.tables.addMessage('inst-1', jid, `mensagem ${m}`, false, { at: now - 3600 + k * 100 + m });
    }
    ctx.tables.addMessage('inst-1', '120363000000000001@g.us', 'grupo', false, { at: now - 10 });

    const dry = await ctx.service.backfill('inst-1', 'escritorio', { days: 30, max: 200, dryRun: true });
    assert.equal(dry.candidates, 2);
    assert.equal(ctx.extractor.requests.length, 0);

    const run = await ctx.service.backfill('inst-1', 'escritorio', { days: 30, max: 1 });
    assert.equal(run.started, true);
    assert.equal(run.candidates, 1);
    await assert.rejects(() => ctx.service.backfill('inst-1', 'escritorio', {}), LeadsConflictError);
    await ctx.service.idle();
    const status = ctx.service.backfillStatus('inst-1');
    assert.equal(status.running, false);
    assert.equal(status.done, 1);
    assert.equal(status.created, 1);
    assert.equal(ctx.extractor.requests[0].model, 'gpt-4o-mini');

    const again = await ctx.service.backfill('inst-1', 'escritorio', { dryRun: true });
    assert.equal(again.candidates, 1, 'the analysed conversation is not offered again');
  });

  test('backfill needs the feature on and an OpenAI credential', async () => {
    const ctx = setup();
    await assert.rejects(() => ctx.service.backfill('inst-1', 'escritorio', { dryRun: true }), /credencial OpenAI/);
    await ctx.service.saveSettings('inst-1', { enabled: false });
    await assert.rejects(() => ctx.service.backfill('inst-1', 'escritorio', { dryRun: true }), /desativada/);
  });

  test('settings: saved, validated, previous values returned', async () => {
    const { service } = setup();
    const first = await service.saveSettings('inst-1', {
      areas: ['Trabalhista', 'Família'],
      notify: { numbers: ['5521900009999'] },
    });
    assert.equal(first.previous, null);
    assert.deepEqual(first.settings.areas, ['Trabalhista', 'Família']);
    const second = await service.saveSettings('inst-1', { notify: { enabled: true, on: 'urgente' } });
    assert.deepEqual(second.previous.notify, { enabled: false, numbers: ['5521900009999'], on: 'ambos' });
    assert.deepEqual(second.settings.notify, { enabled: true, numbers: ['5521900009999'], on: 'urgente' });
    await assert.rejects(() => service.saveSettings('inst-1', { notify: { numbers: [] } }), /pelo menos um número/);
  });

  test('observability snapshot: new, qualified and awaiting per instance', async () => {
    const { service } = await seeded();
    const [item] = await service.snapshot();
    assert.equal(item.name, 'escritorio');
    assert.equal(item.newToday, 4);
    assert.equal(item.qualified7d, 2);
    assert.equal(item.awaiting, 3);
  });
});
