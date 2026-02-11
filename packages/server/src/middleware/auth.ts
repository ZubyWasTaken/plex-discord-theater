import type { Request, Response, NextFunction } from "express";

/**
 * Placeholder auth middleware.
 * In Phase 2 this would validate Discord session tokens.
 * For now, all API routes are open (the Activity iframe is the trust boundary).
 */
export function requireAuth(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next();
}
