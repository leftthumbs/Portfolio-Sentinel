import type { NextFunction, Request, Response } from "express";

/**
 * API endpoints that must stay reachable without a session.
 *
 * `/api/user` is on the list deliberately: the client calls it on load to find
 * out whether it has a session at all, and handles the 401 it returns itself.
 */
export const PUBLIC_API_PATHS = new Set([
  "/api/login",
  "/api/logout",
  "/api/register",
  "/api/user",
]);

/**
 * Rejects unauthenticated requests to `/api/*`.
 *
 * Mounted once, ahead of every data route, so a new route is protected by
 * default rather than by remembering to guard it. Non-API paths (the SPA and
 * its assets) pass straight through.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/")) return next();
  if (PUBLIC_API_PATHS.has(req.path)) return next();
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Authentication required" });
}
