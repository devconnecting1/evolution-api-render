import { authGuard } from '@api/guards/auth.guard';
import { safeEqual } from '@api/integrations/mcp/mcp.auth';
import { googleLoginService, userSessionService } from '@api/server.module';
import { GoogleLoginError, GoogleLoginService } from '@api/services/google-login.service';
import { UserSessionService } from '@api/services/user-session.service';
import { Auth, configService } from '@config/env.config';
import { ForbiddenException, UnauthorizedException } from '@exceptions';
import { clientIp } from '@utils/auth-throttle';
import { LOGIN_STATE_COOKIE, readCookie, stateCookie } from '@utils/google-login';
import { Request, Response, Router } from 'express';

import { HttpStatus } from './index.router';

export type AuthRouterDeps = {
  googleLogin?: GoogleLoginService;
  users?: UserSessionService;
};

function secureRequest(req: Request): boolean {
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim();
  return req.secure || forwarded === 'https';
}

function clearStateCookie(): string {
  return stateCookie('', false, 0);
}

/**
 * "Entrar com Google" (proposta V, etapa 1).
 * - GET  /auth/google/status   public: is the feature configured? (no sensitive data)
 * - GET  /auth/google          public: signed state + HttpOnly cookie nonce, then the Google consent screen
 * - GET  /auth/google/callback public: validates state/cookie, e-mail verified and allowlist; only redirects to the
 *                              fixed GOOGLE_LOGIN_RETURN_URL, with a one-time code (never the session token)
 * - POST /auth/google/exchange public: trades the one-time code for the session token (shown only once)
 * - POST /auth/logout          session: revokes the session of the request (the global key stays break-glass)
 */
export class AuthRouter {
  public readonly router: Router = Router();

  constructor(private readonly deps: AuthRouterDeps = {}) {
    const google = () => this.deps.googleLogin ?? googleLoginService;
    const users = () => this.deps.users ?? userSessionService;

    this.router
      .get('/google/status', (_req: Request, res: Response) => {
        res.set('Cache-Control', 'no-store');
        return res.status(HttpStatus.OK).json(google().status());
      })
      .get('/google', (req: Request, res: Response) => {
        if (!google().available()) {
          return res.status(503).json({
            status: 503,
            error: 'Service Unavailable',
            response: {
              message: ['O login com Google não está configurado no servidor. Use a chave de acesso.'],
            },
          });
        }
        let connect: { url: string; state: string; nonce: string };
        try {
          connect = google().connect();
        } catch (error) {
          if (error instanceof GoogleLoginError) {
            return res.status(503).json({
              status: 503,
              error: 'Service Unavailable',
              response: { message: [error.message] },
            });
          }
          throw error;
        }
        res.set('Cache-Control', 'no-store');
        res.setHeader('Set-Cookie', stateCookie(connect.nonce, secureRequest(req)));
        return res.redirect(302, connect.url);
      })
      .get('/google/callback', async (req: Request, res: Response) => {
        let target: string;
        try {
          const claims = await google().finish({
            code: req.query.code,
            state: req.query.state,
            cookieNonce: readCookie(req.headers.cookie, LOGIN_STATE_COOKIE),
            error: req.query.error,
          });
          target = google().successRedirect(google().issueCode(claims));
        } catch (error) {
          const message =
            error instanceof GoogleLoginError ? error.message : 'Não foi possível entrar com o Google agora.';
          target = google().errorRedirect(message);
        }
        res.set('Cache-Control', 'no-store');
        res.setHeader('Set-Cookie', clearStateCookie());
        return res.redirect(302, target);
      })
      .post('/google/exchange', async (req: Request, res: Response) => {
        const claims = google().consumeCode(req.body?.code);
        if (!claims) throw new UnauthorizedException('O login expirou. Clique em "Entrar com Google" de novo.');
        const user = await users().findOrCreateUser(claims);
        const created = await users().createSession(user.id, {
          userAgent: req.get('user-agent'),
          ip: clientIp(req.headers),
        });
        res.set('Cache-Control', 'no-store');
        return res.status(HttpStatus.OK).json({
          token: created.token,
          user,
          session: created.session,
        });
      })
      .post('/logout', authGuard.apikey, async (req: Request, res: Response) => {
        res.set('Cache-Control', 'no-store');
        const session = (req as any).userSession;
        if (session) {
          const revoked = await users().revokeSession(session.sessionId);
          return res.status(HttpStatus.OK).json({ ok: true, revoked });
        }
        const globalKey = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
        if (safeEqual(req.get('apikey'), globalKey)) {
          return res.status(HttpStatus.OK).json({ ok: true, revoked: false });
        }
        throw new ForbiddenException('Só uma pessoa da equipe encerra a própria sessão.');
      });
  }
}
