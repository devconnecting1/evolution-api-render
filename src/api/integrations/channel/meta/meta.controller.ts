import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Logger } from '@config/logger.config';
import axios from 'axios';

import { ChannelController, ChannelControllerInterface } from '../channel.controller';

export class MetaController extends ChannelController implements ChannelControllerInterface {
  private readonly logger = new Logger('MetaController');

  constructor(prismaRepository: PrismaRepository, waMonitor: WAMonitoringService) {
    super(prismaRepository, waMonitor);
  }

  integrationEnabled: boolean;

  public async receiveWebhook(data: any) {
    if (data.object === 'whatsapp_business_account') {
      if (data.entry?.[0]?.changes?.[0]?.field === 'message_template_status_update') {
        const template = await this.prismaRepository.template.findFirst({
          where: { templateId: `${data.entry[0].changes[0].value.message_template_id}` },
        });

        if (!template) {
          console.log('template not found');
          return;
        }

        const { webhookUrl } = template;

        await axios.post(webhookUrl, data.entry[0].changes[0].value, {
          headers: {
            'Content-Type': 'application/json',
          },
        });
        return;
      }

      // Not awaited: Meta expects a quick 200 and retries the delivery otherwise
      this.processChanges(data).catch((error) => {
        this.logger.error(`WebhookService -> receiveWebhookMeta -> ${error?.message || error}`);
      });
    }

    return {
      status: 'success',
    };
  }

  /**
   * Hands every change of the payload to its instance, one at a time. The channel service reads
   * `entry[0].changes[0]`, so each change goes in a payload of its own.
   */
  private async processChanges(data: any) {
    const entries: any[] = Array.isArray(data?.entry) ? data.entry : [];

    for (const entry of entries) {
      const changes: any[] = Array.isArray(entry?.changes) ? entry.changes : [];

      for (const change of changes) {
        try {
          await this.processChange(data, entry, change);
        } catch (error) {
          this.logger.error(
            `WebhookService -> receiveWebhookMeta -> field ${change?.field ?? 'unknown'}: ${error?.message || error}`,
          );
        }
      }
    }
  }

  private async processChange(data: any, entry: any, change: any) {
    const field = change?.field;
    const numberId = change?.value?.metadata?.phone_number_id;

    if (!numberId) {
      // Some fields (e.g. account_update) carry no phone number metadata: there is no instance to route them to
      if (!field || field === 'messages') {
        this.logger.error('WebhookService -> receiveWebhookMeta -> numberId not found');
      } else {
        this.logger.verbose(`WebhookService -> receiveWebhookMeta -> field ${field} without phone_number_id ignored`);
      }
      return;
    }

    const instance = await this.prismaRepository.instance.findFirst({
      where: { number: numberId },
    });

    if (!instance) {
      this.logger.error('WebhookService -> receiveWebhookMeta -> instance not found');
      return;
    }

    const waInstance = this.waMonitor.waInstances[instance.name];

    if (!waInstance) {
      this.logger.error(`WebhookService -> receiveWebhookMeta -> instance ${instance.name} not loaded`);
      return;
    }

    await waInstance.connectToWhatsapp({ ...data, entry: [{ ...entry, changes: [change] }] });
  }
}
