/**
 * Streaming ZIP writer (deflate, UTF-8 names), no dependency.
 *
 * The export of an instance can be large (years of messages), so nothing is kept in memory: each entry is written as
 * a local header, the deflated chunks and a data descriptor (general purpose bit 3), and the central directory is
 * written at the end. The sizes and the CRC-32 are only known after the deflate stream ends, hence the descriptor.
 *
 * Limits: ZIP32 only (each entry and the whole archive must stay under 4 GiB). A larger export aborts mid-stream
 * with a clear error instead of producing a corrupt file.
 *
 * Everything is produced as an async iterable of Buffers so the caller can pipe it to an HTTP response and stop
 * early (client disconnect) without buffering the archive.
 */
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32, createDeflateRaw } from 'node:zlib';

export interface ZipEntrySource {
  /** File name inside the archive (UTF-8, forward slashes). */
  name: string;
  /** Content, in order; strings are written as UTF-8. */
  data: AsyncIterable<Buffer | string>;
}

export interface ZipEntryInfo {
  name: string;
  crc: number;
  /** Uncompressed bytes. */
  rawBytes: number;
  /** Deflated bytes. */
  compressedBytes: number;
  /** Offset of the local header inside the archive. */
  offset: number;
}

const LOCAL_FILE = 0x04034b50;
const CENTRAL_DIR = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
/** Bit 3: sizes and CRC come in the data descriptor. Bit 11: names are UTF-8. */
const FLAGS = 0x0808;
const VERSION = 20;
const DEFLATE = 8;
/** 1980-01-01, the minimum DOS date (the archive does not need real timestamps). */
const DOS_DATE = 0x0021;
const MAX32 = 0xffffffff;

function asBuffer(chunk: Buffer | string): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
}

function localHeader(name: Buffer): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_FILE, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(FLAGS, 6);
  header.writeUInt16LE(DEFLATE, 8);
  header.writeUInt16LE(0, 10); // modification time
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(0, 14); // crc-32, in the data descriptor
  header.writeUInt32LE(0, 18); // compressed size, in the data descriptor
  header.writeUInt32LE(0, 22); // uncompressed size, in the data descriptor
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28); // extra field length
  return header;
}

function dataDescriptor(info: Pick<ZipEntryInfo, 'crc' | 'compressedBytes' | 'rawBytes'>): Buffer {
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(info.crc >>> 0, 4);
  descriptor.writeUInt32LE(info.compressedBytes >>> 0, 8);
  descriptor.writeUInt32LE(info.rawBytes >>> 0, 12);
  return descriptor;
}

function centralHeader(info: ZipEntryInfo, name: Buffer): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_DIR, 0);
  header.writeUInt16LE(VERSION, 4); // version made by
  header.writeUInt16LE(VERSION, 6); // version needed
  header.writeUInt16LE(FLAGS, 8);
  header.writeUInt16LE(DEFLATE, 10);
  header.writeUInt16LE(0, 12); // modification time
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(info.crc >>> 0, 16);
  header.writeUInt32LE(info.compressedBytes >>> 0, 20);
  header.writeUInt32LE(info.rawBytes >>> 0, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30); // extra field length
  header.writeUInt16LE(0, 32); // comment length
  header.writeUInt16LE(0, 34); // disk number
  header.writeUInt16LE(0, 36); // internal attributes
  header.writeUInt32LE(0, 38); // external attributes
  header.writeUInt32LE(info.offset >>> 0, 42);
  return header;
}

function endRecord(count: number, centralOffset: number, centralSize: number): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk of the central directory
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralSize >>> 0, 12);
  end.writeUInt32LE(centralOffset >>> 0, 16);
  end.writeUInt16LE(0, 20); // comment length
  return end;
}

type Deflated = { crc: number; rawBytes: number; compressedBytes: number };

/**
 * Deflates one entry chunk by chunk, counting the CRC and both sizes. The returned generator yields the compressed
 * bytes; its return value carries the numbers of the data descriptor.
 */
async function* deflateEntry(data: AsyncIterable<Buffer | string>): AsyncGenerator<Buffer, Deflated> {
  const deflate = createDeflateRaw();
  const output = new PassThrough();
  let crc = 0;
  let rawBytes = 0;

  const counted = async function* () {
    for await (const chunk of data) {
      const buffer = asBuffer(chunk);
      crc = crc32(buffer, crc) >>> 0;
      rawBytes += buffer.length;
      yield buffer;
    }
  };

  // pipeline() destroys every stream when the consumer goes away (client disconnect), so the producer never hangs
  const done = pipeline(Readable.from(counted(), { objectMode: false }), deflate, output);

  let compressedBytes = 0;
  try {
    for await (const chunk of output) {
      compressedBytes += chunk.length;
      yield chunk as Buffer;
    }
    await done;
  } finally {
    output.destroy();
    await done.catch(() => undefined);
  }

  return { crc, rawBytes, compressedBytes };
}

/**
 * Writes the entries as a ZIP archive, yielding the bytes in order. The entry generator is consumed lazily, one
 * entry at a time; the returned value lists what was written (name, CRC, sizes, offset).
 */
export async function* zipFromEntries(entries: AsyncIterable<ZipEntrySource>): AsyncGenerator<Buffer, ZipEntryInfo[]> {
  let offset = 0;
  const infos: ZipEntryInfo[] = [];

  const track = (buffer: Buffer): Buffer => {
    if (offset + buffer.length > MAX32) {
      throw new Error('A exportação passou de 4 GB e precisa ser dividida em partes.');
    }
    offset += buffer.length;
    return buffer;
  };

  for await (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const info: ZipEntryInfo = { name: entry.name, crc: 0, rawBytes: 0, compressedBytes: 0, offset };
    yield track(localHeader(name));
    yield track(name);

    const deflated = deflateEntry(entry.data);
    try {
      let step = await deflated.next();
      while (!step.done) {
        yield track(step.value as Buffer);
        step = await deflated.next();
      }
      const numbers = step.value;
      if (numbers.rawBytes > MAX32 || numbers.compressedBytes > MAX32) {
        throw new Error(`O arquivo ${entry.name} passou de 4 GB e precisa ser dividido em partes.`);
      }
      Object.assign(info, numbers);
      yield track(dataDescriptor(info));
      infos.push(info);
    } finally {
      // Early stop (client disconnect or the 4 GiB limit): close the deflate pipeline and the rows behind it.
      await deflated.return(undefined as any).catch(() => undefined);
    }
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const info of infos) {
    const name = Buffer.from(info.name, 'utf8');
    const header = track(centralHeader(info, name));
    centralSize += header.length + name.length;
    yield header;
    yield track(name);
  }
  if (centralOffset + centralSize > MAX32) {
    throw new Error('A exportação passou de 4 GB e precisa ser dividida em partes.');
  }
  yield track(endRecord(infos.length, centralOffset, centralSize));

  return infos;
}
