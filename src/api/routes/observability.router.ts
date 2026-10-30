import { authGuard } from '@api/guards/auth.guard';
import { observabilityService } from '@api/services/observability.service';
import { Router } from 'express';

import { HttpStatus } from './index.router';

export class ObservabilityRouter {
  public readonly router: Router = Router();

  constructor() {
    this.router.get('/', authGuard['apikey'], async (req, res) => {
      // `refresh=1` (used by the Manager) and `force=1` both skip the 60s cache
      const force = ['refresh', 'force'].some((name) => req.query?.[name] === '1' || req.query?.[name] === 'true');
      const overview = await observabilityService.getOverview(force);

      res.set('Cache-Control', 'no-store');
      return res.status(HttpStatus.OK).json(overview);
    });
  }
}
