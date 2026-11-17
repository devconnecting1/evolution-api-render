import { publicStatusService } from '@api/services/public-status.service';
import { Router } from 'express';

import { HttpStatus } from './index.router';

/**
 * Status público (sem chave). Nunca devolve nomes de instância, números, mensagens, tokens ou chaves.
 *
 *   GET /status       estado atual, 90 dias por componente, faixas de 3 h e incidentes (cache de 30 s)
 *   GET /status/ping  só memória: versão, tempo no ar e estado dos componentes; sem banco e sem gravar no Redis.
 *                     Feito para monitores externos (ops/status-monitor).
 */
export class PublicStatusRouter {
  public readonly router: Router = Router();

  constructor() {
    this.router.get('/ping', (_req, res) => {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Cache-Control', 'no-store');
      try {
        return res.status(HttpStatus.OK).json(publicStatusService.ping());
      } catch {
        return res.status(HttpStatus.OK).json({ status: 'ok' });
      }
    });

    this.router.get('/', async (_req, res) => {
      res.set('Access-Control-Allow-Origin', '*');
      try {
        const data = await publicStatusService.getStatus();
        res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=30');
        return res.status(HttpStatus.OK).json(data);
      } catch {
        res.set('Cache-Control', 'no-store');
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          response: { message: ['Não foi possível consultar o status agora.'] },
        });
      }
    });
  }
}
