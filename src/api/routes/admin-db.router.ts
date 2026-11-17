import { RouterBroker } from '@api/abstract/abstract.router';
import { adminOnlyGuard } from '@api/guards/auth.guard';
import { dbActivity } from '@api/repository/db-activity';
import { getInstanceDatabases } from '@api/repository/instance-db';
import { Request, RequestHandler, Response, Router } from 'express';

export interface AdminDbOptions {
  /** Only the global key passes (adminOnlyGuard); the tests hand in their own. */
  guard?: RequestHandler;
}

/**
 * Admin-only database info, none of which touches the database (so reading it never wakes Neon):
 *   GET /admin/database-quota  Neon project quota for the "Nova instância" choice (own / shared database).
 *   GET /admin/db-activity     what woke the main database lately (table + SQL verb only, never values), plus
 *                              `daily`: wakes per day/hour/cause kept in Redis so they survive deploys.
 */
export class AdminDbRouter extends RouterBroker {
  public readonly router: Router = Router();

  constructor(options: AdminDbOptions = {}) {
    super();
    const guard = options.guard ?? adminOnlyGuard;
    const noStore = (_req: Request, res: Response, next: () => void) => {
      res.set('Cache-Control', 'no-store');
      next();
    };

    this.router
      .get('/database-quota', guard, noStore, async (req: Request, res: Response) => {
        const dbs = getInstanceDatabases();
        const force = req.query.refresh === '1' || req.query.refresh === 'true';
        const quota = dbs
          ? await dbs.quota(force)
          : {
              enabled: false,
              defaultMode: 'shared',
              limit: 0,
              used: null,
              remaining: null,
              ownInstances: 0,
              source: 'off',
            };
        res.status(200).json(quota);
      })
      .get('/db-activity', guard, noStore, async (req: Request, res: Response) => {
        const limit = Math.min(300, Math.max(1, Number.parseInt(String(req.query.limit ?? '50'), 10) || 50));
        const days = Math.min(35, Math.max(1, Number.parseInt(String(req.query.days ?? '14'), 10) || 14));
        // `daily` vem do Redis (sobrevive aos deploys); o resto é a memória deste processo
        const daily = await dbActivity.daily(days).catch((): Awaited<ReturnType<typeof dbActivity.daily>> => []);
        res.status(200).json({ ...dbActivity.snapshot(limit), daily });
      });
  }
}
