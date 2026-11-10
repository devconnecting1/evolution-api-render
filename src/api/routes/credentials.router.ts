import { RouterBroker } from '@api/abstract/abstract.router';
import { CredentialRevealDto } from '@api/dto/credentials.dto';
import { adminOnlyGuard } from '@api/guards/auth.guard';
import { clientIp, FailedAuthLimiter, safeEqual } from '@api/integrations/mcp/mcp.auth';
import {
  CredentialsDeps,
  listCredentials,
  revealCredential,
  RevealedCredential,
} from '@api/services/credentials.service';
import { credentialRevealSchema } from '@validate/credentials.schema';
import { Request, RequestHandler, Response, Router } from 'express';

/** Reveal requests per IP per minute (successful ones included). */
export const REVEAL_ATTEMPTS_PER_MINUTE = 5;
/** Wrong passwords per IP before the lockout, and how long it lasts. */
export const REVEAL_MAX_FAILURES = 5;
export const REVEAL_LOCKOUT_MS = 15 * 60 * 1000;

export interface AdminCredentialsOptions {
  deps: () => CredentialsDeps;
  /** AUTHENTICATION_API_KEY, the value `confirmPassword` must match. */
  apiKey: () => string | undefined;
  /** Only the global key passes (adminOnlyGuard); the tests hand in one with their own key. */
  guard?: RequestHandler;
  logger: { warn(message: unknown): void; error(message: unknown): void };
  attempts?: FailedAuthLimiter;
  failures?: FailedAuthLimiter;
  now?: () => Date;
}

/** Ids come from the request: only safe characters reach the audit log. */
const logSafe = (value: unknown) =>
  String(value ?? '')
    .replace(/[^A-Za-z0-9_.:-]/g, '?')
    .slice(0, 64);

const errorBody = (status: number, error: string, message: string) => ({
  status,
  error,
  response: { message: [message] },
});

/**
 * GET /admin/credentials: every instance with its secrets masked. POST /admin/credentials/reveal: one full value,
 * once, for the admin who typed the global key again. Both `Cache-Control: no-store`; secrets are never logged.
 */
export class AdminCredentialsRouter extends RouterBroker {
  public readonly router: Router = Router();

  constructor(options: AdminCredentialsOptions) {
    super();

    const guard = options.guard ?? adminOnlyGuard;
    const attempts = options.attempts ?? new FailedAuthLimiter(REVEAL_ATTEMPTS_PER_MINUTE, 60 * 1000);
    const failures = options.failures ?? new FailedAuthLimiter(REVEAL_MAX_FAILURES, REVEAL_LOCKOUT_MS);
    const now = options.now ?? (() => new Date());
    const audit = (line: string) => options.logger.warn(`[audit] ${line}`);

    const noStore = (_req: Request, res: Response, next: () => void) => {
      res.set('Cache-Control', 'no-store');
      res.set('Pragma', 'no-cache');
      next();
    };

    this.router
      .get('/', noStore, guard, async (_req, res) => {
        const overview = await listCredentials(options.deps());
        return res.status(200).json(overview);
      })
      .post(this.routerPath('reveal', false), noStore, guard, async (req, res) => {
        const ip = clientIp(req);

        const blocked = Math.max(failures.blockedFor(ip), attempts.blockedFor(ip));
        if (blocked > 0) {
          res.set('Retry-After', String(blocked));
          audit(`credentials.reveal.blocked ip=${logSafe(ip)} at=${now().toISOString()}`);
          return res
            .status(429)
            .json(errorBody(429, 'Too Many Requests', `Muitas tentativas. Tente de novo em ${blocked} segundo(s).`));
        }
        attempts.fail(ip);

        const result = await this.dataValidate<CredentialRevealDto>({
          request: req,
          schema: credentialRevealSchema,
          ClassRef: CredentialRevealDto,
          execute: async (_instance, data) => {
            if (!safeEqual(data.confirmPassword, options.apiKey())) {
              failures.fail(ip);
              audit(
                `credentials.reveal.denied kind=${logSafe(data.kind)} id=${logSafe(data.id)} ip=${logSafe(ip)} ` +
                  `at=${now().toISOString()} reason=wrong-password`,
              );
              return { denied: true as const };
            }

            const revealed = await revealCredential(options.deps(), data.kind, data.id);
            return { denied: false as const, data, revealed };
          },
        });

        if (result.denied) {
          return res.status(403).json(errorBody(403, 'Forbidden', 'Senha do administrador incorreta.'));
        }

        const { data, revealed } = result as { data: CredentialRevealDto; revealed: RevealedCredential | null };
        if (!revealed) {
          return res.status(404).json(errorBody(404, 'Not Found', 'Credencial não encontrada ou vazia.'));
        }

        audit(
          `credentials.reveal instance=${logSafe(revealed.instance.name)} kind=${logSafe(data.kind)} ` +
            `id=${logSafe(revealed.id)} ip=${logSafe(ip)} at=${now().toISOString()}`,
        );

        return res.status(200).json(revealed);
      });
  }
}
