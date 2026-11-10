/**
 * Retenção das mensagens (LGPD): apaga as mensagens com mais de MESSAGE_RETENTION_DAYS dias. As atualizações de
 * status e a mídia de cada mensagem saem junto (FK com cascade). Conversas, contatos, leads, agendamentos,
 * processos e contadores ficam.
 *
 * Sem timer: roda na primeira resposta da IA de cada dia de cada instância (o mesmo gatilho da limpeza dos
 * contadores de uso), quando o banco já está acordado. Em lotes de 1.000, no máximo MAX_BATCHES por dia, para não
 * segurar o banco; o que sobrar sai nos dias seguintes. Desligada com 0 (padrão).
 */
type Deps = {
  prisma: any;
  days: number;
  logger: { log: (m: string) => void; warn: (m: string) => void };
  now?: () => number;
};

const BATCH = 1000;
const MAX_BATCHES = 20;
const DAY_S = 86_400;

export function retentionDaysFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const days = Number.parseInt(String(env.MESSAGE_RETENTION_DAYS ?? '0'), 10);
  return Number.isFinite(days) && days >= 30 ? Math.min(days, 3650) : 0;
}

export class RetentionService {
  private readonly ranOn = new Map<string, string>();

  constructor(private readonly deps: Deps) {}

  get enabled(): boolean {
    return this.deps.days > 0;
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  /** Uma vez por dia por instância; não espera terminar (nunca atrasa a resposta). */
  runOncePerDay(instanceId: string): void {
    if (!this.enabled || !instanceId) return;
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (this.ranOn.get(instanceId) === today) return;
    this.ranOn.set(instanceId, today);
    void this.purge(instanceId).catch((error) =>
      this.deps.logger.warn(`Retenção: falha ao apagar mensagens antigas de ${instanceId}: ${error?.message ?? error}`),
    );
  }

  /** Apaga as mensagens anteriores ao corte; devolve quantas saíram. */
  async purge(instanceId: string): Promise<number> {
    if (!this.enabled) return 0;
    const cutoff = Math.floor(this.now() / 1000) - this.deps.days * DAY_S;
    let removed = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
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
        `Retenção: ${removed} mensagem(ns) com mais de ${this.deps.days} dias apagada(s) (${instanceId})`,
      );
    }
    return removed;
  }
}
