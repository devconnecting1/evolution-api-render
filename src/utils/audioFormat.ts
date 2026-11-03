export type AudioFormat = { mimetype: string; extension: string };

/**
 * Audio container from the first bytes of the file (#2719): the Cloud API derives the type of an upload from
 * its name, and every audio used to be uploaded as `.mp3`, so an OGG/Opus voice note went up as audio/mpeg.
 * Returns null when the format is not recognised.
 */
export function detectAudioFormat(head: Buffer | Uint8Array | null | undefined): AudioFormat | null {
  if (!head || head.length < 4) return null;
  const bytes = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
  const ascii = (start: number, end: number) => bytes.subarray(start, end).toString('latin1');

  if (ascii(0, 4) === 'OggS') return { mimetype: 'audio/ogg', extension: 'ogg' };
  if (ascii(0, 5) === '#!AMR') return { mimetype: 'audio/amr', extension: 'amr' };
  if (ascii(0, 3) === 'ID3') return { mimetype: 'audio/mpeg', extension: 'mp3' };
  if (bytes.length >= 8 && ascii(4, 8) === 'ftyp') return { mimetype: 'audio/mp4', extension: 'm4a' };
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return { mimetype: 'audio/aac', extension: 'aac' };
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return { mimetype: 'audio/mpeg', extension: 'mp3' };

  return null;
}

/** Same, from base64 text (decodes only the first bytes). */
export function detectAudioFormatFromBase64(base64: string | null | undefined): AudioFormat | null {
  if (!base64) return null;
  const clean = base64.replace(/^data:[^;]+;base64,/, '').slice(0, 64);
  try {
    return detectAudioFormat(Buffer.from(clean, 'base64'));
  } catch {
    return null;
  }
}
