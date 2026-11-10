/**
 * Minimal XLSX (Office Open XML) writer, no dependency: a zip with the sheet XML, shared styles and real dates.
 *
 * Enough for formatted reports: column widths, a styled header, frozen panes, auto filter, wrapped text, colours
 * (fills) per cell, Excel dates (serial numbers with a pt-BR format), numbers and hyperlinks. Strings are written
 * inline (no shared strings table). Opens in Excel, LibreOffice, Google Sheets and Numbers.
 */
import { crc32, deflateRawSync } from 'node:zlib';

export type XlsxFill = 'header' | 'red' | 'amber' | 'green' | 'grey' | 'soft' | 'band' | 'bandRed' | 'bandGreen';

export interface XlsxCellStyle {
  bold?: boolean;
  fill?: XlsxFill;
  wrap?: boolean;
  /** 'datetime' (dd/mm/aaaa hh:mm), 'date' (dd/mm/aaaa) or 'int' */
  format?: 'datetime' | 'date' | 'int';
  color?: 'muted' | 'link' | 'white';
  align?: 'center';
  /** Font size in points (default 11) */
  size?: number;
  /** Thin light grid around the cell */
  border?: boolean;
}

export type XlsxValue = string | number | Date | null | undefined;

export interface XlsxCell {
  value: XlsxValue;
  style?: XlsxCellStyle;
  /** External link: the cell shows `value` and opens this URL */
  link?: string;
}

export interface XlsxColumn {
  header: string;
  width: number;
}

export interface XlsxSheet {
  name: string;
  columns: XlsxColumn[];
  rows: (XlsxValue | XlsxCell)[][];
  /** Freeze the header row and this many columns (default: header only) */
  freezeColumns?: number;
  autoFilter?: boolean;
  /** No styled header row (the first row is data, e.g. a summary sheet with its own titles) */
  noHeader?: boolean;
  /** Thin light grid on every data cell (tables) */
  grid?: boolean;
  /** Merged ranges, e.g. "A1:C1" */
  merges?: string[];
  /** Custom row heights in points, by 1-based row number (Excel does not grow merged wrapped rows by itself) */
  rowHeights?: Record<number, number>;
}

const FILLS: Record<XlsxFill, string> = {
  header: 'FF1A1A1A',
  red: 'FFFDE2E1',
  amber: 'FFFDF0D5',
  green: 'FFE3F4E8',
  grey: 'FFF0F0F0',
  soft: 'FFF2F2EF',
  band: 'FF262626',
  bandRed: 'FFB42318',
  bandGreen: 'FF1E6B3A',
};
const FONT_COLORS = { muted: 'FF5E5E5E', link: 'FF1F5FBF', white: 'FFFFFFFF' } as const;
const FORMATS = { datetime: 164, date: 165, int: 1 } as const;

const xmlEscape = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // control characters are invalid in XML 1.0 (keep tab, LF, CR)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export function columnName(index: number): string {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Excel serial date of the wall-clock time shown in `timeZone` (Excel has no time zones). */
export function excelSerial(date: Date, timeZone = 'America/Sao_Paulo'): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return local / 86_400_000 + 25569;
}

/** Style registry: every distinct cell style becomes one `xf` of styles.xml. */
class Styles {
  private readonly keys: string[] = [];
  private readonly list: XlsxCellStyle[] = [];

  constructor() {
    this.index({}); // 0 = default
  }

  index(style: XlsxCellStyle = {}): number {
    const key = JSON.stringify(style, Object.keys(style).sort());
    const found = this.keys.indexOf(key);
    if (found >= 0) return found;
    this.keys.push(key);
    this.list.push(style);
    return this.list.length - 1;
  }

  xml(): string {
    const fonts: string[] = [];
    const fontIndex = (style: XlsxCellStyle) => {
      const color = style.color ? FONT_COLORS[style.color] : null;
      const xml = `<font>${style.bold ? '<b/>' : ''}<sz val="${style.size ?? 11}"/>${color ? `<color rgb="${color}"/>` : ''}<name val="Calibri"/><family val="2"/></font>`;
      const at = fonts.indexOf(xml);
      return at >= 0 ? at : fonts.push(xml) - 1;
    };
    const fillNames = Object.keys(FILLS) as XlsxFill[];
    const xfs = this.list.map((style) => {
      const font = fontIndex(style);
      const fill = style.fill ? fillNames.indexOf(style.fill) + 2 : 0;
      const numFmt = style.format ? FORMATS[style.format] : 0;
      const alignment =
        style.wrap || style.align
          ? `<alignment vertical="top"${style.wrap ? ' wrapText="1"' : ''}${style.align ? ` horizontal="${style.align}"` : ''}/>`
          : '<alignment vertical="top"/>';
      return (
        `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${style.fill === 'header' ? 1 : style.border ? 2 : 0}" xfId="0"` +
        `${numFmt ? ' applyNumberFormat="1"' : ''} applyFont="1"${fill ? ' applyFill="1"' : ''} applyAlignment="1">${alignment}</xf>`
      );
    });
    const fills = [
      '<fill><patternFill patternType="none"/></fill>',
      '<fill><patternFill patternType="gray125"/></fill>',
      ...fillNames.map(
        (name) =>
          `<fill><patternFill patternType="solid"><fgColor rgb="${FILLS[name]}"/><bgColor indexed="64"/></patternFill></fill>`,
      ),
    ];
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>' +
      `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
      `<fills count="${fills.length}">${fills.join('')}</fills>` +
      '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="thin"><color rgb="FF606060"/></bottom><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right>' +
      '<top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>'
    );
  }
}

const isCell = (value: unknown): value is XlsxCell =>
  !!value && typeof value === 'object' && !(value instanceof Date) && 'value' in (value as any);

function sheetXml(sheet: XlsxSheet, styles: Styles): { xml: string; links: { ref: string; url: string }[] } {
  const header = styles.index({ bold: true, fill: 'header', color: 'white', wrap: true });
  const rows: string[] = [];
  const links: { ref: string; url: string }[] = [];
  const all: (XlsxValue | XlsxCell)[][] = sheet.noHeader
    ? sheet.rows
    : [sheet.columns.map((c) => c.header), ...sheet.rows];

  all.forEach((row, r) => {
    const cells: string[] = [];
    row.forEach((raw, c) => {
      const ref = `${columnName(c)}${r + 1}`;
      const cell: XlsxCell = isCell(raw) ? raw : { value: raw };
      const isHeader = !sheet.noHeader && r === 0;
      let style = sheet.grid && !(!sheet.noHeader && r === 0) ? { border: true, ...cell.style } : (cell.style ?? {});
      if (cell.value instanceof Date && !style.format) style = { ...style, format: 'datetime' };
      if (cell.link) {
        style = { ...style, color: 'link' };
        links.push({ ref, url: cell.link });
      }
      const s = isHeader ? header : styles.index(style);
      const value = cell.value;
      if (value === null || value === undefined || value === '') {
        if (s) cells.push(`<c r="${ref}" s="${s}"/>`);
      } else if (value instanceof Date) {
        if (Number.isFinite(value.getTime())) cells.push(`<c r="${ref}" s="${s}"><v>${excelSerial(value)}</v></c>`);
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        cells.push(`<c r="${ref}" s="${s}"><v>${value}</v></c>`);
      } else {
        cells.push(
          `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`,
        );
      }
    });
    const height = sheet.rowHeights?.[r + 1];
    rows.push(`<row r="${r + 1}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells.join('')}</row>`);
  });

  const lastCol = columnName(Math.max(sheet.columns.length, 1) - 1);
  const freezeCols = sheet.freezeColumns ?? 0;
  const pane = sheet.noHeader
    ? ''
    : `<pane ${freezeCols ? `xSplit="${freezeCols}" ` : ''}ySplit="1" topLeftCell="${columnName(freezeCols)}2" activePane="${freezeCols ? 'bottomRight' : 'bottomLeft'}" state="frozen"/>`;
  const cols = sheet.columns
    .map((col, i) => `<col min="${i + 1}" max="${i + 1}" width="${col.width}" customWidth="1"/>`)
    .join('');
  const filter =
    sheet.autoFilter && !sheet.noHeader && all.length > 1 ? `<autoFilter ref="A1:${lastCol}${all.length}"/>` : '';
  const hyperlinks = links.length
    ? `<hyperlinks>${links.map((link, i) => `<hyperlink ref="${link.ref}" r:id="rId${i + 1}"/>`).join('')}</hyperlinks>`
    : '';

  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${rows.join('')}</sheetData>` +
    filter +
    (sheet.merges?.length
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
      : '') +
    hyperlinks +
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
    '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
    '</worksheet>';
  return { xml, links };
}

// ---------------------------------------------------------------------------------------------------- zip

function zip(files: { name: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt32LE(0, 10); // time/date
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(compressed.length, 18);
    head.writeUInt32LE(file.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28);
    local.push(head, name, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(0, 12);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += head.length + name.length + compressed.length;
  }
  const centralSize = central.reduce((sum, buf) => sum + buf.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

/** The .xlsx file of the given sheets (the first one opens selected). */
export function buildXlsx(sheets: XlsxSheet[], meta: { title?: string; creator?: string } = {}): Buffer {
  const styles = new Styles();
  const files: { name: string; data: Buffer }[] = [];
  const text = (name: string, xml: string) => files.push({ name, data: Buffer.from(xml, 'utf8') });
  const safeName = (name: string, i: number) =>
    xmlEscape(
      name
        .replace(/[\\/?*[\]:]/g, ' ')
        .slice(0, 31)
        .trim() || `Planilha ${i + 1}`,
    );

  const rendered = sheets.map((sheet) => sheetXml(sheet, styles));

  text(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>',
  );
  text(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>',
  );
  text(
    'docProps/core.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${xmlEscape(meta.title ?? '')}</dc:title><dc:creator>${xmlEscape(meta.creator ?? 'WhatsAI')}</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</dcterms:created>` +
      '</cp:coreProperties>',
  );
  text(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
      sheets
        .map((sheet, i) => `<sheet name="${safeName(sheet.name, i)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('') +
      '</sheets>' +
      // the auto filter range of each sheet must also exist as a hidden defined name for Excel to accept it
      (sheets.some((sheet, i) => rendered[i] && sheet.autoFilter && !sheet.noHeader && sheet.rows.length)
        ? '<definedNames>' +
          sheets
            .map((sheet, i) =>
              sheet.autoFilter && !sheet.noHeader && sheet.rows.length
                ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${safeName(sheet.name, i).replace(/'/g, "''")}'!$A$1:$${columnName(sheet.columns.length - 1)}$${sheet.rows.length + 1}</definedName>`
                : '',
            )
            .join('') +
          '</definedNames>'
        : '') +
      '</workbook>',
  );
  text(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
  );
  rendered.forEach((sheet, i) => {
    text(`xl/worksheets/sheet${i + 1}.xml`, sheet.xml);
    if (sheet.links.length) {
      text(
        `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheet.links
            .map(
              (link, j) =>
                `<Relationship Id="rId${j + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(link.url)}" TargetMode="External"/>`,
            )
            .join('') +
          '</Relationships>',
      );
    }
  });
  // styles last: every sheet registered its styles while rendering
  text('xl/styles.xml', styles.xml());
  return zip(files);
}

// ---------------------------------------------------------------------------------------------------- preview

export interface XlsxPreviewCell {
  text: string;
  /** CSS hints for the panel viewer: b, wrap, num, center, fill-<fill>, c-<color>, big, title */
  cls?: string;
  link?: string;
  span?: number;
  skip?: true;
}

export interface XlsxPreviewSheet {
  name: string;
  header: boolean;
  columns: { width: number; letter: string }[];
  rows: XlsxPreviewCell[][];
  totalRows: number;
}

function previewText(value: XlsxValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return '';
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(value)
        .map((part) => [part.type, part.value]),
    );
    return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
  }
  return typeof value === 'number' ? value.toLocaleString('pt-BR') : String(value);
}

/**
 * The same sheets as plain JSON for the panel viewer: the text as Excel shows it (dates in São Paulo time), style
 * hints as CSS classes, links and horizontal merges (span/skip). At most `maxRows` data rows per table sheet.
 */
export function sheetsToPreview(sheets: XlsxSheet[], maxRows = 300): XlsxPreviewSheet[] {
  return sheets.map((sheet) => {
    const header = !sheet.noHeader;
    // the cap is for tables (one row per record); a report sheet is always shown whole
    const data = header ? sheet.rows.slice(0, maxRows) : sheet.rows;
    const all: (XlsxValue | XlsxCell)[][] = header ? [sheet.columns.map((c) => c.header), ...data] : data;
    const spans = new Map<string, number>();
    const skips = new Set<string>();
    for (const ref of sheet.merges ?? []) {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
      if (!m || m[2] !== m[4]) continue;
      const toIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const row = Number(m[2]) - 1;
      const from = toIndex(m[1]);
      const to = toIndex(m[3]);
      spans.set(`${row}:${from}`, to - from + 1);
      for (let c = from + 1; c <= to; c++) skips.add(`${row}:${c}`);
    }
    const rows = all.map((row, r) =>
      Array.from({ length: Math.max(row.length, 1) }, (_, c): XlsxPreviewCell => {
        if (skips.has(`${r}:${c}`)) return { text: '', skip: true };
        const raw = row[c];
        const cell: XlsxCell = isCell(raw) ? raw : { value: raw as XlsxValue };
        const style =
          header && r === 0 ? { bold: true, fill: 'header' as XlsxFill, color: 'white' as const } : (cell.style ?? {});
        const cls = [
          style.bold ? 'b' : '',
          style.wrap ? 'wrap' : '',
          typeof cell.value === 'number' || cell.value instanceof Date ? 'num' : '',
          style.align === 'center' ? 'center' : '',
          style.fill ? `fill-${style.fill}` : '',
          style.color ? `c-${style.color}` : '',
          style.size && style.size >= 16 ? 'title' : style.size && style.size > 11 ? 'big' : '',
          sheet.grid && !(header && r === 0) ? 'grid' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const out: XlsxPreviewCell = { text: previewText(cell.value) };
        if (cls) out.cls = cls;
        if (cell.link) out.link = cell.link;
        const span = spans.get(`${r}:${c}`);
        if (span) out.span = span;
        return out;
      }),
    );
    return {
      name: sheet.name,
      header,
      columns: sheet.columns.map((col, i) => ({ width: col.width, letter: columnName(i) })),
      rows,
      totalRows: sheet.rows.length,
    };
  });
}
