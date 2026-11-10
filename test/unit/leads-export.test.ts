import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { inflateRawSync } from 'node:zlib';

import {
  cleanDisplayName,
  daysUntil,
  derivePriority,
  formatWait,
  leadsToCsv,
  leadsToXlsxSheets,
  normalizeCity,
  parseExtraction,
  teamReplyAt,
} from '@utils/leads';
import { buildXlsx, columnName, excelSerial, sheetsToPreview } from '@utils/xlsx';

/** Files of a zip built by buildXlsx (local headers in order, deflate). */
function unzip(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLength = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength;
    files.set(name, inflateRawSync(buf.subarray(start, start + size)).toString('utf8'));
    at = start + size;
  }
  return files;
}

const NOW = new Date('2026-11-10T21:00:00Z'); // 18:00 in São Paulo

describe('leads: names and cities written one way', () => {
  test('cities: municipality only, typos fixed, UF kept outside RJ', () => {
    assert.equal(normalizeCity('Nova Iguaçu, RJ'), 'Nova Iguaçu');
    assert.equal(normalizeCity('Novo Iguaçu'), 'Nova Iguaçu');
    assert.equal(normalizeCity('Cabuçu, Nova Iguaçu'), 'Nova Iguaçu');
    assert.equal(normalizeCity('Mesquita, Rio de Janeiro'), 'Mesquita');
    assert.equal(normalizeCity('sao joao de meriti'), 'São João de Meriti');
    assert.equal(normalizeCity('Petrópolis - RJ'), 'Petrópolis');
    assert.equal(normalizeCity('Juiz de Fora, MG'), 'Juiz de Fora - MG');
    assert.equal(normalizeCity('CAMPINAS'), 'Campinas');
    assert.equal(normalizeCity('  '), null);
  });

  test('names: no emojis, no CAPS LOCK, internal ids are not names', () => {
    assert.equal(cleanDisplayName('ERANDY ARAUJO'), 'Erandy Araujo');
    assert.equal(cleanDisplayName('Maria 🌸 da Silva ✨'), 'Maria da Silva');
    assert.equal(cleanDisplayName('178731389849797'), null);
    assert.equal(cleanDisplayName('🙏🏽'), null);
    assert.equal(cleanDisplayName('Ana'), 'Ana');
  });
});

describe('leads: priority with the date of the fact', () => {
  const base = { noLegalNeed: false, urgentType: 'audiencia' as const, urgentFact: 'audiência em 13/11' };

  test('countdown inside 30 days is alta; far ahead is normal with the countdown; past hearing is normal', () => {
    assert.deepEqual(derivePriority({ ...base, urgentDate: '2026-11-13' }, {}, NOW), {
      priority: 'alta',
      priorityReason: 'audiência em 13/11 (em 3 dias)',
    });
    assert.equal(
      derivePriority({ ...base, urgentDate: '2026-11-11' }, {}, NOW).priorityReason,
      'audiência em 13/11 (amanhã)',
    );
    const far = derivePriority({ ...base, urgentFact: 'audiência em 26/02/2027', urgentDate: '2027-02-26' }, {}, NOW);
    assert.equal(far.priority, 'normal');
    assert.match(far.priorityReason, /daqui a 108 dias/);
    assert.equal(derivePriority({ ...base, urgentDate: '2026-11-01' }, {}, NOW).priority, 'normal');
  });

  test('an expired deadline stays alta; a solved problem is normal; no date keeps the old rule', () => {
    const expired = derivePriority(
      { noLegalNeed: false, urgentType: 'prazo', urgentFact: 'prazo de defesa', urgentDate: '2026-11-05' },
      {},
      NOW,
    );
    assert.deepEqual(expired, { priority: 'alta', priorityReason: 'Venceu há 5 dia(s): prazo de defesa' });
    const solved = derivePriority(
      { noLegalNeed: false, urgentType: 'corte_beneficio', urgentFact: 'energia cortada', urgentResolved: true },
      {},
      NOW,
    );
    assert.deepEqual(solved, { priority: 'normal', priorityReason: 'Já resolvido: energia cortada' });
    assert.equal(derivePriority({ ...base, urgentDate: null }, {}, NOW).priority, 'alta');
    assert.equal(daysUntil('2026-11-10', NOW), 0);
  });

  test('the parser keeps urgentDate/urgentResolved only with an urgent fact and a valid day; city normalized', () => {
    const parsed = parseExtraction(
      JSON.stringify({
        urgentType: 'audiencia',
        urgentFact: 'audiência em 13/11',
        urgentDate: '2026-11-13',
        urgentResolved: false,
        city: 'Novo Iguaçu, RJ',
      }),
      ['Consumidor'],
    );
    assert.equal(parsed?.urgentDate, '2026-11-13');
    assert.equal(parsed?.city, 'Nova Iguaçu');
    const noFact = parseExtraction(
      JSON.stringify({ urgentType: null, urgentDate: '2026-11-13', urgentResolved: true }),
      [],
    );
    assert.equal(noFact?.urgentDate, null);
    assert.equal(noFact?.urgentResolved, false);
    assert.equal(parseExtraction(JSON.stringify({ urgentType: 'prazo', urgentDate: '13/11' }), [])?.urgentDate, null);
  });
});

describe('leads: Excel export', () => {
  const leads = [
    {
      name: null,
      pushName: 'MARIA 🌸 SOUZA',
      remoteJid: '5521999990000@s.whatsapp.net',
      priority: 'alta',
      priorityReason: 'audiência em 13/11 (em 3 dias)',
      status: 'novo',
      awaitingHumanSince: new Date(NOW.getTime() - 80 * 3_600_000),
      area: 'Consumidor',
      city: 'Novo Iguaçu',
      summary: 'Conta de luz com cobrança indevida & <corte> anunciado.',
      missingInfo: ['nome', 'data do corte'],
      opposingParty: 'Light',
      hasLawyer: null,
      documentsMentioned: ['conta de luz'],
      mediaCount: 2,
      firstMessageAt: new Date('2026-11-01T13:00:00Z'),
      lastMessageAt: new Date('2026-11-01T13:05:00Z'),
    },
    {
      name: 'José',
      remoteJid: '178731389849797@lid',
      priority: 'normal',
      status: 'qualificado',
      opposingParty: 'Light S.A.',
    },
  ];

  test('sheets, columns and the values the team works with', () => {
    const [summary, sheet] = leadsToXlsxSheets(leads, { instanceName: 'Escritório', now: NOW });
    assert.equal(sheet.name, 'Leads');
    assert.equal(summary.name, 'Resumo');
    const first = sheet.rows[0] as any[];
    assert.deepEqual(first[0], { value: 'Maria Souza', style: { bold: true, wrap: true } });
    assert.equal(first[3], 'Não classificado');
    assert.equal(first[4].value, '3 d 8 h');
    assert.equal(first[4].style.fill, 'red', 'more than 3 days waiting');
    assert.equal(first[5].link, 'https://wa.me/5521999990000');
    assert.equal(first[7], 'Nova Iguaçu');
    assert.equal(first[11].value, 'confirmar o nome, data do corte');
    assert.equal(first[14], 'Não informado');
    assert.equal((sheet.rows[1] as any[])[5].value, 'Sem número (contato oculto)');
    const text = JSON.stringify(summary.rows);
    assert.match(text, /Aguardando resposta da equipe/);
    assert.match(
      text,
      /CASOS PARECIDOS[\s\S]*"value":"Light"[^\]]*"value":2/,
      'similar cases grouped by the opposing party',
    );
    assert.match(text, /PRINCIPAIS ACHADOS E RECOMENDAÇÕES/);
    assert.ok(summary.merges?.includes('A1:C1'));
    assert.equal(
      sheet.columns.some((column) => column.header === 'Origem'),
      false,
      'no empty column',
    );
  });

  test('a valid xlsx: workbook, styles, escaped text, real dates, link and filter', () => {
    const files = unzip(
      buildXlsx(leadsToXlsxSheets(leads, { instanceName: 'Escritório', now: NOW }), { title: 'Leads' }),
    );
    for (const name of [
      '[Content_Types].xml',
      'xl/workbook.xml',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]) {
      assert.ok(files.has(name), name);
    }
    const sheet = files.get('xl/worksheets/sheet2.xml')!;
    assert.match(sheet, /&amp; &lt;corte&gt;/);
    assert.match(sheet, /<autoFilter ref="A1:V3"\/>/);
    assert.match(sheet, /state="frozen"/);
    assert.match(files.get('xl/worksheets/_rels/sheet2.xml.rels')!, /https:\/\/wa\.me\/5521999990000/);
    assert.match(files.get('xl/styles.xml')!, /dd\/mm\/yyyy hh:mm/);
    assert.match(files.get('xl/workbook.xml')!, /name="Resumo".*name="Leads"/);
  });

  test('helpers: column names, Excel serial in São Paulo time, waiting text; CSV uses the same clean values', () => {
    assert.equal(columnName(0), 'A');
    assert.equal(columnName(25), 'Z');
    assert.equal(columnName(27), 'AB');
    // 2026-11-10 18:00 in São Paulo = serial 46336.75
    assert.equal(excelSerial(NOW), 46336.75);
    assert.equal(formatWait(30 * 60_000), 'menos de 1 h');
    assert.equal(formatWait(5 * 3_600_000), '5 h');
    assert.equal(formatWait(26 * 3_600_000), '1 d 2 h');
    const csv = leadsToCsv(leads);
    assert.match(csv, /Maria Souza;55 \(21\) 99999-0000;Consumidor;Nova Iguaçu/);
  });
});

describe('leads: team replies and contact kind', () => {
  test('a message of the number that is not an AI answer is the team (split answers included)', () => {
    const bot = [
      'Já encaminhei seus dados para nossa equipe verificar o andamento do processo. Alguém retornará em breve.',
    ];
    const entries = [
      { fromMe: false, text: 'Como está o processo?', timestamp: 100 },
      {
        fromMe: true,
        text: 'Já encaminhei seus dados para nossa equipe verificar o andamento do processo.',
        timestamp: 110,
      },
      { fromMe: true, text: 'Alguém retornará em breve.', timestamp: 111 },
    ];
    assert.equal(teamReplyAt(entries, bot), null, 'only AI answers');
    const withTeam = [
      ...entries,
      { fromMe: true, text: 'Dona Sueli, o processo está aguardando o alvará', timestamp: 300 },
    ];
    assert.equal(teamReplyAt(withTeam, bot)?.getTime(), 300_000);
    assert.equal(teamReplyAt([{ fromMe: true, text: '*Oi*, tudo bem?', timestamp: 5 }], ['Oi, tudo bem?']), null);
  });

  test('contactKind: parsed from the model, falls back to nao_juridico when there is no legal need', () => {
    assert.equal(parseExtraction(JSON.stringify({ contactKind: 'cliente_atual' }), [])?.contactKind, 'cliente_atual');
    assert.equal(parseExtraction(JSON.stringify({ noLegalNeed: true }), [])?.contactKind, 'nao_juridico');
    assert.equal(parseExtraction(JSON.stringify({ contactKind: 'vip' }), [])?.contactKind, null);
  });
});

describe('leads: panel preview of the workbook', () => {
  test('same sheets as the file: text as shown, style hints, links, merges and a row cap', () => {
    const leads = Array.from({ length: 5 }, (_, i) => ({
      name: `Pessoa ${i}`,
      remoteJid: `552199999000${i}@s.whatsapp.net`,
      priority: i === 0 ? 'alta' : 'normal',
      status: 'novo',
      lastMessageAt: new Date('2026-11-10T13:05:00Z'),
    }));
    const [summary, sheet] = sheetsToPreview(leadsToXlsxSheets(leads, { instanceName: 'X', now: NOW }), 3);
    assert.equal(summary.name, 'Resumo');
    assert.equal(summary.header, false);
    assert.equal(summary.rows[0][0].span, 3, 'title merged across A:C');
    const band = summary.rows.find((row) => row[0].text === 'PRECISA DE ATENÇÃO AGORA')!;
    assert.equal(band[0].span, 3);
    assert.equal(band[1].skip, true, 'merged cells are skipped in the grid');
    assert.equal(sheet.header, true);
    assert.equal(sheet.rows.length, 4, 'header + 3 rows (cap)');
    assert.equal(sheet.totalRows, 5);
    assert.match(sheet.rows[0][0].cls ?? '', /fill-header/);
    assert.match(sheet.rows[1][1].cls ?? '', /fill-red/);
    assert.equal(sheet.rows[1][5].link, 'https://wa.me/5521999990000');
    assert.equal(sheet.rows[1][18].text, '10/11/2026 10:05', 'dates in São Paulo time');
    assert.equal(sheet.columns[0].letter, 'A');
  });
});
