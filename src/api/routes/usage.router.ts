import { once } from 'node:events';

import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto } from '@api/dto/instance.dto';
import { UsageLimitsDto } from '@api/dto/usage.dto';
import { exportController, usageController } from '@api/server.module';
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
      })
      // Cobrança: no billing source in the system yet, so the answer is honestly empty (see UsageController.getBilling)
      .get(this.routerPath('billing'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => usageController.getBilling(instance),
        });

        res.set('Cache-Control', 'no-store');
        res.status(HttpStatus.OK).json(response);
      })
      // Exportação completa: the ZIP is written while the rows are read (streaming, nothing buffered in memory)
      .get(this.routerPath('export'), ...guards, async (req, res) => {
        const instance = req.params as unknown as InstanceDto;
        const query = RouterBroker.queryWithoutInstance(req);
        const response = await exportController.exportData(instance, query.datasets);

        res.set('Cache-Control', 'no-store');
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename="${response.filename}"`);
        res.status(HttpStatus.OK);

        let closed = false;
        res.on('close', () => {
          closed = true;
        });
        try {
          for await (const chunk of response.stream) {
            if (closed) break;
            if (!res.write(chunk)) await Promise.race([once(res, 'drain'), once(res, 'close')]);
          }
          if (!res.writableEnded) res.end();
        } catch {
          // The headers (200 + ZIP) are already sent: a half ZIP must not look complete. Destroy the connection
          // instead of leaving the client with a truncated file that seems valid.
          res.destroy();
        }
      });
  }

  public readonly router: Router = Router();
}
