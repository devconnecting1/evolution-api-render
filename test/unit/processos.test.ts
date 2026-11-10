import '../helpers/setup';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { jidVariants, normalizeLinkedJid, processStatus } from '@api/services/processos.service';
import { asksAboutProcess, buildProcessContextBlock } from '@utils/processos/aiContext';
import { aliasFor, cnjCheckDigits, extractCnjCandidates, formatCnj, isValidCnj, parseCnj } from '@utils/processos/cnj';
import { fetchDataJudProcess, parseDataJudDate, parseDataJudResponse, SourceError } from '@utils/processos/datajud';
import { fetchDjenByOab, htmlToText, parseDjenResponse } from '@utils/processos/djen';
import {
  clientMessageText,
  DEFAULT_CLIENT_TEMPLATE,
  isQuietNow,
  normalizeQuietHours,
  quietEndsAt,
  teamMovementText,
  teamPublicationText,
  validateClientTemplate,
} from '@utils/processos/notify';

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'processos', name), 'utf8'));

/** Official example of the DataJud wiki (TRF1, public) and fictional numbers with valid check digits. */
const OFFICIAL = '00008323520184013202';
const TJRJ = '0001234-04.2026.8.19.0001';

describe('Processos: CNJ number', () => {
  test('check digit (mod 97) of the official DataJud example and of fictional numbers', () => {
    assert.equal(cnjCheckDigits('0000832', '2018', '4', '01', '3202'), '35');
    assert.equal(isValidCnj(OFFICIAL), true);
    assert.equal(isValidCnj('00008323620184013202'), false);
    assert.equal(formatCnj(OFFICIAL), '0000832-35.2018.4.01.3202');
    assert.equal(parseCnj(TJRJ).ok, true);
  });

  test('J.TR maps to the DataJud alias', () => {
    const alias = (n: string) => aliasFor(n.replace(/\D/g, ''));
    assert.equal(alias(TJRJ), 'tjrj');
    assert.equal(alias('0100000-79.2025.5.01.0001'), 'trt1');
    assert.equal(alias('0200000-07.2024.4.02.5101'), 'trf2');
    assert.equal(alias(OFFICIAL), 'trf1');
    assert.equal(aliasFor('00000000020268260001'), 'tjsp');
    assert.equal(aliasFor('00000000020263000000'), 'stj');
    assert.equal(aliasFor('00000000020265000000'), 'tst');
    assert.equal(aliasFor('00000000020266190000'), 'tre-rj');
    assert.equal(aliasFor('00000000020268070000'), 'tjdft');
    assert.equal(aliasFor('00000000020269130000'), 'tjmmg');
    assert.equal(aliasFor('00000000020261000000'), null, 'STF is not in the public API');
  });

  test('parse errors in PT-BR and extraction from a pasted list', () => {
    const short = parseCnj('123');
    assert.equal(short.ok, false);
    assert.match((short as any).error, /20 dígitos/);
    const wrong = parseCnj('0001234-05.2026.8.19.0001');
    assert.match((wrong as any).error, /Dígito verificador/);
    const pasted = `Processos do cliente:\n${TJRJ}\n00008323520184013202; 0001234-04.2026.8.19.0001 (repetido)\nlixo`;
    assert.deepEqual(extractCnjCandidates(pasted).length, 2);
  });
});

describe('Processos: DataJud parsing', () => {
  test('official example: capa, merged documents, dedupe, newest first, complements', () => {
    const parsed = parseDataJudResponse(fixture('datajud-trf1-exemplo-oficial.json'));
    assert.equal(parsed.found, true);
    assert.equal(parsed.classe, 'Procedimento do Juizado Especial Cível');
    assert.equal(parsed.assuntos, 'Concessão');
    assert.equal(parsed.orgaoJulgador, 'Tefé');
    assert.equal(parsed.dataAjuizamento.toISOString(), '2018-10-29T00:00:00.000Z');
    assert.equal(parsed.sigilo, false);
    assert.equal(parsed.movements.length, 5, 'the movement repeated in the second document is deduped');
    assert.equal(parsed.movements[0].name, 'Ato ordinatório');
    assert.ok(parsed.movements[0].occurredAt > parsed.movements[4].occurredAt);
    const documento = parsed.movements.find((m) => m.name === 'Documento');
    assert.match(documento.complement, /tipo de documento: Outros documentos/);
    assert.equal(new Set(parsed.movements.map((m) => m.hash)).size, 5);
  });

  test('not found, sigilo and date formats', () => {
    assert.equal(parseDataJudResponse({ hits: { hits: [] } }).found, false);
    const sigilo = parseDataJudResponse({ hits: { hits: [{ _source: { nivelSigilo: 1, movimentos: [] } }] } });
    assert.equal(sigilo.sigilo, true);
    assert.equal(parseDataJudDate('20181029000000').toISOString(), '2018-10-29T00:00:00.000Z');
    assert.equal(parseDataJudDate('2020-11-12T20:24:27.000Z').toISOString(), '2020-11-12T20:24:27.000Z');
    assert.equal(parseDataJudDate('2020-11-12T20:24:27').toISOString(), '2020-11-12T20:24:27.000Z');
    assert.equal(parseDataJudDate('x'), null);
  });

  test('client sends the APIKey header and maps HTTP errors', async () => {
    let seen: any = null;
    const ok = async (url: string, init: any) => {
      seen = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => fixture('datajud-trf1-exemplo-oficial.json'),
        text: async () => '',
      };
    };
    const parsed = await fetchDataJudProcess('trf1', OFFICIAL, { fetchImpl: ok as any, apiKey: 'k' });
    assert.equal(parsed.found, true);
    assert.equal(seen.url, 'https://api-publica.datajud.cnj.jus.br/api_publica_trf1/_search');
    assert.equal(seen.init.headers.Authorization, 'APIKey k');
    assert.deepEqual(JSON.parse(seen.init.body).query, { match: { numeroProcesso: OFFICIAL } });

    const status = (code: number) => async () => ({
      ok: false,
      status: code,
      json: async () => ({}),
      text: async () => '',
    });
    await assert.rejects(fetchDataJudProcess('trf1', OFFICIAL, { fetchImpl: status(429) as any }), (e: any) => {
      assert.ok(e instanceof SourceError);
      assert.equal(e.retryable, true);
      return true;
    });
    await assert.rejects(fetchDataJudProcess('trf1', OFFICIAL, { fetchImpl: status(401) as any }), /DATAJUD_API_KEY/);
  });
});

describe('Processos: DJEN parsing', () => {
  test('fictional response: HTML to text, numbers, unsafe links dropped', () => {
    const { count, items } = parseDjenResponse(fixture('djen-ficticio.json'));
    assert.equal(count, 2);
    assert.equal(items[0].externalId, '900000001');
    assert.equal(items[0].processNumber, TJRJ);
    assert.equal(items[0].siglaTribunal, 'TJRJ');
    assert.equal(items[0].disponibilizadaEm.toISOString().slice(0, 10), '2026-11-03');
    assert.match(
      items[0].texto,
      /^INTIMAÇÃO\nFica a parte autora intimada para se manifestar sobre o laudo pericial\./,
    );
    assert.equal(items[1].processDigits, null);
    assert.equal(items[1].texto, 'Texto & edital fictício.');
    assert.equal(items[1].link, null);
    assert.equal(htmlToText('a'.repeat(5000)).length, 4000);
  });

  test('query parameters and the 403 of a server outside Brazil', async () => {
    let url = '';
    const ok = async (u: string) => {
      url = u;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => fixture('djen-ficticio.json'),
        text: async () => '',
      };
    };
    const items = await fetchDjenByOab(
      {
        numeroOab: '123456',
        ufOab: 'rj',
        from: new Date('2026-11-01T12:00:00Z'),
        to: new Date('2026-11-08T12:00:00Z'),
      },
      { fetchImpl: ok as any },
    );
    assert.equal(items.length, 2);
    const params = new URL(url).searchParams;
    assert.equal(params.get('numeroOab'), '123456');
    assert.equal(params.get('ufOab'), 'RJ');
    assert.equal(params.get('dataDisponibilizacaoInicio'), '2026-11-01');
    assert.equal(params.get('dataDisponibilizacaoFim'), '2026-11-08');
    const forbidden = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => '' });
    await assert.rejects(
      fetchDjenByOab(
        { numeroOab: '1', ufOab: 'RJ', from: new Date(), to: new Date() },
        { fetchImpl: forbidden as any },
      ),
      /fora do Brasil/,
    );
  });
});

describe('Processos: notification texts and policy', () => {
  const process = { apelido: 'Silva x Banco Fictício', numeroCnj: TJRJ, tribunalAlias: 'tjrj' };

  test('team movement text has the full detail', () => {
    const text = teamMovementText(process, [
      {
        occurredAt: new Date('2026-11-03T15:00:00Z'),
        name: 'Juntada de Petição',
        complement: 'tipo de petição: Manifestação',
      },
    ]);
    assert.equal(
      text,
      `Nova movimentação — Silva x Banco Fictício (TJRJ)\n03/11/2026 · Juntada de Petição\ntipo de petição: Manifestação\nProcesso ${TJRJ}`,
    );
    const many = teamMovementText(
      { ...process, apelido: null },
      Array.from({ length: 7 }, (_, k) => ({
        occurredAt: new Date(Date.UTC(2026, 10, k + 1, 15)),
        name: `Mov ${k}`,
      })),
    );
    assert.match(many, /^Nova movimentação — 0001234-04\.2026\.8\.19\.0001 \(TJRJ\)\n07\/11\/2026 · Mov 6/);
    assert.match(many, /\+2 outra\(s\) no painel\.$/);
  });

  test('team publication text', () => {
    const text = teamPublicationText({
      siglaTribunal: 'TJRJ',
      processNumber: TJRJ,
      tipo: 'Intimação',
      texto: 'INTIMAÇÃO\nFica a parte intimada.\nPrazo: 15 dias.\nLinha 4',
      link: 'https://comunica.pje.jus.br/x',
    });
    assert.equal(
      text,
      `Nova intimação/publicação no DJEN — TJRJ · ${TJRJ}\nIntimação\nINTIMAÇÃO Fica a parte intimada. Prazo: 15 dias.\nhttps://comunica.pje.jus.br/x`,
    );
  });

  test('client text is the neutral template only ({nome} is the only placeholder)', () => {
    assert.equal(
      clientMessageText(null, 'Maria Souza'),
      'Olá, Maria. Houve uma atualização no seu processo. O escritório vai analisar e entrar em contato.',
    );
    assert.equal(
      clientMessageText(DEFAULT_CLIENT_TEMPLATE, ''),
      'Olá. Houve uma atualização no seu processo. O escritório vai analisar e entrar em contato.',
    );
    assert.match(validateClientTemplate('Olá {nome}, saiu {movimento}'), /só aceita o campo \{nome\}/);
    assert.equal(validateClientTemplate('Oi, {nome}! Temos novidade, vamos ligar.'), null);
    // an invalid stored template never reaches the client
    assert.equal(
      clientMessageText('Saiu {movimento}', 'Ana'),
      'Olá, Ana. Houve uma atualização no seu processo. O escritório vai analisar e entrar em contato.',
    );
  });

  test('quiet hours cross midnight in the configured time zone', () => {
    const quiet = normalizeQuietHours({ enabled: true, start: '20:00', end: '08:00', timezone: 'America/Sao_Paulo' });
    assert.equal(isQuietNow(quiet, new Date('2026-11-04T01:00:00Z')), true, '22:00 in São Paulo');
    assert.equal(isQuietNow(quiet, new Date('2026-11-04T10:59:00Z')), true, '07:59');
    assert.equal(isQuietNow(quiet, new Date('2026-11-04T11:00:00Z')), false, '08:00');
    assert.equal(isQuietNow(quiet, new Date('2026-11-04T18:00:00Z')), false, '15:00');
    assert.equal(quietEndsAt(quiet, new Date('2026-11-04T01:00:00Z')).toISOString(), '2026-11-04T11:00:00.000Z');
    assert.equal(isQuietNow({ ...quiet, enabled: false }, new Date('2026-11-04T01:00:00Z')), false);
  });
});

describe('Processos: AI context and contacts', () => {
  test('trigger words and the neutral block (dates only)', () => {
    assert.equal(asksAboutProcess('Oi, tem novidade no meu processo?'), true);
    assert.equal(asksAboutProcess('Como está o andamento?'), true);
    assert.equal(asksAboutProcess('Qual o horário de vocês?'), false);
    const block = buildProcessContextBlock([
      { label: `Processo nº ${TJRJ}`, updates: [new Date('2026-11-03T15:00:00Z'), new Date('2026-10-20T15:00:00Z')] },
    ]);
    assert.match(block, /atualizações registradas em 03\/11\/2026, 20\/10\/2026/);
    assert.match(block, /Não diga o conteúdo da movimentação/);
    assert.match(block, /encaminhar a dúvida para o advogado/);
    assert.equal(buildProcessContextBlock([]), null);
  });

  test('linked contact normalization and same-number variants only', () => {
    assert.equal(normalizeLinkedJid('+55 (21) 99999-0000'), '5521999990000@s.whatsapp.net');
    assert.equal(normalizeLinkedJid('123'), undefined);
    assert.equal(normalizeLinkedJid(''), null);
    assert.equal(normalizeLinkedJid('123456789012345@lid'), '123456789012345@lid');
    assert.deepEqual(jidVariants('5521999990000@s.whatsapp.net').sort(), [
      '552199990000@s.whatsapp.net',
      '5521999990000@s.whatsapp.net',
    ]);
    assert.deepEqual(jidVariants('123@lid'), ['123@lid']);
  });

  test('status chip', () => {
    assert.equal(processStatus({ initialized: true, lastError: 'x', errorCount: 1 }, 0), 'erro');
    assert.equal(processStatus({ initialized: true }, 2), 'novidade');
    assert.equal(processStatus({ initialized: true }, 0), 'em_dia');
    assert.equal(processStatus({ initialized: false }, 0), 'aguardando');
  });
});
