import { EventDto } from '@api/integrations/event/event.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { wa } from '@api/types/wa.types';

export type EmitData = {
  instanceName: string;
  origin: string;
  event: string;
  data: any;
  serverUrl: string;
  dateTime: string;
  sender: string;
  apiKey?: string;
  local?: boolean;
  integration?: string[];
  extra?: Record<string, any>;
};

export interface EventControllerInterface {
  set(instanceName: string, data: any): Promise<any>;
  get(instanceName: string): Promise<any>;
  emit({
    instanceName,
    origin,
    event,
    data,
    serverUrl,
    dateTime,
    sender,
    apiKey,
    local,
    extra,
  }: EmitData): Promise<void>;
}

export class EventController {
  public prismaRepository: PrismaRepository;
  protected waMonitor: WAMonitoringService;
  private integrationStatus: boolean;
  private integrationName: string;

  /**
   * Cache em memória da configuração de evento (webhook, websocket...) por instância.
   * Sem ele, CADA evento do WhatsApp (presença, entregue/lido, contato) fazia uma consulta ao banco,
   * o que mantinha o Neon acordado a noite toda. Invalida em toda escrita feita pela API (set) e na
   * remoção da instância; o TTL só cobre edições feitas direto no banco.
   */
  private static readonly configCache = new Map<string, { value: any; at: number }>();
  public static CONFIG_TTL_MS = 60 * 60_000;

  public static forgetInstance(instanceId?: string) {
    if (!instanceId) {
      EventController.configCache.clear();
      return;
    }
    for (const key of [...EventController.configCache.keys()]) {
      if (key.endsWith(`:${instanceId}`)) EventController.configCache.delete(key);
    }
  }

  constructor(
    prismaRepository: PrismaRepository,
    waMonitor: WAMonitoringService,
    integrationStatus: boolean,
    integrationName: string,
  ) {
    this.prisma = prismaRepository;
    this.monitor = waMonitor;
    this.status = integrationStatus;
    this.name = integrationName;

    // Envolve o set() (inclusive os sobrescritos nas subclasses) para atualizar o cache.
    const originalSet = this.set.bind(this);
    this.set = async (instanceName: string, data: any) => {
      const instanceId = this.monitor?.waInstances?.[instanceName]?.instanceId;
      try {
        return await originalSet(instanceName, data);
      } finally {
        if (instanceId) EventController.configCache.delete(`${this.name}:${instanceId}`);
      }
    };
  }

  public set prisma(prisma: PrismaRepository) {
    this.prismaRepository = prisma;
  }

  public get prisma() {
    return this.prismaRepository;
  }

  public set monitor(waMonitor: WAMonitoringService) {
    this.waMonitor = waMonitor;
  }

  public get monitor() {
    return this.waMonitor;
  }

  public set name(name: string) {
    this.integrationName = name;
  }

  public get name() {
    return this.integrationName;
  }

  public set status(status: boolean) {
    this.integrationStatus = status;
  }

  public get status() {
    return this.integrationStatus;
  }

  public async set(instanceName: string, data: EventDto): Promise<wa.LocalEvent> {
    if (!this.status) {
      return;
    }

    if (!data[this.name]?.enabled) {
      data[this.name].events = [];
    } else {
      if (0 === data[this.name].events.length) {
        data[this.name].events = EventController.events;
      }
    }

    return this.prisma[this.name].upsert({
      where: {
        instanceId: this.monitor.waInstances[instanceName].instanceId,
      },
      update: {
        enabled: data[this.name]?.enabled,
        events: data[this.name].events,
      },
      create: {
        enabled: data[this.name]?.enabled,
        events: data[this.name].events,
        instanceId: this.monitor.waInstances[instanceName].instanceId,
      },
    });
  }

  public async get(instanceName: string): Promise<wa.LocalEvent> {
    if (!this.status) {
      return;
    }

    if (undefined === this.monitor.waInstances[instanceName]) {
      return null;
    }

    const instanceId = this.monitor.waInstances[instanceName].instanceId;
    const cacheKey = `${this.name}:${instanceId}`;
    const cached = EventController.configCache.get(cacheKey);
    if (cached && Date.now() - cached.at < EventController.CONFIG_TTL_MS) {
      return cached.value;
    }

    const data = await this.prisma[this.name].findUnique({
      where: {
        instanceId,
      },
    });

    EventController.configCache.set(cacheKey, { value: data ?? null, at: Date.now() });

    if (!data) {
      return null;
    }

    return data;
  }

  public static readonly events = [
    'APPLICATION_STARTUP',
    'QRCODE_UPDATED',
    'MESSAGES_SET',
    'MESSAGES_UPSERT',
    'MESSAGES_EDITED',
    'MESSAGES_UPDATE',
    'MESSAGES_DELETE',
    'SEND_MESSAGE',
    'SEND_MESSAGE_UPDATE',
    'CONTACTS_SET',
    'CONTACTS_UPSERT',
    'CONTACTS_UPDATE',
    'PRESENCE_UPDATE',
    'CHATS_SET',
    'CHATS_UPSERT',
    'CHATS_UPDATE',
    'CHATS_DELETE',
    'GROUPS_UPSERT',
    'GROUP_UPDATE',
    'GROUP_PARTICIPANTS_UPDATE',
    'CONNECTION_UPDATE',
    'LABELS_EDIT',
    'LABELS_ASSOCIATION',
    'CALL',
    'TYPEBOT_START',
    'TYPEBOT_CHANGE_STATUS',
    'OPENAI_CHANGE_STATUS',
    'REMOVE_INSTANCE',
    'LOGOUT_INSTANCE',
    'INSTANCE_CREATE',
    'INSTANCE_DELETE',
    'STATUS_INSTANCE',
  ];
}
