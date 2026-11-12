import { InstanceDto } from '@api/dto/instance.dto';
import { UsageLimitsDto } from '@api/dto/usage.dto';
import {
  BillingInput,
  BillingNotFoundError,
  BillingService,
  BillingValidationError,
} from '@api/services/billing.service';
import { UsageService, UsageValidationError } from '@api/services/usage.service';
import { BadRequestException, NotFoundException } from '@exceptions';
import { OVERAGE_BLOCK, OVERAGE_BLOCK_PRICE_BRL, PLAN_PRESETS } from '@utils/usageLimits';

/** "Plano e limites" (GET/POST /usage/limits/:instanceName, GET /usage/summary/:instanceName). */
export class UsageController {
  constructor(
    private readonly usage: UsageService,
    private readonly prisma: any,
    private readonly billing: BillingService,
  ) {}

  private async instanceOf(instance: InstanceDto): Promise<{ id: string; name: string }> {
    const row = await this.prisma.instance.findUnique({
      where: { name: instance.instanceName },
      select: { id: true, name: true },
    });
    if (!row) throw new NotFoundException(`A instância "${instance.instanceName}" não existe.`);
    return row;
  }

  public async getLimits(instance: InstanceDto) {
    const row = await this.instanceOf(instance);
    const stored = await this.usage.getLimits(row.id);
    return {
      instance: row.name,
      configured: stored !== null,
      limits: stored ?? (await this.usage.getEffectiveLimits(row.id)),
      presets: PLAN_PRESETS,
      overage: { block: OVERAGE_BLOCK, priceBRL: OVERAGE_BLOCK_PRICE_BRL },
    };
  }

  public async saveLimits(instance: InstanceDto, data: UsageLimitsDto) {
    const row = await this.instanceOf(instance);
    try {
      const { previous, limits } = await this.usage.saveLimits(row.id, { ...data });
      return { instance: row.name, limits, previous };
    } catch (error) {
      if (error instanceof UsageValidationError) throw new BadRequestException(...error.errors);
      throw error;
    }
  }

  public async getSummary(instance: InstanceDto) {
    const row = await this.instanceOf(instance);
    return { instance: row.name, ...(await this.usage.getSummary(row.id)) };
  }

  /**
   * GET /usage/billing/:instanceName. Reads the manual billing entries of the instance (source "manual"). The plan
   * comes from the same "Plano e limites" row. The receipt is rendered in the panel from the entry and the provider
   * data; the API never exposes a public receipt URL.
   */
  public async getBilling(instance: InstanceDto) {
    const row = await this.instanceOf(instance);
    const stored = await this.usage.getLimits(row.id);
    const limits = stored ?? (await this.usage.getEffectiveLimits(row.id));
    const billing = await this.billing.list(row.id);

    return {
      instance: row.name,
      generatedAt: new Date().toISOString(),
      source: 'manual',
      note: billing.entries.length
        ? 'Cobranças registradas manualmente pelo administrador.'
        : 'Nenhuma cobrança registrada ainda. Use "Novo lançamento" para registrar a primeira mensalidade.',
      plan: {
        name: limits.planName,
        monthlyResponses: limits.monthlyResponses,
        configured: stored !== null,
      },
      /** First day of the oldest open period; null when everything is paid. */
      nextDueDate: billing.nextDueDate,
      openPeriod: billing.openPeriod,
      paymentMethod: billing.paymentMethod,
      totals: billing.totals,
      provider: billing.provider,
      history: billing.entries.map((entry: any) => ({
        id: entry.id,
        period: entry.period,
        amountBRL: entry.amountCents / 100,
        amountCents: entry.amountCents,
        status: entry.status,
        method: entry.method,
        paidAt: entry.paidAt,
        note: entry.note,
        receiptNumber: entry.receiptNumber,
        receiptUrl: null,
      })),
    };
  }

  public async createBilling(instance: InstanceDto, data: BillingInput) {
    const row = await this.instanceOf(instance);
    return this.runBilling(() => this.billing.create(row.id, data));
  }

  public async updateBilling(instance: InstanceDto, id: string, data: BillingInput) {
    const row = await this.instanceOf(instance);
    return this.runBilling(() => this.billing.update(row.id, id, data));
  }

  public async removeBilling(instance: InstanceDto, id: string) {
    const row = await this.instanceOf(instance);
    return this.runBilling(() => this.billing.remove(row.id, id));
  }

  private async runBilling<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof BillingValidationError) throw new BadRequestException(...error.errors);
      if (error instanceof BillingNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }
}
