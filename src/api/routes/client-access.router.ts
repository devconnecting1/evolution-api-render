import { authGuard } from '@api/guards/auth.guard';
import { clientAccessService, prismaRepository } from '@api/server.module';
import { ClientAccessValidationError } from '@api/services/client-access.service';
import { BadRequestException, NotFoundException } from '@exceptions';
import { isClientKey } from '@utils/client-access';
import { Request, Response, Router } from 'express';

import { HttpStatus } from './index.router';

/**
 * "Acesso do cliente".
 * - GET /client-access/me (the client's own code): instance and modules, so the panel shows only those.
 * - GET|POST|DELETE /client-access/:instanceName (global key only): turn on, pick modules, new code, revoke.
 */
export class ClientAccessRouter {
  public readonly router: Router = Router();

  constructor() {
    this.router
      .get('/me', authGuard.apikey, async (req: Request, res: Response) => {
        res.set('Cache-Control', 'no-store');
        const grant = (req as any).clientAccess;
        if (!grant || !isClientKey(req.get('apikey'))) {
          return res.status(HttpStatus.OK).json({ client: false });
        }
        return res.status(HttpStatus.OK).json({
          client: true,
          instance: { id: grant.instanceId, name: grant.instanceName },
          modules: grant.modules,
          catalog: clientAccessService.modulesCatalog().filter((item) => grant.modules.includes(item.id)),
        });
      })
      .get('/:instanceName', authGuard.adminOnly, async (req: Request, res: Response) => {
        const instance = await this.instance(req.params.instanceName as string);
        res.set('Cache-Control', 'no-store');
        return res.status(HttpStatus.OK).json(await clientAccessService.view(instance.id, instance.name));
      })
      .post('/:instanceName', authGuard.adminOnly, async (req: Request, res: Response) => {
        const instance = await this.instance(req.params.instanceName as string);
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        try {
          const result = await clientAccessService.save(instance.id, instance.name, body);
          res.set('Cache-Control', 'no-store');
          return res.status(HttpStatus.OK).json(result);
        } catch (error) {
          if (error instanceof ClientAccessValidationError) throw new BadRequestException(error.errors);
          throw error;
        }
      })
      .delete('/:instanceName', authGuard.adminOnly, async (req: Request, res: Response) => {
        const instance = await this.instance(req.params.instanceName as string);
        return res.status(HttpStatus.OK).json(await clientAccessService.revoke(instance.id, instance.name));
      });
  }

  private async instance(name: string) {
    const row = await prismaRepository.instance.findUnique({ where: { name }, select: { id: true, name: true } });
    if (!row) throw new NotFoundException(`Instância "${name}" não encontrada.`);
    return row;
  }
}
