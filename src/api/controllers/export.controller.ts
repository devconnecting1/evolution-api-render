import { InstanceDto } from '@api/dto/instance.dto';
import {
  ExportDataset,
  ExportService,
  ExportValidationError,
  normalizeExportDatasets,
} from '@api/services/export.service';
import { BadRequestException, NotFoundException } from '@exceptions';

/**
 * "Exportar dados da instância" (GET /usage/export/:instanceName). The controller resolves the instance and returns
 * the ZIP as a stream; the router sets the download headers and writes it, so nothing is buffered in memory.
 */
export class ExportController {
  constructor(
    private readonly exporter: ExportService,
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

  public async exportData(instance: InstanceDto, datasets: unknown) {
    let selected: ExportDataset[];
    try {
      selected = normalizeExportDatasets(datasets);
    } catch (error) {
      if (error instanceof ExportValidationError) throw new BadRequestException(error.message);
      throw error;
    }

    const row = await this.instanceOf(instance);
    return {
      instance: row.name,
      filename: this.exporter.fileName(row.name),
      datasets: selected,
      stream: this.exporter.streamZip(row.id, row.name, selected),
    };
  }
}
