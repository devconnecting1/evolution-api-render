/**
 * Memória curta do que este processo já gravou, para não repetir no banco uma escrita idêntica.
 *
 * O WhatsApp reenvia contatos (contacts.upsert / contacts.update) ao longo do dia e da noite com os mesmos dados.
 * Cada reenvio virava um INSERT ... ON CONFLICT DO NOTHING ou um UPSERT igual ao anterior, e cada um acordava o
 * Neon. Com esta memória, só o que mudou (ou o que este processo ainda não gravou) vai ao banco: o estado final
 * da tabela é o mesmo.
 */
export class RecentWrites {
  private readonly values = new Map<string, string>();

  constructor(private readonly max = 5_000) {}

  /** Esta chave já foi gravada por este processo com exatamente este valor? */
  unchanged(key: string, value: string): boolean {
    return this.values.get(key) === value;
  }

  /** Registra uma escrita que deu certo (a mais antiga sai quando passa do limite). */
  remember(key: string, value: string): void {
    this.values.delete(key);
    this.values.set(key, value);
    if (this.values.size > this.max) this.values.delete(this.values.keys().next().value as string);
  }

  forget(key: string): void {
    this.values.delete(key);
  }

  get size(): number {
    return this.values.size;
  }
}
