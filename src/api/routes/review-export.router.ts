import { once } from 'node:events';

import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto } from '@api/dto/instance.dto';
import { reviewExportGuard } from '@api/guards/review-export.guard';
import { reviewExportController } from '@api/server.module';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

/** "Exportar conversas para revisão" (admin only, never a client access code: review-export.guard.ts). */
export class ReviewExportRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router.get(this.routerPath('review'), ...guards, reviewExportGuard, async (req, res) => {
      const instance = req.params as unknown as InstanceDto;
      const response = await reviewExportController.exportReview(instance, RouterBroker.queryWithoutInstance(req));

      res.set('Cache-Control', 'no-store');
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', `attachment; filename="${response.filename}"`);
      res.set('X-Review-Conversations', String(response.conversations));
      res.set('X-Review-Partial', response.partial ? '1' : '0');
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
        // Headers already sent: a half ZIP must not look complete
        res.destroy();
      }
    });
  }

  public readonly router: Router = Router();
}
