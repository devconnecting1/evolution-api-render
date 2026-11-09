import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

/** Deriva uma chave AES-256 de 32 bytes a partir de um segredo (env). */
export function deriveKey(secret: string): Buffer {
  if (!secret) throw new Error('instance-db: missing encryption secret');
  return createHash('sha256').update(`whatsai:instance-db:v1:${secret}`).digest();
}

/** Criptografa (AES-256-GCM). Formato: enc:v1:<base64(iv|tag|ciphertext)>. */
export function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

export function open(sealed: string, key: Buffer): string {
  if (!sealed?.startsWith(PREFIX)) throw new Error('instance-db: value is not sealed');
  const raw = Buffer.from(sealed.slice(PREFIX.length), 'base64');
  if (raw.length < 29) throw new Error('instance-db: sealed value is truncated');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Remove a senha de uma URL de conexão para logs. */
export function redactUrl(url: string): string {
  return String(url ?? '').replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:***@');
}
