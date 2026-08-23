import { describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { PUBLIC_API_PATHS, requireAuth } from "../requireAuth";

/**
 * Builds an app wired the way registerRoutes wires the real one: the guard
 * mounted ahead of the routes, with a stubbed session state.
 */
function buildApp(authenticated: boolean): Express {
  const app = express();

  app.use((req, _res, next) => {
    req.isAuthenticated = (() => authenticated) as typeof req.isAuthenticated;
    next();
  });
  app.use(requireAuth);

  app.get("/api/portfolios", (_req, res) => res.json({ ok: true }));
  app.post("/api/data-room/upload", (_req, res) => res.json({ ok: true }));
  app.get("/api/memos/:id/download", (_req, res) => res.json({ ok: true }));
  app.get("/api/user", (_req, res) => res.json({ ok: true }));
  app.post("/api/login", (_req, res) => res.json({ ok: true }));
  app.get("/", (_req, res) => res.send("spa"));
  app.get("/assets/index.js", (_req, res) => res.send("js"));

  return app;
}

describe("requireAuth", () => {
  describe("without a session", () => {
    const app = () => buildApp(false);

    it.each([
      ["get", "/api/portfolios"],
      ["post", "/api/data-room/upload"],
      ["get", "/api/memos/abc/download"],
    ])("rejects %s %s with 401", async (method, path) => {
      const res = await (request(app()) as any)[method](path);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: "Authentication required" });
    });

    it("does not leak the handler's body on a rejected request", async () => {
      const res = await request(app()).get("/api/portfolios");
      expect(res.body.ok).toBeUndefined();
    });

    it.each([...PUBLIC_API_PATHS].filter((p) => p !== "/api/login"))(
      "allows the public endpoint %s",
      async (path) => {
        // Only /api/user has a handler here; the rest 404, which still proves
        // the guard let them through rather than 401-ing.
        const res = await request(app()).get(path);
        expect(res.status).not.toBe(401);
      },
    );

    it("allows POST /api/login", async () => {
      const res = await request(app()).post("/api/login");
      expect(res.status).toBe(200);
    });

    it("ignores a query string when matching the allowlist", async () => {
      const res = await request(app()).get("/api/user?foo=bar");
      expect(res.status).toBe(200);
    });

    it("does not treat a lookalike path as public", async () => {
      const res = await request(app()).get("/api/user/settings");
      expect(res.status).toBe(401);
    });

    it.each(["/", "/assets/index.js"])(
      "leaves the non-API path %s alone",
      async (path) => {
        const res = await request(app()).get(path);
        expect(res.status).toBe(200);
      },
    );
  });

  describe("with a session", () => {
    it.each([
      ["get", "/api/portfolios"],
      ["post", "/api/data-room/upload"],
      ["get", "/api/memos/abc/download"],
    ])("allows %s %s", async (method, path) => {
      const res = await (request(buildApp(true)) as any)[method](path);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });
});
