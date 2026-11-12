import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto } from '@api/dto/instance.dto';
import { overviewController } from '@api/server.module';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

/** "Visão Geral com o resultado do escritório": GET /overview/:instanceName?days=7|30. */
export class OverviewRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router.get('/:instanceName', ...guards, async (req, res) => {
      const response = await this.dataValidate<InstanceDto>({
        request: req,
        schema: null,
        ClassRef: InstanceDto,
        execute: (instance) => overviewController.get(instance),
      });

      res.set('Cache-Control', 'no-store');
      res.status(HttpStatus.OK).json(response);
    });
  }

  public readonly router: Router = Router();
}
