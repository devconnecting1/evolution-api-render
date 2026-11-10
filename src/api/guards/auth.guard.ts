import { InstanceDto } from '@api/dto/instance.dto';
import { cachedInstanceToken } from '@api/guards/instance-token-cache';
import { safeEqual } from '@api/integrations/mcp/mcp.auth';
import { clientAccessService, prismaRepository } from '@api/server.module';
import { Auth, configService, Database } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { ForbiddenException, UnauthorizedException } from '@exceptions';
import { clientRouteAllowed, isClientKey, normalizeClientPath } from '@utils/client-access';
import { NextFunction, Request, Response } from 'express';

const logger = new Logger('GUARD');

async function instanceToken(name: string): Promise<string | undefined> {
  return cachedInstanceToken(
    name,
    async (n) => (await prismaRepository.instance.findUnique({ where: { name: n } }))?.token,
  );
}

async function apikey(req: Request, _: Response, next: NextFunction) {
  const env = configService.get<Auth>('AUTHENTICATION').API_KEY;
  const key = req.get('apikey');
  const db = configService.get<Database>('DATABASE');

  if (!key) {
    throw new UnauthorizedException();
  }

  if (env.KEY === key) {
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
      if ((await instanceToken(param.instanceName)) === key) {
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
 * Admin-only routes ("Chaves e credenciais"): ONLY the global AUTHENTICATION_API_KEY passes, compared in constant
 * time. Any other key gets 403, a valid instance token included, and the instance tokens are never even looked up
 * (no oracle telling a valid token from an invalid one). No key at all: 401, as in `apikey`.
 */
export function createAdminOnlyGuard(globalKey: () => string | undefined) {
  return function adminOnlyGuard(req: Request, _: Response, next: NextFunction) {
    const key = req.get('apikey');

    if (!key) {
      throw new UnauthorizedException();
    }

    if (safeEqual(key, globalKey())) {
      return next();
    }

    throw new ForbiddenException('Apenas o administrador (chave global) tem acesso.');
  };
}

export const adminOnlyGuard = createAdminOnlyGuard(() => configService.get<Auth>('AUTHENTICATION').API_KEY.KEY);

export const authGuard = { apikey, adminOnly: adminOnlyGuard };
