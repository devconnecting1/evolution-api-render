import { authGuard } from '@api/guards/auth.guard';
import { safeEqual } from '@api/integrations/mcp/mcp.auth';
import { googleLoginService, teamAccessService, userSessionService } from '@api/server.module';
import { GoogleLoginService } from '@api/services/google-login.service';
import { TeamAccessService, TeamAccessValidationError } from '@api/services/team-access.service';
import { SessionUser, UserSessionService } from '@api/services/user-session.service';
import { Auth, configService } from '@config/env.config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@exceptions';
import { isTeamKey } from '@utils/team-access';
import { Request, Response, Router } from 'express';

import { HttpStatus } from './index.router';

export type TeamRouterDeps = {
  googleLogin?: GoogleLoginService;
  users?: UserSessionService;
  teamAccess?: TeamAccessService;
};

/**
 * "Equipe" (proposta V): quem entrou com Google, as sessões ativas e as chaves por pessoa.
 * - GET  /team/me        a pessoa da sessão (ou `globalKey: true`), ou nome, papel e instâncias de uma chave `wat_`
 * - GET  /team/sessions  administrador: allowlist e sessões ativas; pessoa: só as próprias
 * - POST /team/revoke    { id }: administrador revoga qualquer sessão; pessoa só as próprias
 * - GET|POST /team/keys e DELETE /team/keys/:id  chaves por pessoa (chave global ou papel Dono)
 */
export class TeamRouter {
  public readonly router: Router = Router();

  constructor(private readonly deps: TeamRouterDeps = {}) {
    const google = () => this.deps.googleLogin ?? googleLoginService;
    const users = () => this.deps.users ?? userSessionService;
    const teamAccess = () => this.deps.teamAccess ?? teamAccessService;

    const context = (req: Request): { session: SessionUser | null; global: boolean } => {
      const session: SessionUser | null = (req as any).userSession ?? null;
      const globalKey = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
      const global = safeEqual(req.get('apikey'), globalKey);
      // a team key of the "dono" role has the same reach as the global key (the apikey guard already blocked the
      // other roles before reaching here)
      const team = isTeamKey(req.get('apikey')) ? (req as any).teamAccess : null;
      if (team && team.role !== 'dono') {
        throw new ForbiddenException('Apenas o dono do painel tem acesso.');
      }
      if (!session && !global && !team) {
        throw new ForbiddenException('Só o dono (chave global) ou uma pessoa da equipe tem acesso.');
      }
      return { session, global: global || !!team };
    };

    this.router
      .get('/me', authGuard.apikey, (req: Request, res: Response) => {
        res.set('Cache-Control', 'no-store');
        const team = isTeamKey(req.get('apikey')) ? (req as any).teamAccess : null;
        if (team) {
          return res.status(HttpStatus.OK).json({
            globalKey: false,
            team: true,
            name: team.name,
            role: team.role,
            instances: team.instanceNames,
            roles: teamAccess().rolesCatalog(),
            user: null,
            session: null,
          });
        }
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
        const revoked = global ? await users().revokeSession(id) : await users().revokeSession(id, session.userId);
        if (!revoked) throw new NotFoundException('Sessão não encontrada.');
        return res.status(HttpStatus.OK).json({ revoked: true, id });
      })
      .get('/keys', authGuard.adminOnly, async (_req: Request, res: Response) => {
        res.set('Cache-Control', 'no-store');
        return res.status(HttpStatus.OK).json(await teamAccess().list());
      })
      .post('/keys', authGuard.adminOnly, async (req: Request, res: Response) => {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        try {
          const created = await teamAccess().create(body);
          res.set('Cache-Control', 'no-store');
          return res.status(HttpStatus.CREATED).json(created);
        } catch (error) {
          if (error instanceof TeamAccessValidationError) throw new BadRequestException(error.errors);
          throw error;
        }
      })
      .delete('/keys/:id', authGuard.adminOnly, async (req: Request, res: Response) => {
        const result = await teamAccess().revoke(String(req.params.id || '').slice(0, 64));
        if (!result.removed) throw new NotFoundException('Chave não encontrada.');
        return res.status(HttpStatus.OK).json(result);
      });
  }
}
