import { InstanceDto } from '@api/dto/instance.dto';
import { ProcessosError, ProcessosService } from '@api/services/processos.service';

const ERRORS: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  409: 'Conflict',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
};

/** "Processos" (court case monitoring): thin layer over ProcessosService, errors in PT-BR. */
export class ProcessosController {
  constructor(private readonly service: ProcessosService) {}

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ProcessosError) {
        throw { status: error.status, error: ERRORS[error.status] ?? 'Error', message: [error.message] };
      }
      throw error;
    }
  }

  private withInstance<T>(instance: InstanceDto, fn: (id: string, name: string) => Promise<T>) {
    return this.run(async () => {
      const row = await this.service.instanceByName(instance.instanceName);
      return fn(row.id, row.name);
    });
  }

  list = (instance: InstanceDto, query: Record<string, any>) =>
    this.withInstance(instance, async (id, name) => ({ instance: name, ...(await this.service.list(id, query)) }));
  badge = (instance: InstanceDto) => this.withInstance(instance, (id) => this.service.badge(id));
  get = (instance: InstanceDto, processId: string) =>
    this.withInstance(instance, (id) => this.service.get(id, processId));
  add = (instance: InstanceDto, body: any) => this.withInstance(instance, (id) => this.service.add(id, body));
  bulk = (instance: InstanceDto, body: any) =>
    this.withInstance(instance, (id) => this.service.bulkAdd(id, body.lista, body));
  update = (instance: InstanceDto, processId: string, body: any) =>
    this.withInstance(instance, (id) => this.service.update(id, processId, body));
  remove = (instance: InstanceDto, processId: string) =>
    this.withInstance(instance, (id) => this.service.remove(id, processId));
  seen = (instance: InstanceDto, processId: string) =>
    this.withInstance(instance, (id) => this.service.markSeen(id, processId));
  sync = (instance: InstanceDto, processId: string) =>
    this.withInstance(instance, (id) => this.service.manualSync(id, processId));
  exportCsv = (instance: InstanceDto) => this.withInstance(instance, (id) => this.service.exportCsv(id));

  listOab = (instance: InstanceDto) => this.withInstance(instance, (id) => this.service.listOab(id));
  addOab = (instance: InstanceDto, body: any) => this.withInstance(instance, (id) => this.service.addOab(id, body));
  updateOab = (instance: InstanceDto, oabId: string, body: any) =>
    this.withInstance(instance, (id) => this.service.updateOab(id, oabId, body));
  removeOab = (instance: InstanceDto, oabId: string) =>
    this.withInstance(instance, (id) => this.service.removeOab(id, oabId));

  publications = (instance: InstanceDto, query: Record<string, any>) =>
    this.withInstance(instance, (id) => this.service.listPublications(id, query));
  publicationsSeen = (instance: InstanceDto, body: any) =>
    this.withInstance(instance, (id) => this.service.markPublicationsSeen(id, body));

  getSettings = (instance: InstanceDto) =>
    this.withInstance(instance, async (id, name) => ({ instance: name, settings: await this.service.getSettings(id) }));
  saveSettings = (instance: InstanceDto, body: any) =>
    this.withInstance(instance, async (id, name) => ({
      instance: name,
      ...(await this.service.saveSettings(id, body)),
    }));

  tick = (force: boolean) => this.run(() => this.service.tick({ force }));
}
