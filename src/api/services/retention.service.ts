/**
 * Retenção das mensagens (LGPD): apaga do banco do WhatsAI as mensagens mais antigas que o prazo, em todas as
 * instâncias. Nunca apaga nada no WhatsApp (nenhuma chamada ao Baileys/Meta): o celular do escritório e o do contato
 * guardam tudo. As atualizações de status e a mídia de cada mensagem saem junto (FK com cascade). Conversas,
 * contatos, leads, agendamentos, processos e contadores ficam.
 *
 * Prazo: o que o administrador salvou no painel (GlobalSetting "retention", banco principal); sem isso, a variável
 * MESSAGE_RETENTION_DAYS do Render; sem as duas, desligada. 0 = desligada; senão de MIN_DAYS a MAX_DAYS.
 *
 * Sem timer: roda na primeira resposta da IA de cada dia de cada instância (o mesmo gatilho da limpeza dos
 * contadores de uso), quando o banco já está acordado. Em lotes de 1.000, no máximo MAX_BATCHES por dia, para não
 * segurar o banco; o que sobrar sai nos dias seguintes. "Apagar agora" (painel) roda tudo na hora.
 */
type Deps = {
  prisma: any;
  /** Prazo da variável de ambiente (padrão quando o painel não salvou nada). */
  days: number;
  logger: { log: (m: string) => void; warn: (m: string) => void };
  now?: () => number;
};

const BATCH = 1000;
const MAX_BATCHES = 20;
const RUN_NOW_MAX_BATCHES = 200;
const DAY_S = 86_400;
const SETTING_KEY = 'retention';
export const RETENTION_MIN_DAYS = 7;
export const RETENTION_MAX_DAYS = 3650;

export class RetentionValidationError extends Error {}

export function validRetentionDays(value: unknown): number | null {
  const days = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(days)) return null;
  if (days === 0) return 0;
  return days >= RETENTION_MIN_DAYS && days <= RETENTION_MAX_DAYS ? days : null;
}

export function retentionDaysFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const days = Number.parseInt(String(env.MESSAGE_RETENTION_DAYS ?? '0'), 10);
  if (!Number.isFinite(days) || days < RETENTION_MIN_DAYS) return 0;
  return Math.min(days, RETENTION_MAX_DAYS);
}

export class RetentionService {
  private readonly ranOn = new Map<string, string>();
  /** undefined = ainda não leu o banco; null = o painel não salvou nada (vale a variável). */
  private saved: { days: number; updatedAt: string | null } | null | undefined = undefined;
  private loading: Promise<void> | null = null;

  constructor(private readonly deps: Deps) {}

  /** Prazo em vigor (o do painel, ou o da variável). */
  get days(): number {
    return this.saved ? this.saved.days : this.deps.days;
  }

  get enabled(): boolean {
    return this.days > 0;
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  /** Lê o prazo salvo no painel uma vez por processo (o painel atualiza a memória ao salvar). */
  async ensureLoaded(): Promise<void> {
    if (this.saved !== undefined) return;
    if (!this.loading) {
      this.loading = (async () => {
        try {
          const row = await this.deps.prisma.globalSetting.findUnique({ where: { key: SETTING_KEY } });
          const days = validRetentionDays(row?.value?.days);
          this.saved =
            row && days !== null
              ? { days, updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null }
              : null;
        } catch (error) {
          this.deps.logger.warn(`Retenção: não foi possível ler o prazo salvo: ${error?.message ?? error}`);
          this.saved = null;
        } finally {
          this.loading = null;
        }
      })();
    }
    await this.loading;
  }

  async config() {
    await this.ensureLoaded();
    return {
      days: this.days,
      enabled: this.enabled,
      source: this.saved ? 'painel' : this.deps.days > 0 ? 'variavel' : 'padrao',
      envDays: this.deps.days,
      updatedAt: this.saved?.updatedAt ?? null,
      min: RETENTION_MIN_DAYS,
      max: RETENTION_MAX_DAYS,
    };
  }

  /** Salva o prazo de todas as instâncias. Vale na próxima rodada de cada instância (ainda hoje). */
  async setDays(value: unknown) {
    const days = validRetentionDays(value);
    if (days === null) {
      throw new RetentionValidationError(
        `"days" deve ser 0 (desligada) ou um número inteiro de ${RETENTION_MIN_DAYS} a ${RETENTION_MAX_DAYS}.`,
      );
    }
    const row = await this.deps.prisma.globalSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: { days } },
      update: { value: { days } },
    });
    this.saved = { days, updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null };
    this.ranOn.clear();
    return this.config();
  }

  private cutoff(days: number) {
    return Math.floor(this.now() / 1000) - days * DAY_S;
  }

  /** Quantas mensagens de cada instância têm mais que `days` dias (o que sairia com esse prazo). */
  async preview(value?: unknown) {
    await this.ensureLoaded();
    const days = value === undefined ? this.days : validRetentionDays(value);
    if (days === null) {
      throw new RetentionValidationError(
        `"days" deve ser 0 ou um número inteiro de ${RETENTION_MIN_DAYS} a ${RETENTION_MAX_DAYS}.`,
      );
    }
    const instances: { id: string; name: string }[] = await this.deps.prisma.instance.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const rows = await Promise.all(
      instances.map(async (instance) => {
        const older = days
          ? await this.deps.prisma.message
              .count({ where: { instanceId: instance.id, messageTimestamp: { lt: this.cutoff(days) } } })
              .catch((): null => null)
          : 0;
        return { instanceId: instance.id, instance: instance.name, older };
      }),
    );
    return { days, total: rows.reduce((sum, r) => sum + (r.older ?? 0), 0), instances: rows };
  }

  /** Uma vez por dia por instância; não espera terminar (nunca atrasa a resposta). */
  runOncePerDay(instanceId: string): void {
    if (!instanceId) return;
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (this.ranOn.get(instanceId) === today) return;
    this.ranOn.set(instanceId, today);
    void (async () => {
      await this.ensureLoaded();
      if (!this.enabled) return;
      await this.purge(instanceId);
    })().catch((error) =>
      this.deps.logger.warn(`Retenção: falha ao apagar mensagens antigas de ${instanceId}: ${error?.message ?? error}`),
    );
  }

  /** Apaga as mensagens anteriores ao corte; devolve quantas saíram. */
  async purge(instanceId: string, maxBatches = MAX_BATCHES): Promise<number> {
    await this.ensureLoaded();
    if (!this.enabled) return 0;
    const cutoff = this.cutoff(this.days);
    let removed = 0;
    for (let i = 0; i < maxBatches; i++) {
      const rows: { id: string }[] = await this.deps.prisma.message.findMany({
        where: { instanceId, messageTimestamp: { lt: cutoff } },
        select: { id: true },
        take: BATCH,
      });
      if (!rows.length) break;
      const result = await this.deps.prisma.message.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      removed += result?.count ?? rows.length;
      if (rows.length < BATCH) break;
    }
    if (removed) {
      this.deps.logger.log(
        `Retenção: ${removed} mensagem(ns) com mais de ${this.days} dias apagada(s) (${instanceId})`,
      );
    }
    return removed;
  }

  /** "Apagar agora" do painel: todas as instâncias, até 200.000 mensagens por instância. */
  async purgeAll() {
    await this.ensureLoaded();
    if (!this.enabled) return { days: 0, removed: 0, instances: [] as { instance: string; removed: number }[] };
    const instances: { id: string; name: string }[] = await this.deps.prisma.instance.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const result: { instance: string; removed: number }[] = [];
    for (const instance of instances) {
      result.push({ instance: instance.name, removed: await this.purge(instance.id, RUN_NOW_MAX_BATCHES) });
    }
    return { days: this.days, removed: result.reduce((s, r) => s + r.removed, 0), instances: result };
  }
}
