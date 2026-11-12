import { authGuard } from '@api/guards/auth.guard';
import { safeEqual } from '@api/integrations/mcp/mcp.auth';
import { billingService, dataExportService, prismaRepository } from '@api/server.module';
import { BillingNotFoundError, BillingValidationError } from '@api/services/billing.service';
import { ExportBusyError } from '@api/services/data-export.service';
import { Auth, configService } from '@config/env.config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@exceptions';
import { once } from 'events';
import { Request, Response, Router } from 'express';

import { HttpStatus } from './index.router';

/**
 * Cobrança manual por instância ("Plano e limites" > Cobrança) and the instance data export.
 * - GET    /billing/:instanceName              global key, or the client's code with the module "plano" (read-only)
 * - POST   /billing/:instanceName              global key: new entry
 * - PATCH  /billing/:instanceName/:id          global key: edit (status, value, payment date…)
 * - DELETE /billing/:instanceName/:id          global key
 * - GET    /billing/:instanceName/export.zip   global key: "Exportar dados da instância" (LGPD portability)
 * The instance token never reads nor writes billing: it is the instance's credential, not the operator's.
 */
export class BillingRouter {
  public readonly router: Router = Router();

  constructor() {
    this.router
      .get('/:instanceName/export.zip', authGuard.adminOnly, async (req: Request, res: Response) => {
        const instance = await this.instance(req.params.instanceName);
        if (dataExportService.isRunning(instance.id)) {
          return res.status(HttpStatus.CONFLICT).json({
            status: HttpStatus.CONFLICT,
            error: 'Conflict',
            response: { message: ['Já existe uma exportação desta instância em andamento. Aguarde terminar.'] },
          });
        }
        const day = new Date().toISOString().slice(0, 10);
        const file = `dados-${instance.name.replace(/[^\w.-]+/g, '-')}-${day}.zip`;
        res.set('Cache-Control', 'no-store');
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename="${file}"`);
        res.status(HttpStatus.OK);
        let closed = false;
        res.on('close', () => {
          closed = true;
        });
        try {
          await dataExportService.exportInstance(instance, {
            write: (chunk) =>
              closed ? false : res.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
            drain: async () => {
              if (closed) throw new Error('download cancelado pelo cliente');
              if (res.writableNeedDrain) await once(res, 'drain');
            },
            end: () => res.end(),
          });
        } catch (error) {
          if (error instanceof ExportBusyError) {
            if (!res.headersSent) return res.status(HttpStatus.CONFLICT).json({ message: error.message });
          }
          // headers already went out: cut the download, the browser shows it as failed instead of a broken zip
          if (!res.writableEnded) res.destroy(error as Error);
        }
      })
      .get('/:instanceName', authGuard.apikey, async (req: Request, res: Response) => {
        const clientGrant = (req as any).clientAccess;
        // the client's code reaches here only with the module "plano" (src/utils/client-access.ts); otherwise only
        // the global key: an instance token is refused
        if (
          !clientGrant &&
          !safeEqual(req.get('apikey') ?? '', configService.get<Auth>('AUTHENTICATION').API_KEY.KEY)
        ) {
          throw new ForbiddenException(
            'Apenas o administrador (chave global) ou o acesso do cliente com o módulo Plano.',
          );
        }
        const instance = await this.instance(req.params.instanceName);
        res.set('Cache-Control', 'no-store');
        return res.status(HttpStatus.OK).json({ instance: instance.name, ...(await billingService.list(instance.id)) });
      })
      .post('/:instanceName', authGuard.adminOnly, async (req: Request, res: Response) => {
        const instance = await this.instance(req.params.instanceName);
        const entry = await this.run(() => billingService.create(instance.id, this.body(req)));
        return res.status(HttpStatus.CREATED).json(entry);
      })
      .patch('/:instanceName/:id', authGuard.adminOnly, async (req: Request, res: Response) => {
        const instance = await this.instance(req.params.instanceName);
        const entry = await this.run(() => billingService.update(instance.id, req.params.id, this.body(req)));
        return res.status(HttpStatus.OK).json(entry);
      })
      .delete('/:instanceName/:id', authGuard.adminOnly, async (req: Request, res: Response) => {
        const instance = await this.instance(req.params.instanceName);
        return res.status(HttpStatus.OK).json(await this.run(() => billingService.remove(instance.id, req.params.id)));
      });
  }

  private body(req: Request) {
    return req.body && typeof req.body === 'object' ? req.body : {};
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof BillingValidationError) throw new BadRequestException(error.errors);
      if (error instanceof BillingNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  private async instance(name: string) {
    const row = await prismaRepository.instance.findUnique({ where: { name }, select: { id: true, name: true } });
    if (!row) throw new NotFoundException(`Instância "${name}" não encontrada.`);
    return row;
  }
}
