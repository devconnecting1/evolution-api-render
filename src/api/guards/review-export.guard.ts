import { ForbiddenException } from '@exceptions';
import { NextFunction, Request, Response } from 'express';

/**
 * "Exportar conversas para revisão" leaves with the conversations of the clients: only the administrator takes them.
 * After the apikey guard: the global key, the token of the instance, a person session (owner) and a team key of the
 * "dono" role pass. A client access code (`wac_`) never passes, whatever its modules; another team role neither.
 */
export function reviewExportDenial(req: Request): string | null {
  const anyReq = req as any;
  if (anyReq.clientAccess)
    return 'O código de acesso do cliente não exporta conversas. Peça ao administrador do painel.';
  if (anyReq.teamAccess && anyReq.teamAccess.role !== 'dono') {
    return 'Só o dono do painel exporta as conversas para revisão.';
  }
  return null;
}

export function reviewExportGuard(req: Request, _res: Response, next: NextFunction) {
  const denial = reviewExportDenial(req);
  if (denial) throw new ForbiddenException(denial);
  next();
}
