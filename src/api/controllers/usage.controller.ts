import { InstanceDto } from '@api/dto/instance.dto';
import { UsageLimitsDto } from '@api/dto/usage.dto';
import { UsageService, UsageValidationError } from '@api/services/usage.service';
import { BadRequestException, NotFoundException } from '@exceptions';
import { OVERAGE_BLOCK, OVERAGE_BLOCK_PRICE_BRL, PLAN_PRESETS } from '@utils/usageLimits';

/** "Plano e limites" (GET/POST /usage/limits/:instanceName, GET /usage/summary/:instanceName). */
export class UsageController {
  constructor(
    private readonly usage: UsageService,
    private readonly prisma: any,
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
}
