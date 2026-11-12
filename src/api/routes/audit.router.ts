import { adminOnlyGuard } from '@api/guards/auth.guard';
import { auditLogService } from '@api/server.module';
import { Request, RequestHandler, Response, Router } from 'express';

import { HttpStatus } from './index.router';

/**
 * "Registro de ações" (chave global ou chave de equipe com papel Dono).
 * - GET /admin/audit?instance=&actor=&type=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=: mais novas primeiro.
 * - GET /admin/audit/export.csv (mesmos filtros): planilha para o Excel.
 */
export class AuditRouter {
  public readonly router: Router = Router();

  constructor(guard: RequestHandler = adminOnlyGuard) {
    this.router
      .get('/', guard, async (req: Request, res: Response) => {
        res.set('Cache-Control', 'no-store');
        return res.status(HttpStatus.OK).json(await auditLogService.list(req.query as Record<string, unknown>));
      })
      .get('/export.csv', guard, async (req: Request, res: Response) => {
        const csv = await auditLogService.csv(req.query as Record<string, unknown>);
        res.set('Cache-Control', 'no-store');
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', 'attachment; filename="registro-de-acoes.csv"');
        return res.status(HttpStatus.OK).send(csv);
      });
  }
}
