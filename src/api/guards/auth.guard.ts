import { InstanceDto } from '@api/dto/instance.dto';
import { cachedInstanceToken } from '@api/guards/instance-token-cache';
import { safeEqual } from '@api/integrations/mcp/mcp.auth';
import { clientAccessService, prismaRepository, userSessionService } from '@api/server.module';
import { Auth, configService, Database } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { ForbiddenException, UnauthorizedException } from '@exceptions';
import { authThrottle, clientIp } from '@utils/auth-throttle';
import { clientRouteAllowed, isClientKey, normalizeClientPath } from '@utils/client-access';
import { isSessionToken } from '@utils/google-login';
import { NextFunction, Request, Response } from 'express';

const logger = new Logger('GUARD');

async function instanceToken(name: string): Promise<string | undefined> {
  return cachedInstanceToken(
    name,
    async (n) => (await prismaRepository.instance.findUnique({ where: { name: n } }))?.token,
  );
}

function tooManyAttempts(res: Response, ip: string) {
  res.set('Retry-After', String(authThrottle.retryAfter(ip)));
  return res.status(429).json({
    status: 429,
    error: 'Too Many Requests',
    response: { message: ['Muitas tentativas com chave inválida. Tente de novo em alguns minutos.'] },
  });
}

/**
 * Wrong keys count per client IP (src/utils/auth-throttle.ts). A blocked IP still gets in with the global key
 * (compared in memory, constant time); anything else gets 429 without touching the database.
 */
async function apikey(req: Request, res: Response, next: NextFunction) {
  const ip = clientIp(req.headers);
  const key = req.get('apikey');
  if (authThrottle.isBlocked(ip) && !safeEqual(key ?? '', configService.get<Auth>('AUTHENTICATION').API_KEY.KEY)) {
    return tooManyAttempts(res, ip);
  }
  try {
    return await checkApikey(req, key, next);
  } catch (error) {
    if (error instanceof UnauthorizedException) authThrottle.recordFailure(ip);
    throw error;
  }
}

async function checkApikey(req: Request, key: string | undefined, next: NextFunction) {
  const env = configService.get<Auth>('AUTHENTICATION').API_KEY;
  const db = configService.get<Database>('DATABASE');

  if (!key) {
    throw new UnauthorizedException();
  }

  // Break-glass: the global key always passes, whatever it looks like (even a "was_" prefix).
  if (safeEqual(key, env.KEY)) {
    return next();
  }

  // Person session ("was_", Google login). Comes before the client code and the instance token: the prefixes do
  // not overlap, so this is only about a clear precedence (global key > session > client > instance).
  if (isSessionToken(key)) {
    const session = await userSessionService.resolve(key).catch((error: any) => {
      logger.error(error);
      return null;
    });
    if (!session) throw new UnauthorizedException('Sua sessão expirou. Entre de novo com o Google.');
    (req as any).userSession = session;
    return next();
  }

  if (isClientKey(key)) {
    return clientAccessGuard(req, key, next);
  }

  if ((req.originalUrl.includes('/instance/create') || req.originalUrl.includes('/instance/fetchInstances')) && !key) {
    throw new ForbiddenException('Missing global api key', 'The global api key must be set');
  }
  const param = req.params as unknown as InstanceDto;

  try {
    if (param?.instanceName) {
      if (safeEqual(key, await instanceToken(param.instanceName))) {
        return next();
      }
    } else {
      if (req.originalUrl.includes('/instance/fetchInstances') && db.SAVE_DATA.INSTANCE) {
        const instanceByKey = await prismaRepository.instance.findFirst({
          where: { token: key },
        });
        if (instanceByKey) {
          return next();
        }
      }
    }
  } catch (error) {
    logger.error(error);
  }

  throw new UnauthorizedException();
}

/**
 * "Acesso do cliente" (`wac_...` code): only the instance of the code and only the routes of the modules the
 * administrator chose (src/utils/client-access.ts). Decided here, on the server, for every request.
 */
async function clientAccessGuard(req: Request, key: string, next: NextFunction) {
  let grant = null;
  try {
    grant = await clientAccessService.resolve(key);
  } catch (error) {
    logger.error(error);
  }
  if (!grant) {
    throw new UnauthorizedException();
  }

  const instanceName = (req.params as unknown as InstanceDto)?.instanceName;
  if (instanceName && instanceName !== grant.instanceName) {
    throw new ForbiddenException('Este código de acesso é de outra instância.');
  }

  const path = normalizeClientPath(req.originalUrl, grant.instanceName);
  if (!clientRouteAllowed(req.method, path, grant.modules, req.body)) {
    throw new ForbiddenException('Este acesso não inclui esta função. Fale com quem configurou o seu painel.');
  }

  (req as any).clientAccess = grant;
  return next();
}

/**
 * Admin-only routes ("Chaves e credenciais", "Equipe"): the global AUTHENTICATION_API_KEY (break-glass) or a valid
 * person session passes. The global key is compared in constant time; any other key gets 403, a valid instance
 * token included, and the instance tokens are never even looked up (no oracle telling a valid token from an invalid
 * one). No key at all: 401, as in `apikey`. In V1 everyone on the allowlist is an owner; roles arrive in V2.
 */
export function createAdminOnlyGuard(
  globalKey: () => string | undefined,
  resolveSession: (token: string) => Promise<any | null> = (token) => userSessionService.resolve(token),
) {
  return function adminOnlyGuard(req: Request, res: Response, next: NextFunction) {
    const key = req.get('apikey');
    const ip = clientIp(req.headers);

    if (key && safeEqual(key, globalKey())) {
      return next();
    }
    // Blocked IP: 429 without asking the session table (a blocked scanner must not wake the database). The global
    // key above is the break-glass and still passes.
    if (authThrottle.isBlocked(ip)) {
      return tooManyAttempts(res, ip);
    }
    if (key && isSessionToken(key)) {
      // async path handled explicitly: the guard also runs outside the app (unit tests) without async wrappers
      Promise.resolve(resolveSession(key))
        .then((session) => {
          if (session) {
            (req as any).userSession = session;
            return next();
          }
          authThrottle.recordFailure(ip);
          try {
            throw new UnauthorizedException('Sua sessão expirou. Entre de novo com o Google.');
          } catch (error) {
            next(error);
          }
          return undefined;
        })
        .catch(next);
      return;
    }
    if (!key) {
      throw new UnauthorizedException();
    }
    // a wrong key here is a guess at the global key (valid instance tokens and client codes are not wrong keys)
    if (!isClientKey(key)) authThrottle.recordFailure(ip);
    throw new ForbiddenException('Apenas o administrador (chave global) tem acesso.');
  };
}

export const adminOnlyGuard = createAdminOnlyGuard(() => configService.get<Auth>('AUTHENTICATION').API_KEY.KEY);

export const authGuard = { apikey, adminOnly: adminOnlyGuard };
