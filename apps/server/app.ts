import { App } from "fresh";
import type { State } from "./utils.ts";
import { ControlPlane } from "./src/services/control_plane.ts";
import { ApiError } from "./src/services/errors.ts";
import { apiRoutes } from "./routes/api/routes.ts";
import { realtimeRoutes } from "./routes/ws/routes.ts";
export function createApp(
  service: ControlPlane,
  origins = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
  ],
): App<State> {
  const app = new App<State>();
  app.use(async (ctx) => {
    try {
      const path = new URL(ctx.req.url).pathname;
      const origin = ctx.req.headers.get("origin");
      if (origin && !origins.includes(origin)) {
        throw new ApiError(403, "Origin not allowed");
      }
      const cors = {
        ...(origin
          ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" }
          : {}),
        "Access-Control-Allow-Headers":
          "Authorization, Content-Type, Idempotency-Key",
        "Access-Control-Allow-Methods":
          "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      };
      if (ctx.req.method === "OPTIONS") {
        return new Response(null, { headers: cors });
      }
      if (
        path.startsWith("/api/") && path !== "/api/auth/dev-login" ||
        path === "/debug"
      ) {
        const authorization = ctx.req.headers.get("authorization") ?? "";
        if (!authorization.startsWith("Bearer ")) {
          throw new ApiError(401, "Unauthorized");
        }
        ctx.state.principal = await service.auth.authenticate(
          authorization.slice(7),
          "client",
        );
      }
      const response = await ctx.next();
      if (response.status !== 101) {
        for (const [key, value] of Object.entries(cors)) {
          response.headers.set(key, value);
        }
        response.headers.set("Cache-Control", "no-store");
        response.headers.set("X-Content-Type-Options", "nosniff");
      }
      return response;
    } catch (error) {
      const status = error instanceof ApiError
        ? error.status
        : error instanceof SyntaxError ||
            error instanceof Error && !("code" in error)
        ? 400
        : 500;
      return Response.json({
        error: status === 500
          ? "Internal server error"
          : error instanceof Error
          ? error.message
          : "Request failed",
      }, { status });
    }
  });
  app.get(
    "/",
    () =>
      Response.json({
        service: "PM.ai control plane",
        api: "/api",
        health: "/health",
      }),
  );
  app.get("/health", async () => {
    await service.db.query("SELECT 1");
    return Response.json({ ok: true });
  });
  app.get("/debug", async (ctx) => {
    const snapshot = await service.snapshots.read(ctx.state.principal!.userId);
    const commands = await service.commands(ctx.state.principal!.userId);
    return Response.json({
      devices: snapshot.devices,
      executions: snapshot.executions.length,
      pendingCommands: commands.filter((c) =>
        !["completed", "failed"].includes(c.status)
      ).length,
    });
  });
  apiRoutes(app, service);
  realtimeRoutes(app, service);
  return app;
}
