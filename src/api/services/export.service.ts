/**
 * "Exportar dados da instância": a read-only copy of everything the instance keeps, as a ZIP of CSV files.
 *
 * GET /usage/export/:instanceName?datasets=conversas,mensagens,contatos,leads,agenda
 *
 * - One CSV per selected dataset plus a "leia-me.txt" with the instance name, the generation time and the row counts.
 * - The ZIP is generated while it is downloaded (src/utils/zipStream.ts): rows are read in pages of `pageSize` by
 *   id, so memory stays flat no matter how many messages exist.
 * - Only findMany is called. Nothing is written, deleted or sent to WhatsApp; the connection is never touched.
 * - All queries carry `instanceId`, so the multi-tenant isolation (and the "banco próprio" routing) is the same as
 *   the rest of the API. Everything is ordered by id and the dates are ISO 8601 (UTC).
 *
 * CSV: UTF-8 with BOM, ";" separated and CRLF line endings, the same convention as the leads export (opens directly
 * in Excel configured for Brazil). Cells that look like formulas are prefixed with an apostrophe (CSV injection).
 */
import { Logger } from '@config/logger.config';
import { csvCell } from '@utils/leads';
import { ZipEntrySource, zipFromEntries } from '@utils/zipStream';

export const EXPORT_DATASETS = ['conversas', 'mensagens', 'contatos', 'leads', 'agenda'] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

export const EXPORT_DATASET_LABELS: Record<ExportDataset, string> = {
  conversas: 'Conversas',
  mensagens: 'Mensagens',
  contatos: 'Contatos',
  leads: 'Leads e fichas de triagem',
  agenda: 'Agenda',
};

const DATASET_FILES: Record<ExportDataset, string> = {
  conversas: 'conversas.csv',
  mensagens: 'mensagens.csv',
  contatos: 'contatos.csv',
  leads: 'leads.csv',
  agenda: 'agenda.csv',
};

export class ExportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportValidationError';
  }
}

/**
 * Reads the `datasets` query (`a,b` or repeated parameters). Empty = every dataset. Unknown names are refused so a
 * typo never silently produces an incomplete export.
 */
export function normalizeExportDatasets(input: unknown): ExportDataset[] {
  const values = Array.isArray(input) ? input : input === undefined || input === null ? [] : [input];
  const names = values
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (!names.length) return [...EXPORT_DATASETS];

  const unknown = [...new Set(names.filter((name) => !(EXPORT_DATASETS as readonly string[]).includes(name)))];
  if (unknown.length) {
    throw new ExportValidationError(
      `Opção de exportação desconhecida: ${unknown.join(', ')}. Use: ${EXPORT_DATASETS.join(', ')}.`,
    );
  }

  return [...new Set(names)] as ExportDataset[];
}

const CSV_SEPARATOR = ';';
const DEFAULT_PAGE_SIZE = 500;

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

const iso = (value: unknown): string => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
};

const isoFromSeconds = (value: unknown): string => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : '';
};

/** Lists (labels, missing information) and JSON objects as one readable cell. */
function listText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string' || typeof item === 'number') return String(item);
        const named = item?.name ?? item?.label ?? item?.id;
        return named !== undefined ? String(named) : JSON.stringify(item);
      })
      .filter(Boolean)
      .join(' | ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const shown = item !== null && typeof item === 'object' ? JSON.stringify(item) : text(item);
        return shown ? `${key}: ${shown}` : '';
      })
      .filter(Boolean)
      .join(' | ');
  }
  return String(value);
}

/** The text of a stored WhatsApp message, with a short marker for media (the file itself is not exported). */
export function messageText(message: any): string {
  if (!message || typeof message !== 'object') return '';
  const inner =
    message.ephemeralMessage?.message ??
    message.viewOnceMessage?.message ??
    message.viewOnceMessageV2?.message ??
    message.documentWithCaptionMessage?.message ??
    message;

  const value =
    inner.conversation ||
    inner.extendedTextMessage?.text ||
    inner.imageMessage?.caption ||
    inner.videoMessage?.caption ||
    inner.documentMessage?.caption ||
    inner.speechToText ||
    inner.buttonsResponseMessage?.selectedDisplayText ||
    inner.listResponseMessage?.title ||
    inner.templateButtonReplyMessage?.selectedDisplayText ||
    null;
  if (typeof value === 'string' && value.trim()) return value;

  if (inner.imageMessage) return '[imagem]';
  if (inner.videoMessage || inner.ptvMessage) return '[vídeo]';
  if (inner.audioMessage) return '[áudio]';
  if (inner.documentMessage) {
    const name = inner.documentMessage.fileName;
    return name ? `[documento ${String(name).slice(0, 80)}]` : '[documento]';
  }
  if (inner.stickerMessage) return '[figurinha]';
  if (inner.locationMessage) return '[localização]';
  if (inner.contactMessage || inner.contactsArrayMessage) return '[contato]';
  return '';
}

const COLUMNS = {
  conversas: ['ID', 'Conversa (JID)', 'Nome', 'Rótulos', 'Não lidas', 'Criada em (ISO)', 'Atualizada em (ISO)'],
  mensagens: [
    'ID',
    'Data e hora (ISO)',
    'Conversa (JID)',
    'Contato',
    'Direção',
    'Tipo',
    'Texto',
    'Status',
    'Participante',
  ],
  contatos: ['ID', 'Telefone ou JID', 'Nome', 'Foto', 'Criado em (ISO)', 'Atualizado em (ISO)'],
  leads: [
    'ID',
    'Contato (JID)',
    'Nome',
    'Área',
    'Cidade',
    'Resumo',
    'Situação',
    'Prioridade',
    'Motivo da prioridade',
    'Próximo passo',
    'Parte contrária',
    'Origem',
    'Informações faltando',
    'Pontos de atenção',
    'Dados preenchidos pela equipe',
    'Primeira mensagem (ISO)',
    'Última mensagem (ISO)',
    'Criado em (ISO)',
    'Atualizado em (ISO)',
  ],
  agenda: [
    'ID',
    'Contato (JID)',
    'Nome',
    'Tipo',
    'Modalidade',
    'Início (ISO)',
    'Fim (ISO)',
    'Situação',
    'Origem',
    'Observações',
    'Criado em (ISO)',
  ],
} as const;

const SELECTS: Record<ExportDataset, Record<string, boolean>> = {
  conversas: {
    id: true,
    remoteJid: true,
    name: true,
    labels: true,
    unreadMessages: true,
    createdAt: true,
    updatedAt: true,
  },
  mensagens: {
    id: true,
    key: true,
    pushName: true,
    participant: true,
    messageType: true,
    message: true,
    messageTimestamp: true,
    status: true,
  },
  contatos: {
    id: true,
    remoteJid: true,
    pushName: true,
    profilePicUrl: true,
    createdAt: true,
    updatedAt: true,
  },
  leads: {
    id: true,
    remoteJid: true,
    pushName: true,
    name: true,
    area: true,
    city: true,
    summary: true,
    status: true,
    priority: true,
    priorityReason: true,
    nextStep: true,
    opposingParty: true,
    source: true,
    missingInfo: true,
    attentionPoints: true,
    manualFields: true,
    firstMessageAt: true,
    lastMessageAt: true,
    createdAt: true,
    updatedAt: true,
  },
  agenda: {
    id: true,
    remoteJid: true,
    contactName: true,
    typeName: true,
    mode: true,
    startsAt: true,
    endsAt: true,
    status: true,
    source: true,
    notes: true,
    createdAt: true,
  },
};

const MODELS: Record<ExportDataset, string> = {
  conversas: 'chat',
  mensagens: 'message',
  contatos: 'contact',
  leads: 'lead',
  agenda: 'appointment',
};

function slugName(instanceName: string): string {
  const slug = String(instanceName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'instancia';
}

export class ExportService {
  private readonly logger = new Logger('ExportService');
  private readonly pageSize: number;

  constructor(
    private readonly prisma: any,
    private readonly options: { now?: () => number; pageSize?: number } = {},
  ) {
    this.pageSize = Math.max(1, this.options.pageSize ?? DEFAULT_PAGE_SIZE);
  }

  private now(): Date {
    return new Date((this.options.now ?? Date.now)());
  }

  public fileName(instanceName: string): string {
    return `dados-${slugName(instanceName)}-${this.now().toISOString().slice(0, 10)}.zip`;
  }

  /**
   * The whole archive as a stream of Buffers. Rows are read one page at a time while the ZIP is written; breaking
   * the iteration (client disconnect) stops the database reads.
   */
  public async *streamZip(instanceId: string, instanceName: string, datasets: ExportDataset[]): AsyncGenerator<Buffer> {
    const startedAt = this.now().toISOString();
    this.logger.log(
      `Exportação iniciada: instância ${instanceName}, arquivos ${datasets.map((d) => DATASET_FILES[d]).join(', ')}`,
    );
    const counts = new Map<ExportDataset, number>();
    let bytes = 0;
    try {
      for await (const chunk of zipFromEntries(this.entries(instanceId, instanceName, datasets, counts, startedAt))) {
        bytes += chunk.length;
        yield chunk;
      }
      this.logger.log(`Exportação concluída: instância ${instanceName}, ${bytes} bytes`);
    } catch (error) {
      this.logger.error(`Exportação falhou: instância ${instanceName}: ${error?.message ?? error}`);
      throw error;
    }
  }

  /** One entry per selected dataset, then the "leia-me.txt" (written last, with the counts of every file). */
  private async *entries(
    instanceId: string,
    instanceName: string,
    datasets: ExportDataset[],
    counts: Map<ExportDataset, number>,
    startedAt: string,
  ): AsyncGenerator<ZipEntrySource> {
    for (const dataset of datasets) {
      yield {
        name: DATASET_FILES[dataset],
        data: this.csvData(instanceId, dataset, counts),
      };
    }
    yield {
      name: 'leia-me.txt',
      data: (async function* (readme: string) {
        yield readme;
      })(this.readme(instanceName, datasets, counts, startedAt)),
    };
  }

  private async *csvData(
    instanceId: string,
    dataset: ExportDataset,
    counts: Map<ExportDataset, number>,
  ): AsyncGenerator<string> {
    const header = COLUMNS[dataset];
    yield `${String.fromCharCode(0xfeff)}${header.map(csvCell).join(CSV_SEPARATOR)}\r\n`;
    for await (const row of this.rows(instanceId, dataset, counts)) {
      yield `${row.map(csvCell).join(CSV_SEPARATOR)}\r\n`;
    }
  }

  /** Pages of the selected model, always filtered by instanceId (multi-tenant isolation and "banco próprio"). */
  private async *rows(
    instanceId: string,
    dataset: ExportDataset,
    counts: Map<ExportDataset, number>,
  ): AsyncGenerator<unknown[]> {
    const model = MODELS[dataset];
    const select = SELECTS[dataset];
    let cursor: string | undefined;

    while (true) {
      const page: any[] = await this.prisma[model].findMany({
        where: { instanceId },
        select,
        orderBy: { id: 'asc' },
        take: this.pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!page?.length) return;

      for (const row of page) {
        counts.set(dataset, (counts.get(dataset) ?? 0) + 1);
        yield this.rowValues(dataset, row);
      }
      if (page.length < this.pageSize) return;
      cursor = page[page.length - 1].id;
    }
  }

  private rowValues(dataset: ExportDataset, row: any): unknown[] {
    switch (dataset) {
      case 'conversas':
        return [
          row.id,
          row.remoteJid,
          text(row.name),
          listText(row.labels),
          Number(row.unreadMessages) || 0,
          iso(row.createdAt),
          iso(row.updatedAt),
        ];
      case 'mensagens':
        return [
          row.id,
          isoFromSeconds(row.messageTimestamp),
          text(row.key?.remoteJid),
          text(row.pushName),
          row.key?.fromMe ? 'Equipe' : 'Cliente',
          text(row.messageType),
          messageText(row.message),
          text(row.status),
          text(row.participant),
        ];
      case 'contatos':
        return [
          row.id,
          row.remoteJid,
          text(row.pushName),
          text(row.profilePicUrl),
          iso(row.createdAt),
          iso(row.updatedAt),
        ];
      case 'leads':
        return [
          row.id,
          row.remoteJid,
          text(row.name || row.pushName),
          text(row.area),
          text(row.city),
          text(row.summary),
          text(row.status),
          text(row.priority),
          text(row.priorityReason),
          text(row.nextStep),
          text(row.opposingParty),
          text(row.source),
          listText(row.missingInfo),
          listText(row.attentionPoints),
          listText(row.manualFields),
          iso(row.firstMessageAt),
          iso(row.lastMessageAt),
          iso(row.createdAt),
          iso(row.updatedAt),
        ];
      case 'agenda':
        return [
          row.id,
          row.remoteJid,
          text(row.contactName),
          text(row.typeName),
          text(row.mode),
          iso(row.startsAt),
          iso(row.endsAt),
          text(row.status),
          text(row.source),
          text(row.notes),
          iso(row.createdAt),
        ];
      default:
        return [];
    }
  }

  private readme(
    instanceName: string,
    datasets: ExportDataset[],
    counts: Map<ExportDataset, number>,
    startedAt: string,
  ): string {
    const files = datasets
      .map((dataset) => `- ${DATASET_FILES[dataset]}: ${counts.get(dataset) ?? 0} registro(s)`)
      .join('\n');
    return [
      'WhatsAI — exportação dos dados da instância',
      '',
      `Instância: ${instanceName}`,
      `Gerado em: ${startedAt}`,
      '',
      'Arquivos',
      files,
      '',
      'O que é',
      `Esta é uma cópia somente leitura dos dados guardados pela instância ${instanceName} no WhatsAI.`,
      'Nenhum dado foi apagado ou alterado e a conexão do WhatsApp não foi tocada.',
      'O pedido de exportação fica registrado no log do servidor.',
      '',
      'Formato',
      'CSV em UTF-8 (com BOM), separado por ponto e vírgula, para abrir direto no Excel em português.',
      'Datas no padrão ISO 8601, em UTC (por exemplo, 2026-11-12T14:30:00.000Z).',
      '',
      'Privacidade',
      'A exportação atende ao direito de portabilidade da LGPD. Guarde o arquivo com cuidado:',
      'ele contém conversas e dados pessoais dos contatos.',
      '',
    ].join('\n');
  }
}
