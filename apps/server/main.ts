import { App } from "fresh";
import type { State } from "./utils.ts";
import { Database } from "./src/db/database.ts";
import { migrate } from "./src/db/migrate.ts";
import { ControlPlane } from "./src/services/control_plane.ts";
import { ApiError } from "./src/services/errors.ts";
import {
  ApnsPushProvider,
  FcmPushProvider,
  type PushProvider,
} from "./src/push/providers.ts";
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
// Programmatic Fresh routes keep this API-only application independent of Vite builds.
if (import.meta.main) {
  const url = Deno.env.get("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL required");
  const db = new Database(url);
  await migrate(db);
  const push: Partial<Record<"apns" | "fcm", PushProvider>> = {};
  const apnsTopic = Deno.env.get("PMAI_APNS_TOPIC"),
    apnsTokenFile = Deno.env.get("PMAI_APNS_TOKEN_FILE"),
    fcmProject = Deno.env.get("PMAI_FCM_PROJECT"),
    fcmTokenFile = Deno.env.get("PMAI_FCM_TOKEN_FILE");
  if (apnsTopic && apnsTokenFile) {
    push.apns = new ApnsPushProvider(
      apnsTopic,
      async () => (await Deno.readTextFile(apnsTokenFile)).trim(),
      Deno.env.get("PMAI_APNS_SANDBOX") === "true",
    );
  }
  if (fcmProject && fcmTokenFile) {
    push.fcm = new FcmPushProvider(
      fcmProject,
      async () => (await Deno.readTextFile(fcmTokenFile)).trim(),
    );
  }
  const service = new ControlPlane(db, {
    devSecret: Deno.env.get("PMAI_DEV_AUTH_SECRET"),
    push,
  });
  const extraOrigins =
    Deno.env.get("PMAI_CORS_ORIGINS")?.split(",").filter(Boolean) ?? [];
  const app = createApp(service, [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    ...extraOrigins,
  ]);
  service.start();
  const server = Deno.serve({
    hostname: Deno.env.get("PMAI_SERVER_HOST") ?? "127.0.0.1",
    port: Number(Deno.env.get("PORT") ?? 8000),
  }, app.handler());
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await service.close();
    await server.shutdown();
    await db.close();
  };
  Deno.addSignalListener("SIGINT", () => {
    void close();
  });
  Deno.addSignalListener("SIGTERM", () => {
    void close();
  });
}
