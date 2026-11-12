/**
 * "Registro de ações": one middleware in front of every route. When a request finishes with success and it is one of
 * the actions listed in src/utils/audit-log.ts, it records who made it (the owner, a team member by name, a client
 * code by its last characters or an instance token), the action, the instance and a truncated IP.
 *
 * It reads only the method, the path, the apikey header and the few body fields the rules name; nothing is written
 * before the response is sent, and a failure to write never reaches the request.
 */
import { safeEqual } from '@api/integrations/mcp/mcp.auth';
import { AuditActorKind, AuditLogService } from '@api/services/audit-log.service';
import { Auth, configService } from '@config/env.config';
import { auditActionFor, auditPath, truncateIp } from '@utils/audit-log';
import { clientIp } from '@utils/auth-throttle';
import { isClientKey } from '@utils/client-access';
import { NextFunction, Request, Response } from 'express';

export function auditActor(
  req: Request,
  globalKey: string | undefined,
): { actor: string; kind: AuditActorKind } | null {
  const key = req.get('apikey');
  if (!key) return null;
  if (globalKey && safeEqual(key, globalKey)) return { actor: 'Dono', kind: 'owner' };
  const team = (req as any).teamAccess;
  if (team?.name) return { actor: String(team.name), kind: 'team' };
  const session = (req as any).userSession;
  if (session?.name || session?.email) return { actor: String(session.name || session.email), kind: 'team' };
  if (isClientKey(key) && (req as any).clientAccess) {
    return { actor: `Cliente (código wac_…${key.slice(-4)})`, kind: 'client' };
  }
  return { actor: 'Token da instância', kind: 'instance' };
}

export function createAuditMiddleware(service: () => AuditLogService, globalKey: () => string | undefined) {
  return function auditMiddleware(req: Request, res: Response, next: NextFunction) {
    res.on('finish', () => {
      try {
        if (res.statusCode >= 400) return;
        const action = auditActionFor(req.method, req.originalUrl, req.body);
        if (!action) return;
        const who = auditActor(req, globalKey());
        if (!who) return;
        service().record({
          actor: who.actor,
          actorKind: who.kind,
          type: action.type,
          action: action.action,
          instanceName: action.instanceName,
          target: action.target,
          method: req.method,
          path: auditPath(req.originalUrl),
          status: res.statusCode,
          ip: truncateIp(clientIp(req.headers)),
        });
      } catch {
        /* never let the log affect the request */
      }
    });
    next();
  };
}

export const auditGlobalKey = () => configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
