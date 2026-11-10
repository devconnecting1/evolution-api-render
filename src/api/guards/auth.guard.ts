import { InstanceDto } from '@api/dto/instance.dto';
import { cachedInstanceToken } from '@api/guards/instance-token-cache';
import { safeEqual } from '@api/integrations/mcp/mcp.auth';
import { prismaRepository } from '@api/server.module';
import { Auth, configService, Database } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { ForbiddenException, UnauthorizedException } from '@exceptions';
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
