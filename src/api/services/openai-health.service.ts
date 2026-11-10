import {
  currentVerdict,
  KeyHealth,
  KeyTestResult,
  maskKey,
  OpenaiHealthRegistry,
  openaiHealthRegistry,
  OpenaiVerdict,
  testOpenaiKey,
  VERDICT_HINT,
  VERDICT_TEXT,
} from '@utils/openai-health';

import { Alert, buildMetric, ProviderView, Resource } from './observability.shared';

/**
 * Saúde das chaves OpenAI por instância: junta as credenciais salvas, os modelos dos bots e o estado em memória
 * (respostas reais + testes). Lê o banco só quando alguém pede (painel, MCP, Observabilidade); nada é gravado.
 */

export interface CredentialHealth {
  credsId: string;
  name: string | null;
  instanceId: string;
  instanceName: string;
  keyMasked: string;
  model: string | null;
  bots: number;
  verdict: OpenaiVerdict;
  text: string;
  hint: string | null;
  since: string | null;
  lastOkAt: string | null;
  lastError: { kind: string; message: string; status: number | null; at: string } | null;
  lastTest: KeyTestResult | null;
}

export interface OpenaiHealthDeps {
  prisma: any;
  registry?: OpenaiHealthRegistry;
  tester?: typeof testOpenaiKey;
  now?: () => number;
}

/** Um teste ativo por chave a cada 30 s no máximo (o botão não vira martelo). */
const TEST_MIN_INTERVAL_MS = 30_000;
/** A Observabilidade testa sozinha a chave que ficou 6 h sem uso nem teste. */
const STALE_MS = 6 * 3_600_000;
const SERIOUS: OpenaiVerdict[] = ['invalid_key', 'no_credit', 'model_unavailable', 'permission'];

const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);

export class OpenaiHealthService {
  private readonly registry: OpenaiHealthRegistry;
  private readonly tester: typeof testOpenaiKey;
  private readonly now: () => number;
  private readonly lastTestAt = new Map<string, number>();

  constructor(private readonly deps: OpenaiHealthDeps) {
    this.registry = deps.registry ?? openaiHealthRegistry;
    this.tester = deps.tester ?? testOpenaiKey;
    this.now = deps.now ?? Date.now;
  }

  /** Credenciais (com a chave) de uma ou de todas as instâncias; uma consulta por instância (banco próprio). */
  private async loadCreds(instanceIds?: string[]) {
    const instances: { id: string; name: string }[] = await this.deps.prisma.instance.findMany({
      where: instanceIds ? { id: { in: instanceIds } } : {},
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const rows = await Promise.all(
      instances.map(async (instance) => {
        const creds: any[] = await this.deps.prisma.openaiCreds.findMany({
          where: { instanceId: instance.id },
          select: { id: true, name: true, apiKey: true, instanceId: true },
        });
        if (!creds.length) return [];
        const bots: any[] = await this.deps.prisma.openaiBot.findMany({
          where: { instanceId: instance.id },
          select: { openaiCredsId: true, model: true, enabled: true },
        });
        return creds.map((c) => {
          const mine = bots.filter((b) => b.openaiCredsId === c.id);
          const model = (mine.find((b) => b.enabled && b.model) ?? mine.find((b) => b.model))?.model ?? null;
          return { ...c, instanceName: instance.name, model, bots: mine.length };
        });
      }),
    );
    return rows.flat();
  }

  private view(row: any): CredentialHealth {
    const health: KeyHealth | null = this.registry.get(row.id);
    const { verdict, at } = currentVerdict(health);
    return {
      credsId: row.id,
      name: row.name ?? null,
      instanceId: row.instanceId,
      instanceName: row.instanceName,
      keyMasked: maskKey(row.apiKey),
      model: row.model,
      bots: row.bots,
      verdict,
      text: VERDICT_TEXT[verdict],
      hint: VERDICT_HINT[verdict] ?? null,
      since: iso(at),
      lastOkAt: iso(health?.lastOkAt),
      lastError: health?.lastError
        ? {
            kind: health.lastError.kind,
            message: health.lastError.message,
            status: health.lastError.status,
            at: new Date(health.lastError.at).toISOString(),
          }
        : null,
      lastTest: health?.lastTest ?? null,
    };
  }

  async overview(instanceIds?: string[]): Promise<CredentialHealth[]> {
    return (await this.loadCreds(instanceIds)).map((row) => this.view(row));
  }

  /** Testa agora as chaves da instância (ou só `credsId`). Respeita o intervalo mínimo por chave. */
  async test(instanceId: string, credsId?: string): Promise<CredentialHealth[]> {
    const rows = (await this.loadCreds([instanceId])).filter((r) => !credsId || r.id === credsId);
    await Promise.all(rows.map((row) => this.runTest(row)));
    return rows.map((row) => this.view(row));
  }

  private async runTest(row: any): Promise<void> {
    const last = this.lastTestAt.get(row.id) ?? 0;
    if (this.now() - last < TEST_MIN_INTERVAL_MS && this.registry.get(row.id)?.lastTest) return;
    this.lastTestAt.set(row.id, this.now());
    const result = await this.tester(row.apiKey ?? '', row.model, { timeoutMs: 8_000 });
    this.registry.recordTest(row.id, result);
  }

  /** Cartão "OpenAI" da Observabilidade, com alerta para chave sem crédito ou inválida. */
  async providerView(description: string): Promise<ProviderView & { extraAlerts: Alert[] }> {
    const rows = await this.loadCreds();
    // chaves sem nenhum sinal recente (uso real ou teste) são testadas agora, no máximo 6 em paralelo
    const stale = rows.filter((row) => {
      const h = this.registry.get(row.id);
      const latest = Math.max(
        h?.lastOkAt ?? 0,
        h?.lastError?.at ?? 0,
        h?.lastTest ? Date.parse(h.lastTest.checkedAt) : 0,
      );
      return this.now() - latest > STALE_MS;
    });
    for (let i = 0; i < stale.length; i += 6) {
      await Promise.all(stale.slice(i, i + 6).map((row) => this.runTest(row).catch(() => undefined)));
    }

    const views = rows.map((row) => this.view(row));
    const ok = views.filter((v) => v.verdict === 'ok').length;
    const problems = views.filter((v) => v.verdict !== 'ok' && v.verdict !== 'not_tested');
    const resources: Resource[] = views.map((v) => ({
      id: v.credsId,
      name: `${v.instanceName}${v.name ? ` · ${v.name}` : ''}`,
      type: 'Chave OpenAI',
      status: v.text,
      detail: [
        v.keyMasked,
        v.model ? `modelo ${v.model}` : null,
        v.since ? `desde ${v.since.slice(0, 16).replace('T', ' ')} UTC` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    }));
    const extraAlerts: Alert[] = problems.map((v) => ({
      provider: 'openai',
      metric: `key:${v.credsId}`,
      label: v.instanceName,
      percent: 100,
      status: SERIOUS.includes(v.verdict) ? 'critical' : 'warning',
      message: `OpenAI · ${v.instanceName}: ${v.text}.${v.hint ? ` ${v.hint}` : ''}`,
    }));
    return {
      id: 'openai',
      name: 'OpenAI',
      description,
      configured: views.length > 0,
      plan: null,
      status: !views.length ? 'missing' : problems.length ? 'partial' : 'ok',
      updatedAt: new Date(this.now()).toISOString(),
      metrics: views.length
        ? [buildMetric('keys_ok', 'Chaves funcionando', ok, views.length, 'count', { higherIsBetter: true })]
        : [],
      resources,
      notes: [
        ...problems.map((v) => `${v.instanceName}: ${v.text}.${v.hint ? ` ${v.hint}` : ''}`),
        'O saldo em dólares não aparece para chaves comuns; o teste diz se há crédito ("sem crédito" quando acaba).',
      ],
      links: [
        { label: 'Crédito (Billing)', url: 'https://platform.openai.com/settings/organization/billing/overview' },
        { label: 'Uso', url: 'https://platform.openai.com/usage' },
        { label: 'Chaves', url: 'https://platform.openai.com/api-keys' },
      ],
      extraAlerts,
    };
  }
}
