/**
 * Avisos ao administrador pelo WhatsApp: o que hoje só aparece na Observabilidade e faz um cliente ficar sem
 * atendimento sem ninguém perceber.
 *
 * - Chave OpenAI de uma instância com problema sério (inválida, sem crédito, modelo indisponível, sem permissão):
 *   no primeiro erro real, a partir do registro de saúde em memória (src/utils/openai-health.ts).
 * - Instância desconectada há mais de DISCONNECTED_MS: verificação a cada minuto do estado em memória das
 *   instâncias carregadas; avisa de novo quando ela volta.
 *
 * Nada aqui consulta o banco por conta própria (o Neon pode dormir): só o nome da instância de uma credencial é lido
 * quando já está acontecendo uma resposta da IA. Desligado sem ADMIN_ALERT_NUMBERS e ADMIN_ALERT_INSTANCE.
 */
import { OpenaiErrorInfo, VERDICT_HINT, VERDICT_TEXT } from '@utils/openai-health';

export type AdminAlertsConfig = {
  /** Números que recebem os avisos (só dígitos, com DDI). */
  numbers: string[];
  /** Instância que envia os avisos (ex.: o número do próprio administrador). */
  sender: string | null;
};

type Deps = {
  prisma: any;
  /** waMonitor: instâncias carregadas por nome. */
  monitor: { waInstances: Record<string, any> };
  logger: { log: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  config: AdminAlertsConfig;
  now?: () => number;
};

const SERIOUS = new Set(['invalid_key', 'no_credit', 'model_unavailable', 'permission']);
/** O mesmo aviso não se repete antes disso. */
const REPEAT_MS = 6 * 3_600_000;
/** Desconexão só vira aviso depois deste tempo (reconexões curtas são normais). */
export const DISCONNECTED_MS = 10 * 60_000;

export function adminAlertsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AdminAlertsConfig {
  const numbers = String(env.ADMIN_ALERT_NUMBERS ?? '')
    .split(/[,;\s]+/)
    .map((n) => n.replace(/\D/g, ''))
    .filter((n) => n.length >= 10 && n.length <= 15);
  const sender = String(env.ADMIN_ALERT_INSTANCE ?? '').trim() || null;
  return { numbers: [...new Set(numbers)], sender };
}

export class AdminAlertsService {
  private readonly sentAt = new Map<string, number>();
  private readonly downSince = new Map<string, number>();
  private readonly alertedDown = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: Deps) {}

  get enabled(): boolean {
    return !!this.deps.config.sender && this.deps.config.numbers.length > 0;
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  /** Envia para todos os números, uma vez por chave de aviso a cada REPEAT_MS. Nunca lança. */
  async notify(key: string, text: string, force = false): Promise<boolean> {
    if (!this.enabled) return false;
    const last = this.sentAt.get(key) ?? 0;
    if (!force && this.now() - last < REPEAT_MS) return false;
    const sender = this.deps.monitor.waInstances[this.deps.config.sender as string];
    if (typeof sender?.textMessage !== 'function' || sender?.connectionStatus?.state !== 'open') {
      this.deps.logger.warn(`Aviso ao administrador não enviado: a instância de envio não está conectada (${key})`);
      return false;
    }
    this.sentAt.set(key, this.now());
    let sent = 0;
    for (const number of this.deps.config.numbers) {
      try {
        // `true` no fim: envio do bot, o eco não pausa a IA daquela conversa
        await sender.textMessage({ number, text, delay: 0, linkPreview: false }, false, true);
        sent++;
      } catch (error) {
        this.deps.logger.error(`Aviso ao administrador falhou: ${error?.message ?? error}`);
      }
    }
    return sent > 0;
  }

  /** Chamado pelo registro de saúde da OpenAI a cada erro real de uma resposta da IA. */
  async openaiProblem(credsId: string, info: OpenaiErrorInfo): Promise<void> {
    if (!this.enabled || !info || !SERIOUS.has(info.kind)) return;
    try {
      const creds = await this.deps.prisma.openaiCreds.findUnique({
        where: { id: credsId },
        select: { Instance: { select: { name: true } } },
      });
      const instance = creds?.Instance?.name ?? 'instância desconhecida';
      const hint = VERDICT_HINT[info.kind];
      await this.notify(
        `openai:${credsId}:${info.kind}`,
        `Aviso WhatsAI: a IA de "${instance}" não está respondendo. Chave OpenAI: ${VERDICT_TEXT[info.kind]}.` +
          (hint ? ` ${hint}` : ''),
      );
    } catch (error) {
      this.deps.logger.error(`Aviso de chave OpenAI não enviado: ${error?.message ?? error}`);
    }
  }

  /** Uma passada pelo estado em memória das instâncias (exposta para os testes). */
  async checkConnections(): Promise<void> {
    if (!this.enabled) return;
    const now = this.now();
    for (const [name, instance] of Object.entries(this.deps.monitor.waInstances ?? {})) {
      if (!instance || name === this.deps.config.sender) continue;
      const state = instance?.connectionStatus?.state;
      if (state === 'open') {
        this.downSince.delete(name);
        if (this.alertedDown.delete(name)) {
          await this.notify(`up:${name}:${now}`, `Aviso WhatsAI: "${name}" voltou a conectar.`, true);
        }
        continue;
      }
      if (!this.downSince.has(name)) this.downSince.set(name, now);
      const since = this.downSince.get(name) as number;
      if (now - since >= DISCONNECTED_MS && !this.alertedDown.has(name)) {
        const minutes = Math.round((now - since) / 60_000);
        const ok = await this.notify(
          `down:${name}`,
          `Aviso WhatsAI: "${name}" está desconectada há ${minutes} min (estado: ${state ?? 'desconhecido'}). ` +
            'A IA não responde enquanto isso. Confira no painel, em Instâncias, e leia o QR code se for preciso.',
        );
        if (ok) this.alertedDown.add(name);
      }
    }
    for (const name of [...this.downSince.keys()]) {
      if (!this.deps.monitor.waInstances?.[name]) this.downSince.delete(name);
    }
  }

  start(intervalMs = 60_000): void {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => {
      this.checkConnections().catch(() => undefined);
    }, intervalMs);
    this.timer.unref?.();
    this.deps.logger.log(
      `Avisos ao administrador ligados: ${this.deps.config.numbers.length} número(s), enviados por "${this.deps.config.sender}"`,
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
