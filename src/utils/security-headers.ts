import { NextFunction, Request, Response } from 'express';

/**
 * Basic browser protections on every API response (no new dependency). No Content-Security-Policy here: the API
 * also serves the panel (view.router) and the site/panel CSP lives in manager/dist/vercel.json, where it is tested.
 * Cross-Origin-Resource-Policy stays "cross-origin" because the panel on another origin loads media from the API.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'X-Permitted-Cross-Domain-Policies': 'none',
};

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set(SECURITY_HEADERS);
  next();
}
