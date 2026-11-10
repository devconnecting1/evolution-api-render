import { InstanceDto } from '@api/dto/instance.dto';
import { LeadBackfillDto, LeadPatchDto, LeadSettingsDto } from '@api/dto/leads.dto';
import { LeadsConflictError, LeadsService, LeadsValidationError } from '@api/services/leads.service';
import { BadRequestException, NotFoundException } from '@exceptions';
import { DEFAULT_AREAS, LEAD_PRIORITIES, LEAD_STATUSES, NOTIFY_ON } from '@utils/leads';

/** "Leads (triagem)": REST routes under /leads (instance-scoped like the other routes). */
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly prisma: any,
    private readonly waMonitor: { waInstances: Record<string, any> } | null = null,
  ) {}

  private async instanceOf(instance: InstanceDto): Promise<{ id: string; name: string }> {
    const row = await this.prisma.instance.findUnique({
      where: { name: instance.instanceName },
      select: { id: true, name: true },
    });
    if (!row) throw new NotFoundException(`A instância "${instance.instanceName}" não existe.`);
    return row;
  }

  private async guard<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (error) {
      if (error instanceof LeadsValidationError) throw new BadRequestException(...error.errors);
      if (error instanceof LeadsConflictError) {
        throw { status: 409, error: 'Conflict', message: [error.message] };
      }
      throw error;
    }
  }

  public async list(instance: InstanceDto, query: Record<string, any>) {
    const row = await this.instanceOf(instance);
    return this.guard(async () => ({
      instance: row.name,
      ...(await this.leads.list(row.id, query, this.waMonitor?.waInstances?.[row.name])),
    }));
  }

  public async get(instance: InstanceDto, id: string) {
    const row = await this.instanceOf(instance);
    const lead = await this.leads.get(row.id, id);
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    return { instance: row.name, lead };
  }

  public async update(instance: InstanceDto, id: string, data: LeadPatchDto) {
    const row = await this.instanceOf(instance);
    const result = await this.guard(() => this.leads.update(row.id, id, { ...data }));
    if (!result) throw new NotFoundException('Lead não encontrado.');
    return { instance: row.name, ...result };
  }

  public async exportCsv(instance: InstanceDto, query: Record<string, any>) {
    const row = await this.instanceOf(instance);
    const csv = await this.guard(() => this.leads.exportCsv(row.id, query));
    return { name: row.name, csv };
  }

  public async exportPreview(instance: InstanceDto, query: Record<string, any>) {
    const row = await this.instanceOf(instance);
    const sheets = await this.guard(() => this.leads.exportPreview(row.id, row.name, query));
    return { instance: row.name, sheets };
  }

  public async refreshWaiting(instance: InstanceDto) {
    const row = await this.instanceOf(instance);
    const result = await this.guard(() => this.leads.refreshWaiting(row.id));
    return { instance: row.name, ...result };
  }

  public async exportXlsx(instance: InstanceDto, query: Record<string, any>) {
    const row = await this.instanceOf(instance);
    const file = await this.guard(() => this.leads.exportXlsx(row.id, row.name, query));
    return { name: row.name, file };
  }

  public async getSettings(instance: InstanceDto) {
    const row = await this.instanceOf(instance);
    const { configured, settings } = await this.leads.getStoredSettings(row.id);
    return {
      instance: row.name,
      configured,
      settings,
      options: {
        statuses: LEAD_STATUSES,
        priorities: LEAD_PRIORITIES,
        notifyOn: NOTIFY_ON,
        defaultAreas: DEFAULT_AREAS,
      },
    };
  }

  public async saveSettings(instance: InstanceDto, data: LeadSettingsDto) {
    const row = await this.instanceOf(instance);
    const result = await this.guard(() => this.leads.saveSettings(row.id, { ...data }));
    return { instance: row.name, ...result };
  }

  public async backfill(instance: InstanceDto, data: LeadBackfillDto) {
    const row = await this.instanceOf(instance);
    return { instance: row.name, ...(await this.guard(() => this.leads.backfill(row.id, row.name, { ...data }))) };
  }

  public async analyzeOne(instance: InstanceDto, contact: string) {
    const row = await this.instanceOf(instance);
    return { instance: row.name, ...(await this.guard(() => this.leads.analyzeOne(row.id, row.name, contact))) };
  }

  public async remove(instance: InstanceDto, id: string) {
    const row = await this.instanceOf(instance);
    const lead = await this.guard(() => this.leads.remove(row.id, id));
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    return { instance: row.name, removed: true, lead };
  }

  public async backfillStatus(instance: InstanceDto) {
    const row = await this.instanceOf(instance);
    return { instance: row.name, ...this.leads.backfillStatus(row.id) };
  }
}
