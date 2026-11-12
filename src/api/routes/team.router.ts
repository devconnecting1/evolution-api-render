import { authGuard } from '@api/guards/auth.guard';
import { safeEqual } from '@api/integrations/mcp/mcp.auth';
import { googleLoginService, userSessionService } from '@api/server.module';
import { GoogleLoginService } from '@api/services/google-login.service';
import { SessionUser, UserSessionService } from '@api/services/user-session.service';
import { Auth, configService } from '@config/env.config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@exceptions';
import { Request, Response, Router } from 'express';

import { HttpStatus } from './index.router';

export type TeamRouterDeps = {
  googleLogin?: GoogleLoginService;
  users?: UserSessionService;
};

/**
 * "Equipe" (proposta V, etapa 1): who is allowed (the GOOGLE_LOGIN_OWNER_EMAILS allowlist), who entered and the
 * active sessions, with "Revogar" by session id. No invites, roles or action log yet (V2/V3).
 * - GET  /team/me        the person of the session (or `globalKey: true` for the break-glass key)
 * - GET  /team/sessions  administrator: everyone of the allowlist and every active session; person: only their own
 * - POST /team/revoke    { id }: administrator revokes any session; a person only their own
 */
export class TeamRouter {
  public readonly router: Router = Router();

  constructor(private readonly deps: TeamRouterDeps = {}) {
    const google = () => this.deps.googleLogin ?? googleLoginService;
    const users = () => this.deps.users ?? userSessionService;

    const context = (req: Request): { session: SessionUser | null; global: boolean } => {
      const session: SessionUser | null = (req as any).userSession ?? null;
      const globalKey = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
      const global = safeEqual(req.get('apikey'), globalKey);
      if (!session && !global) {
        throw new ForbiddenException('Só o dono (chave global) ou uma pessoa da equipe tem acesso.');
      }
      return { session, global };
    };

    this.router
      .get('/me', authGuard.apikey, (req: Request, res: Response) => {
        res.set('Cache-Control', 'no-store');
        const { session, global } = context(req);
        if (global) return res.status(HttpStatus.OK).json({ globalKey: true, user: null, session: null });
        return res.status(HttpStatus.OK).json({
          globalKey: false,
          user: {
            id: session.userId,
            email: session.email,
            name: session.name,
            picture: session.picture,
          },
          session: { id: session.sessionId },
        });
      })
      .get('/sessions', authGuard.apikey, async (req: Request, res: Response) => {
        res.set('Cache-Control', 'no-store');
        const { session, global } = context(req);
        if (global) {
          const allowlist = google().allowlist();
          const overview = await users().overview(allowlist);
          return res.status(HttpStatus.OK).json({
            globalKey: true,
            allowlist,
            people: overview.people,
            sessions: overview.sessions,
          });
        }
        const sessions = await users().listSessions(session.userId, session.sessionId);
        return res.status(HttpStatus.OK).json({
          globalKey: false,
          user: { id: session.userId, email: session.email, name: session.name, picture: session.picture },
          sessions,
        });
      })
      .post('/revoke', authGuard.apikey, async (req: Request, res: Response) => {
        res.set('Cache-Control', 'no-store');
        const { session, global } = context(req);
        const id = typeof req.body?.id === 'string' ? req.body.id : '';
        if (!id) throw new BadRequestException('Informe o id da sessão.');
        const revoked = global
          ? await users().revokeSession(id)
          : await users().revokeSession(id, session.userId);
        if (!revoked) throw new NotFoundException('Sessão não encontrada.');
        return res.status(HttpStatus.OK).json({ revoked: true, id });
      });
  }
}
