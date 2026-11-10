import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto } from '@api/dto/instance.dto';
import { LeadBackfillDto, LeadPatchDto, LeadSettingsDto } from '@api/dto/leads.dto';
import { leadsController } from '@api/server.module';
import { leadBackfillSchema, leadPatchSchema, leadSettingsSchema } from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

/**
 * "Leads (triagem)", instance-scoped like the other routes (global key or the token of the instance). The fixed
 * prefixes (settings, backfill) and export.csv are registered before "/:instanceName/:id".
 */
export class LeadsRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    const query = (req: any) => RouterBroker.queryWithoutInstance(req);

    this.router
      .get(this.routerPath('settings'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => leadsController.getSettings(instance),
        });
        res.set('Cache-Control', 'no-store');
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('settings'), ...guards, async (req, res) => {
        const response = await this.dataValidate<LeadSettingsDto>({
          request: req,
          schema: leadSettingsSchema,
          ClassRef: LeadSettingsDto,
          execute: (instance, data) => leadsController.saveSettings(instance, data),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('backfill'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => leadsController.backfillStatus(instance),
        });
        res.set('Cache-Control', 'no-store');
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('backfill'), ...guards, async (req, res) => {
        const response = await this.dataValidate<LeadBackfillDto>({
          request: req,
          schema: leadBackfillSchema,
          ClassRef: LeadBackfillDto,
          execute: (instance, data) => leadsController.backfill(instance, data),
        });
        res.status(response?.started ? HttpStatus.CREATED : HttpStatus.OK).json(response);
      })
      .get('/:instanceName/export.csv', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => leadsController.exportCsv(instance, query(req)),
        });
        const day = new Date().toISOString().slice(0, 10);
        const file = `leads-${String(response.name).replace(/[^\w.-]+/g, '-')}-${day}.csv`;
        res.set('Cache-Control', 'no-store');
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="${file}"`);
        res.status(HttpStatus.OK).send(response.csv);
      })
      .get('/:instanceName', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => leadsController.list(instance, query(req)),
        });
        res.set('Cache-Control', 'no-store');
        res.status(HttpStatus.OK).json(response);
      })
      .get('/:instanceName/:id', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => leadsController.get(instance, req.params.id),
        });
        res.set('Cache-Control', 'no-store');
        res.status(HttpStatus.OK).json(response);
      })
      .patch('/:instanceName/:id', ...guards, async (req, res) => {
        const response = await this.dataValidate<LeadPatchDto>({
          request: req,
          schema: leadPatchSchema,
          ClassRef: LeadPatchDto,
          execute: (instance, data) => leadsController.update(instance, req.params.id, data),
        });
        res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
