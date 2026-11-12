import { InstanceDto } from '@api/dto/instance.dto';
import { OverviewService } from '@api/services/overview.service';
import { BadRequestException, NotFoundException } from '@exceptions';
import { OverviewPeriod, parseOverviewDays } from '@utils/overview';

/** "Visão Geral com o resultado do escritório" (GET /overview/:instanceName?days=7|30). */
export class OverviewController {
  constructor(
    private readonly overview: OverviewService,
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

  public async get(instance: InstanceDto) {
    const days: OverviewPeriod | null = parseOverviewDays((instance as InstanceDto & { days?: unknown }).days);
    if (days === null) throw new BadRequestException('"days" deve ser 7 ou 30.');

    const row = await this.instanceOf(instance);
    return { instance: row.name, ...(await this.overview.get(row.id, days)) };
  }
}
