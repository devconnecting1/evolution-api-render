import { authGuard } from '@api/guards/auth.guard';
import { observabilityService } from '@api/services/observability.service';
import { Router } from 'express';

import { HttpStatus } from './index.router';

export class ObservabilityRouter {
  public readonly router: Router = Router();

  constructor() {
    this.router.get('/', authGuard['apikey'], async (req, res) => {
      const force = req.query?.refresh === '1' || req.query?.refresh === 'true';
      const overview = await observabilityService.getOverview(force);

      res.set('Cache-Control', 'no-store');
      return res.status(HttpStatus.OK).json(overview);
    });
  }
}
