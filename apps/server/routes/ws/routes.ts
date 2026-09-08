import type { App } from "fresh";
import type { State } from "../../utils.ts";
import type { ControlPlane } from "../../src/services/control_plane.ts";
export function realtimeRoutes(app: App<State>, service: ControlPlane) {
  app.get("/ws/agent", (ctx) => service.agents.upgrade(ctx.req));
  app.get(
    "/api/events",
    (ctx) =>
      service.clients.response(
        ctx.state.principal!.userId,
        ctx.req.signal,
        async () => {
          try {
            await service.auth.authenticate(
              (ctx.req.headers.get("authorization") ?? "").slice(7),
              "client",
            );
            return true;
          } catch {
            return false;
          }
        },
      ),
  );
}
