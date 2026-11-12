import { InstanceDto } from '@api/dto/instance.dto';
import { cachedInstanceToken } from '@api/guards/instance-token-cache';
import { safeEqual } from '@api/integrations/mcp/mcp.auth';
import { clientAccessService, prismaRepository, teamAccessService } from '@api/server.module';
import { Auth, configService, Database } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { ForbiddenException, UnauthorizedException } from '@exceptions';
import { authThrottle, clientIp } from '@utils/auth-throttle';
import { clientRouteAllowed, isClientKey, normalizeClientPath } from '@utils/client-access';
import { isTeamKey, teamRouteAllowed } from '@utils/team-access';
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
    // the exceptions of src/exceptions throw a plain { status, error, message } object, never an instance, so the
    // `instanceof` alone never matched and wrong keys were not counted
    if (error instanceof UnauthorizedException || (error as { status?: number })?.status === 401) {
      authThrottle.recordFailure(ip);
    }
    throw error;
  }
}

async function checkApikey(req: Request, key: string | undefined, next: NextFunction) {
  const env = configService.get<Auth>('AUTHENTICATION').API_KEY;
  const db = configService.get<Database>('DATABASE');

  if (!key) {
    throw new UnauthorizedException();
  }

  if (safeEqual(key, env.KEY)) {
    return next();
  }

  if (isClientKey(key)) {
    return clientAccessGuard(req, key, next);
  }

  if (isTeamKey(key)) {
    return teamKeyGuard(req, key, next);
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
 * "Equipe" (`wat_...` key, src/utils/team-access.ts): only the instances of the key and only what its role allows.
 * Routes without an instance in the path are closed except a short list (fetchInstances, who am I). Decided here,
 * on the server, for every request; the instance token is never handed to a team key (teamInstanceView).
 */
async function teamKeyGuard(req: Request, key: string, next: NextFunction) {
  let grant = null;
  try {
    grant = await teamAccessService.resolve(key);
  } catch (error) {
    logger.error(error);
  }
  if (!grant) {
    throw new UnauthorizedException();
  }

  const instanceName = (req.params as unknown as InstanceDto)?.instanceName;
  if (instanceName && grant.instanceNames && !grant.instanceNames.includes(instanceName)) {
    throw new ForbiddenException('Esta chave não tem acesso a esta instância.');
  }

  const path = normalizeClientPath(req.originalUrl, instanceName);
  if (!teamRouteAllowed(req.method, path, grant.role, !!instanceName)) {
    throw new ForbiddenException(
      grant.role === 'leitura'
        ? 'Esta chave é só de leitura.'
        : 'Esta função fica com o dono do painel. Peça a quem administra o WhatsAI.',
    );
  }

  (req as any).teamAccess = grant;
  return next();
}

/**
 * Admin-only routes ("Chaves e credenciais"): ONLY the global AUTHENTICATION_API_KEY passes, compared in constant
 * time. Any other key gets 403, a valid instance token included, and the instance tokens are never even looked up
 * (no oracle telling a valid token from an invalid one). No key at all: 401, as in `apikey`.
 */
export function createAdminOnlyGuard(globalKey: () => string | undefined) {
  return function adminOnlyGuard(req: Request, res: Response, next: NextFunction) {
    const key = req.get('apikey');
    const ip = clientIp(req.headers);

    if (key && safeEqual(key, globalKey())) {
      return next();
    }
    if (authThrottle.isBlocked(ip)) {
      return tooManyAttempts(res, ip);
    }
    if (!key) {
      throw new UnauthorizedException();
    }
    // a wrong key here is a guess at the global key (valid instance tokens, client codes and team keys are not
    // wrong keys: the panel of a team member may call an owner page and must not get its IP blocked)
    if (!isClientKey(key) && !isTeamKey(key)) authThrottle.recordFailure(ip);
    throw new ForbiddenException('Apenas o administrador (chave global) tem acesso.');
  };
}

export const adminOnlyGuard = createAdminOnlyGuard(() => configService.get<Auth>('AUTHENTICATION').API_KEY.KEY);

export const authGuard = { apikey, adminOnly: adminOnlyGuard };
