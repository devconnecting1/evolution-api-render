import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto } from '@api/dto/instance.dto';
import { OabWatchDto, ProcessBodyDto, ProcessSettingsDto, PublicationsSeenDto } from '@api/dto/processos.dto';
import { authGuard } from '@api/guards/auth.guard';
import { processosController } from '@api/server.module';
import {
  oabWatchSchema,
  processBulkSchema,
  processCreateSchema,
  processSettingsSchema,
  processUpdateSchema,
  publicationsSeenSchema,
} from '@validate/validate.schema';
import { Request, RequestHandler, Response, Router } from 'express';
import { JSONSchema7 } from 'json-schema';

import { HttpStatus } from './index.router';

/**
 * "Processos": instance-scoped like the other routes (global key or the token of the instance), except
 * POST /processos/tick (global key only, for cron-job.org), registered first so "tick" is never an instance name.
 */
export class ProcessosRouter extends RouterBroker {
  public readonly router: Router = Router();

  constructor(...guards: RequestHandler[]) {
    super();
    const base = '/:instanceName';
    const handle =
      (
        schema: JSONSchema7 | null,
        ClassRef: any,
        fn: (instance: InstanceDto, data: any, req: Request) => Promise<any>,
        status = HttpStatus.OK,
      ) =>
      async (req: Request, res: Response) => {
        const response = await this.dataValidate<any>({
          request: req,
          schema,
          ClassRef,
          execute: (instance, data) => fn(instance, data, req),
        });
        res.set('Cache-Control', 'no-store');
        res.status(status).json(response);
      };
    const q = (req: Request) => RouterBroker.queryWithoutInstance(req);

    this.router
      .post('/tick', authGuard['apikey'], async (req, res) => {
        const force = req.query?.force === '1' || req.query?.force === 'true';
        res.set('Cache-Control', 'no-store');
        res.status(HttpStatus.OK).json(await processosController.tick(force));
      })
      .get(
        `${base}/badge`,
        ...guards,
        handle(null, InstanceDto, (i) => processosController.badge(i)),
      )
      .get(`${base}/export.csv`, ...guards, async (req, res) => {
        const csv = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => processosController.exportCsv(instance),
        });
        res.set('Cache-Control', 'no-store');
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="processos-${req.params.instanceName as string}.csv"`);
        res.status(HttpStatus.OK).send(csv);
      })
      .get(
        `${base}/settings`,
        ...guards,
        handle(null, InstanceDto, (i) => processosController.getSettings(i)),
      )
      .post(
        `${base}/settings`,
        ...guards,
        handle(processSettingsSchema, ProcessSettingsDto, (i, d) => processosController.saveSettings(i, d)),
      )
      .get(
        `${base}/oab`,
        ...guards,
        handle(null, InstanceDto, (i) => processosController.listOab(i)),
      )
      .post(
        `${base}/oab`,
        ...guards,
        handle(oabWatchSchema, OabWatchDto, (i, d) => processosController.addOab(i, d), HttpStatus.CREATED),
      )
      .put(
        `${base}/oab/:oabId`,
        ...guards,
        handle(oabWatchSchema, OabWatchDto, (i, d, r) => processosController.updateOab(i, r.params.oabId as string, d)),
      )
      .delete(
        `${base}/oab/:oabId`,
        ...guards,
        handle(null, InstanceDto, (i, _d, r) => processosController.removeOab(i, r.params.oabId as string)),
      )
      .get(
        `${base}/publicacoes`,
        ...guards,
        handle(null, InstanceDto, (i, _d, r) => processosController.publications(i, q(r))),
      )
      .post(
        `${base}/publicacoes/seen`,
        ...guards,
        handle(publicationsSeenSchema, PublicationsSeenDto, (i, d) => processosController.publicationsSeen(i, d)),
      )
      .post(
        `${base}/bulk`,
        ...guards,
        handle(processBulkSchema, ProcessBodyDto, (i, d) => processosController.bulk(i, d), HttpStatus.CREATED),
      )
      .get(
        base,
        ...guards,
        handle(null, InstanceDto, (i, _d, r) => processosController.list(i, q(r))),
      )
      .post(
        base,
        ...guards,
        handle(processCreateSchema, ProcessBodyDto, (i, d) => processosController.add(i, d), HttpStatus.CREATED),
      )
      .get(
        `${base}/:id`,
        ...guards,
        handle(null, InstanceDto, (i, _d, r) => processosController.get(i, r.params.id as string)),
      )
      .put(
        `${base}/:id`,
        ...guards,
        handle(processUpdateSchema, ProcessBodyDto, (i, d, r) => processosController.update(i, r.params.id as string, d)),
      )
      .delete(
        `${base}/:id`,
        ...guards,
        handle(null, InstanceDto, (i, _d, r) => processosController.remove(i, r.params.id as string)),
      )
      .post(
        `${base}/:id/sync`,
        ...guards,
        handle(null, InstanceDto, (i, _d, r) => processosController.sync(i, r.params.id as string)),
      )
      .post(
        `${base}/:id/seen`,
        ...guards,
        handle(null, InstanceDto, (i, _d, r) => processosController.seen(i, r.params.id as string)),
      );
  }
}
