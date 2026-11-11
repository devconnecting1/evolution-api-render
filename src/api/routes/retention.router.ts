import { adminOnlyGuard } from '@api/guards/auth.guard';
import { retentionService } from '@api/server.module';
import { RetentionValidationError } from '@api/services/retention.service';
import { BadRequestException } from '@exceptions';
import { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import { HttpStatus } from './index.router';

/**
 * Retenção das mensagens (LGPD), só com a chave global:
 *   GET  /admin/retention            prazo em vigor + quantas mensagens de cada instância sairiam com ele
 *   GET  /admin/retention?days=180   a mesma prévia para outro prazo (sem salvar)
 *   POST /admin/retention {days}     salva o prazo de todas as instâncias (0 = desligada)
 *   POST /admin/retention/run        apaga agora, em todas as instâncias, o que passou do prazo
 */
export class RetentionRouter {
  public readonly router: Router = Router();

  constructor(guard: RequestHandler = adminOnlyGuard) {
    const noStore = (_req: Request, res: Response, next: NextFunction) => {
      res.set('Cache-Control', 'no-store');
      next();
    };
    const validation = (error: unknown) => {
      if (error instanceof RetentionValidationError) throw new BadRequestException(error.message);
      throw error;
    };

    this.router
      .get('/', guard, noStore, async (req: Request, res: Response) => {
        try {
          const days = req.query.days === undefined ? undefined : req.query.days;
          const [config, preview] = await Promise.all([retentionService.config(), retentionService.preview(days)]);
          return res.status(HttpStatus.OK).json({ ...config, preview });
        } catch (error) {
          return validation(error);
        }
      })
      .post('/', guard, noStore, async (req: Request, res: Response) => {
        try {
          const config = await retentionService.setDays(req.body?.days);
          const preview = await retentionService.preview();
          return res.status(HttpStatus.OK).json({ ...config, preview });
        } catch (error) {
          return validation(error);
        }
      })
      .post('/run', guard, noStore, async (_req: Request, res: Response) => {
        return res.status(HttpStatus.OK).json(await retentionService.purgeAll());
      });
  }
}
