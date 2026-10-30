import { deflateSync } from 'node:zlib';

/** Minimal PDF with `pages` pages in plain (uncompressed) objects. */
export function plainPdf(pages: number, options: { withCount?: boolean } = {}): Buffer {
  const withCount = options.withCount ?? true;
  const kids = Array.from({ length: pages }, (_, index) => `${index + 3} 0 R`).join(' ');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    `2 0 obj\n<< /Type /Pages /Kids [${kids}]${withCount ? ` /Count ${pages}` : ''} >>\nendobj`,
    ...Array.from(
      { length: pages },
      (_, index) => `${index + 3} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj`,
    ),
  ];
  return Buffer.from(`%PDF-1.4\n${objects.join('\n')}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}

/** PDF 1.5 whose page tree and pages live inside a compressed object stream (no plain /Type /Page). */
export function objectStreamPdf(pages: number, options: { withCount?: boolean } = {}): Buffer {
  const withCount = options.withCount ?? true;
  const kids = Array.from({ length: pages }, (_, index) => `${index + 3} 0 R`).join(' ');
  const inner = [
    `<< /Type /Pages /Kids [${kids}]${withCount ? ` /Count ${pages}` : ''} >>`,
    ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R >>'),
  ].join('\n');
  const data = deflateSync(Buffer.from(inner, 'latin1'));

  return Buffer.concat([
    Buffer.from('%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'latin1'),
    Buffer.from(
      `9 0 obj\n<< /Type /ObjStm /N ${pages + 1} /First 0 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`,
    ),
    data,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
}
