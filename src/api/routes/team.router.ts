import { authGuard } from '@api/guards/auth.guard';
import { teamAccessService } from '@api/server.module';
import { TeamAccessValidationError } from '@api/services/team-access.service';
import { BadRequestException, NotFoundException } from '@exceptions';
import { isTeamKey } from '@utils/team-access';
import { Request, Response, Router } from 'express';

import { HttpStatus } from './index.router';

/**
 * "Equipe".
 * - GET /team/me (any key): for a team key, its name, role and instances, so the panel hides what the role cannot
 *   do; for anything else { team: false }.
 * - GET|POST /team and DELETE /team/:id (global key only): list, create (the key comes back once) and revoke.
 */
export class TeamRouter {
  public readonly router: Router = Router();

  constructor() {
    this.router
      .get('/me', authGuard.apikey, async (req: Request, res: Response) => {
        res.set('Cache-Control', 'no-store');
        const grant = (req as any).teamAccess;
        if (!grant || !isTeamKey(req.get('apikey'))) return res.status(HttpStatus.OK).json({ team: false });
        return res.status(HttpStatus.OK).json({
          team: true,
          name: grant.name,
          role: grant.role,
          instances: grant.instanceNames,
          roles: teamAccessService.rolesCatalog(),
        });
      })
      .get('/', authGuard.adminOnly, async (_req: Request, res: Response) => {
        res.set('Cache-Control', 'no-store');
        return res.status(HttpStatus.OK).json(await teamAccessService.list());
      })
      .post('/', authGuard.adminOnly, async (req: Request, res: Response) => {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        try {
          const created = await teamAccessService.create(body);
          res.set('Cache-Control', 'no-store');
          return res.status(HttpStatus.CREATED).json(created);
        } catch (error) {
          if (error instanceof TeamAccessValidationError) throw new BadRequestException(error.errors);
          throw error;
        }
      })
      .delete('/:id', authGuard.adminOnly, async (req: Request, res: Response) => {
        const result = await teamAccessService.revoke(String(req.params.id || '').slice(0, 64));
        if (!result.removed) throw new NotFoundException('Chave não encontrada.');
        return res.status(HttpStatus.OK).json(result);
      });
  }
}
