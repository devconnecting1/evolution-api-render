import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto } from '@api/dto/instance.dto';
import { UsageLimitsDto } from '@api/dto/usage.dto';
import { usageController } from '@api/server.module';
import { usageLimitsSchema } from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

/** "Plano e limites": instance-scoped like the other routes (global key or the token of the instance). */
export class UsageRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .get(this.routerPath('limits'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => usageController.getLimits(instance),
        });

        res.set('Cache-Control', 'no-store');
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('limits'), ...guards, async (req, res) => {
        const response = await this.dataValidate<UsageLimitsDto>({
          request: req,
          schema: usageLimitsSchema,
          ClassRef: UsageLimitsDto,
          execute: (instance, data) => usageController.saveLimits(instance, data),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('summary'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => usageController.getSummary(instance),
        });

        res.set('Cache-Control', 'no-store');
        res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
