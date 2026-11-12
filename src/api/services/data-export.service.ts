/**
 * "Exportar dados da instância" (portabilidade da LGPD, art. 18, V): um ZIP com o que a instância guarda no banco do
 * WhatsAI, para a empresa levar consigo ou atender o pedido de um contato.
 *
 * - Gerado em fluxo: cada tabela é lida em lotes (cursor por id) e comprimida enquanto é enviada; a memória fica
 *   presa a um lote, não ao tamanho da instância. Entre lotes, espera o cliente esvaziar o buffer (backpressure).
 * - Só dados da conversa e do atendimento. Nunca entram: token da instância, chaves e credenciais (OpenAI, Google,
 *   banco próprio), configurações de webhook/integrações, código do cliente. Este serviço só lê as tabelas abaixo.
 * - Mídias: o ZIP traz a referência de cada mídia, não o arquivo (o conteúdo em base64, quando existe, é retirado).
 * - O registro no log diz quem, quando e quantas linhas, nunca o conteúdo.
 */
import { Zip, ZipDeflate } from 'fflate';

export type ExportSink = {
  write(chunk: Uint8Array): boolean;
  /** Resolves when the sink can take more data (HTTP response "drain"). */
  drain(): Promise<void>;
  end(): void;
};

type Logger = { info(msg: string): void; error(msg: unknown): void };

type Deps = { prisma: any; logger?: Logger; batchSize?: number; now?: () => Date };

export class ExportBusyError extends Error {}

const enc = new TextEncoder();

/** CSV cell: quotes when needed and neutralizes formulas (=, +, -, @) for spreadsheet apps. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s =
    value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Removes inline media bytes (base64/jpegThumbnail) from a WhatsApp message object, keeping everything else. */
export function stripMedia(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== 'object' || depth > 8) return value;
  if (Array.isArray(value)) return value.map((v) => stripMedia(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'base64' || k === 'jpegThumbnail' || k === 'thumbnailDirectPath') continue;
    out[k] = stripMedia(v, depth + 1);
  }
  return out;
}

const README = `Exportação dos dados de uma instância do WhatsAI

Arquivos:
- instancia.json: nome, número e estado da conexão da instância.
- mensagens.jsonl: uma mensagem por linha (JSON), com o contato (remoteJid), quem enviou (fromMe),
  o tipo, o conteúdo e a data (messageTimestamp, em segundos desde 1970). Mídias vêm só como referência.
- contatos.csv e conversas.csv: lista de contatos e de conversas.
- leads.jsonl: fichas de triagem, uma por linha.
- agendamentos.csv: agendamentos.
- processos.jsonl e publicacoes.jsonl: processos acompanhados, com andamentos, e publicações (quando usados).

Não entram: chaves de acesso, tokens, credenciais, configurações de integrações e mensagens já apagadas pelo prazo
de guarda. As conversas continuam também no WhatsApp da empresa.
`;

export class DataExportService {
  private readonly running = new Set<string>();

  constructor(private readonly deps: Deps) {}

  public isRunning(instanceId: string) {
    return this.running.has(instanceId);
  }

  /** Writes the ZIP of the instance to `sink`. One export at a time per instance. */
  public async exportInstance(instance: { id: string; name: string }, sink: ExportSink) {
    if (this.running.has(instance.id))
      throw new ExportBusyError('Já existe uma exportação desta instância em andamento.');
    this.running.add(instance.id);
    const started = Date.now();
    const counts: Record<string, number> = {};
    let failed: unknown = null;
    const zip = new Zip((err, chunk) => {
      if (err) {
        failed = err;
        return;
      }
      sink.write(chunk);
    });
    try {
      const prisma = this.deps.prisma;
      const id = instance.id;
      const now = (this.deps.now ?? (() => new Date()))();

      const info = await prisma.instance.findUnique({
        where: { id },
        select: {
          name: true,
          number: true,
          ownerJid: true,
          profileName: true,
          connectionStatus: true,
          integration: true,
          createdAt: true,
        },
      });
      this.small(zip, 'LEIA-ME.txt', README);
      this.small(zip, 'instancia.json', JSON.stringify({ ...info, exportedAt: now.toISOString() }, null, 2));

      counts.mensagens = await this.table(
        zip,
        sink,
        'mensagens.jsonl',
        null,
        (cursor, take) =>
          prisma.message.findMany({
            where: { instanceId: id },
            select: {
              id: true,
              key: true,
              pushName: true,
              messageType: true,
              message: true,
              messageTimestamp: true,
              status: true,
            },
            ...page(cursor, take),
          }),
        (m: any) =>
          JSON.stringify({
            id: m.id,
            remoteJid: m.key?.remoteJid ?? null,
            fromMe: !!m.key?.fromMe,
            pushName: m.pushName ?? null,
            messageType: m.messageType,
            message: stripMedia(m.message),
            messageTimestamp: m.messageTimestamp,
            status: m.status ?? null,
          }),
      );
      counts.contatos = await this.table(
        zip,
        sink,
        'contatos.csv',
        ['remoteJid', 'pushName', 'createdAt'],
        (cursor, take) =>
          prisma.contact.findMany({
            where: { instanceId: id },
            select: { id: true, remoteJid: true, pushName: true, createdAt: true },
            ...page(cursor, take),
          }),
      );
      counts.conversas = await this.table(
        zip,
        sink,
        'conversas.csv',
        ['remoteJid', 'name', 'unreadMessages', 'createdAt', 'updatedAt'],
        (cursor, take) =>
          prisma.chat.findMany({
            where: { instanceId: id },
            select: { id: true, remoteJid: true, name: true, unreadMessages: true, createdAt: true, updatedAt: true },
            ...page(cursor, take),
          }),
      );
      counts.leads = await this.table(zip, sink, 'leads.jsonl', null, (cursor, take) =>
        prisma.lead.findMany({ where: { instanceId: id }, omit: { instanceId: true }, ...page(cursor, take) }),
      );
      counts.agendamentos = await this.table(
        zip,
        sink,
        'agendamentos.csv',
        [
          'remoteJid',
          'contactName',
          'typeName',
          'mode',
          'startsAt',
          'endsAt',
          'status',
          'notes',
          'source',
          'createdAt',
        ],
        (cursor, take) =>
          prisma.appointment.findMany({
            where: { instanceId: id },
            select: {
              id: true,
              remoteJid: true,
              contactName: true,
              typeName: true,
              mode: true,
              startsAt: true,
              endsAt: true,
              status: true,
              notes: true,
              source: true,
              createdAt: true,
            },
            ...page(cursor, take),
          }),
      );
      counts.processos = await this.table(
        zip,
        sink,
        'processos.jsonl',
        null,
        (cursor, take) =>
          prisma.process.findMany({
            where: { instanceId: id },
            omit: { instanceId: true },
            include: { ProcessMovement: { orderBy: { occurredAt: 'desc' }, omit: { processId: true } } },
            ...page(cursor, take),
          }),
        undefined,
        Math.min(this.batch(), 50),
      );
      counts.publicacoes = await this.table(zip, sink, 'publicacoes.jsonl', null, (cursor, take) =>
        prisma.publication.findMany({
          where: { instanceId: id },
          omit: { instanceId: true },
          ...page(cursor, take),
        }),
      );

      zip.end();
      if (failed) throw failed;
      sink.end();
      this.deps.logger?.info(
        `export: instância "${instance.name}" exportada em ${Date.now() - started} ms (` +
          Object.entries(counts)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ') +
          ')',
      );
      return counts;
    } catch (error) {
      try {
        zip.terminate();
      } catch {
        /* already finished */
      }
      this.deps.logger?.error(`export: falha ao exportar a instância "${instance.name}": ${(error as Error)?.message}`);
      throw error;
    } finally {
      this.running.delete(instance.id);
    }
  }

  private batch() {
    return this.deps.batchSize ?? 500;
  }

  private small(zip: Zip, name: string, text: string) {
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    file.push(enc.encode(text), true);
  }

  /**
   * One file from one table, read in pages. `columns` makes a CSV (header + one row per record); without it, JSON
   * lines (`line` decides the shape; default: the record as it is). `take` is the page size.
   */
  private async table(
    zip: Zip,
    sink: ExportSink,
    name: string,
    columns: string[] | null,
    fetch: (cursor: string | null, take: number) => Promise<any[]>,
    line: (row: any) => string = (row) => JSON.stringify(row),
    take = this.batch(),
  ): Promise<number> {
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    if (columns) file.push(enc.encode('﻿' + columns.join(',') + '\n'));
    let cursor: string | null = null;
    let total = 0;
    for (;;) {
      const rows = await fetch(cursor, take);
      if (!rows?.length) break;
      const text = rows.map((row) => (columns ? columns.map((c) => csvCell(row[c])).join(',') : line(row))).join('\n');
      file.push(enc.encode(text + '\n'));
      total += rows.length;
      cursor = rows[rows.length - 1].id;
      await sink.drain();
      if (rows.length < take) break;
    }
    file.push(new Uint8Array(0), true);
    return total;
  }
}

function page(cursor: string | null, take: number) {
  return cursor
    ? { orderBy: { id: 'asc' as const }, take, skip: 1, cursor: { id: cursor } }
    : { orderBy: { id: 'asc' as const }, take };
}
