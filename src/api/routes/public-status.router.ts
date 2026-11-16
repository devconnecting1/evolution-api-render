import { publicStatusService } from '@api/services/public-status.service';
import { Router } from 'express';

import { HttpStatus } from './index.router';

/**
 * Public status page (no API key): aggregates only the local system and WhatsApp views.
 * Never returns instance names, phone numbers, messages, tokens or provider keys.
 */
export class PublicStatusRouter {
  public readonly router: Router = Router();

  constructor() {
    this.router.get('/', async (_req, res) => {
      try {
        const data = await publicStatusService.getStatus();
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=30');
        return res.status(HttpStatus.OK).json(data);
      } catch {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Cache-Control', 'no-store');
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          response: { message: ['Não foi possível consultar o status agora.'] },
        });
      }
    });
  }
}
