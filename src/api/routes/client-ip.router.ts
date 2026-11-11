import { adminOnlyGuard } from '@api/guards/auth.guard';
import { authThrottle, clientIp, IP_HEADERS } from '@utils/auth-throttle';
import { Request, RequestHandler, Response, Router } from 'express';

import { HttpStatus } from './index.router';

/**
 * GET /admin/client-ip (global key only): which headers carry the caller's IP on this deployment and which one the
 * wrong-key limit uses (src/utils/auth-throttle.ts). Shows only the caller's own request; nothing is stored.
 */
export class ClientIpRouter {
  public readonly router: Router = Router();

  constructor(guard: RequestHandler = adminOnlyGuard) {
    this.router.get('/', guard, (req: Request, res: Response) => {
      const headers: Record<string, string | null> = {};
      for (const name of IP_HEADERS) {
        const value = req.headers[name];
        headers[name] = value === undefined ? null : Array.isArray(value) ? value.join(', ') : String(value);
      }
      const ip = clientIp(req.headers);
      res.set('Cache-Control', 'no-store');
      return res.status(HttpStatus.OK).json({
        trustedHeader: process.env.TRUSTED_CLIENT_IP_HEADER || 'cf-connecting-ip,true-client-ip',
        detected: ip,
        throttleActive: !!ip,
        blocked: authThrottle.isBlocked(ip),
        headers,
        socket: req.socket?.remoteAddress ?? null,
      });
    });
  }
}
