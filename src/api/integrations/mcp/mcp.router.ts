import { Request, Response, Router } from 'express';

import {
  authenticateKey,
  authenticatePathToken,
  clientIp,
  extractKey,
  FailedAuthLimiter,
  pathTokenEnabled,
} from './mcp.auth';
import type { McpAuth, McpDeps } from './mcp.types';

type ServerModule = typeof import('./mcp.server');

let serverModule: ServerModule | null = null;

/**
 * The MCP SDK, zod and the tools are loaded on the first authenticated request, not at startup: an instance that
 * never receives an MCP call pays nothing in boot time or memory.
 */
function loadServerModule(): ServerModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (!serverModule) serverModule = require('./mcp.server') as ServerModule;
  return serverModule;
}

export const rpcError = (code: number, message: string, id: unknown = null) => ({
  jsonrpc: '2.0',
  error: { code, message },
  id: typeof id === 'string' || typeof id === 'number' ? id : null,
});

const requestId = (req: Request) => (req.body && !Array.isArray(req.body) ? req.body.id : null);

const notFound = (req: Request, res: Response) =>
  res.status(404).json({
    status: 404,
    error: 'Not Found',
    response: { message: [`Cannot ${req.method.toUpperCase()} ${req.baseUrl}`] },
  });

const methodNotAllowed = (_req: Request, res: Response) =>
  res
    .status(405)
    .set('Allow', 'POST')
    .json(rpcError(-32000, 'Método não permitido: este servidor MCP é sem sessão (stateless), use POST.'));

/**
 * `POST /mcp` (key in `Authorization: Bearer` or `apikey`) and, only when MCP_PATH_TOKEN has 32+ characters,
 * `POST /mcp/:token` for clients that cannot send headers. GET and DELETE answer 405, as the Streamable HTTP spec
 * allows for a stateless server. Registered before the telemetry middleware, so the token in the URL never leaves.
 */
export function createMcpRouter(getDeps: () => McpDeps, limiter = new FailedAuthLimiter()): Router {
  const router = Router();

  const serve = async (req: Request, res: Response, authenticate: (deps: McpDeps) => Promise<McpAuth | null>) => {
    let deps: McpDeps;
    try {
      deps = getDeps();
    } catch {
      return res.status(503).json(rpcError(-32603, 'Servidor MCP indisponível.', requestId(req)));
    }

    const ip = clientIp(req);
    const retryAfter = limiter.blockedFor(ip);
    if (retryAfter > 0) {
      return res
        .status(429)
        .set('Retry-After', String(retryAfter))
        .json(rpcError(-32000, 'Muitas tentativas de autenticação falharam. Tente mais tarde.', requestId(req)));
    }

    let auth: McpAuth | null = null;
    try {
      auth = await authenticate(deps);
    } catch (error) {
      deps.logger.error(`MCP auth failed to run: ${error?.message ?? error}`);
      return res
        .status(503)
        .json(rpcError(-32603, 'Não foi possível validar a chave agora. Tente de novo.', requestId(req)));
    }

    if (!auth) {
      limiter.fail(ip);
      return res
        .status(401)
        .set('WWW-Authenticate', 'Bearer realm="whatsai-mcp"')
        .json(
          rpcError(
            -32001,
            'Não autorizado: envie a chave no header "Authorization: Bearer <chave>" ou "apikey: <chave>".',
            requestId(req),
          ),
        );
    }

    try {
      await loadServerModule().handleMcpRequest({ auth, deps }, req, res);
    } catch (error) {
      deps.logger.error(`MCP request failed: ${error?.message ?? error}`);
      if (!res.headersSent) res.status(500).json(rpcError(-32603, 'Erro interno do servidor MCP.', requestId(req)));
    }
  };

  router.post('/', (req, res) => serve(req, res, (deps) => authenticateKey(extractKey(req), deps)));
  router.get('/', methodNotAllowed);
  router.delete('/', methodNotAllowed);

  router.all('/:token', (req, res) => {
    let deps: McpDeps;
    try {
      deps = getDeps();
    } catch {
      return notFound(req, res);
    }

    if (!pathTokenEnabled(deps.config.pathToken)) return notFound(req, res);
    if (req.method !== 'POST') return methodNotAllowed(req, res);

    return serve(req, res, async (current) => authenticatePathToken(req.params.token, current));
  });

  return router;
}
