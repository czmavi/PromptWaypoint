import type { App } from "fresh";
import type { State } from "../../utils.ts";
import type { ControlPlane } from "../../src/services/control_plane.ts";
import {
  id,
  parseTaskAction,
  parseTaskInput,
  parseTaskPatch,
  strict,
  text,
} from "../../../../packages/protocol/main.ts";
import { ApiError } from "../../src/services/errors.ts";
export async function body(req: Request): Promise<unknown> {
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    throw new ApiError(415, "JSON required");
  }
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, "Body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (
        size >
          (new URL(req.url).pathname.startsWith("/api/agent/")
            ? 4000000
            : 1000000)
      ) {
        await reader.cancel();
        throw new ApiError(413, "Body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
const key = (req: Request) => req.headers.get("idempotency-key") ?? "";
export function apiRoutes(app: App<State>, service: ControlPlane) {
  app.post(
    "/api/agent/connect",
    async (ctx) =>
      Response.json(
        await service.sync.connect(ctx.state.principal!, await body(ctx.req)),
      ),
  );
  app.post(
    "/api/agent/sync",
    async (ctx) =>
      Response.json(
        await service.sync.exchange(ctx.state.principal!, await body(ctx.req)),
      ),
  );
  app.get(
    "/api/revision",
    async (ctx) =>
      Response.json(
        await service.snapshots.revision(ctx.state.principal!.userId),
      ),
  );

  app.post("/api/auth/dev-login", async (ctx) => {
    const v = strict(await body(ctx.req), ["secret"]);
    return Response.json(await service.login(text(v.secret, "secret", 256)));
  });
  app.post("/api/auth/logout", async (ctx) => {
    await service.db.query(
      "UPDATE auth_tokens SET revoked_at=now() WHERE hash=$1",
      [ctx.state.principal!.tokenHash],
    );
    return Response.json({ ok: true });
  });
  app.get(
    "/api/snapshot",
    async (ctx) =>
      Response.json(await service.snapshots.read(ctx.state.principal!.userId)),
  );
  for (
    const collection of [
      "devices",
      "repositories",
      "profiles",
      "tasks",
      "dependencies",
      "executions",
      "sessions",
    ] as const
  ) {
    app.get(`/api/${collection}`, async (ctx) =>
      Response.json(
        (await service.snapshots.read(ctx.state.principal!.userId))[collection],
      ));
  }
  app.post(
    "/api/devices",
    async (ctx) =>
      Response.json(
        await service.registerDevice(
          ctx.state.principal!.userId,
          await body(ctx.req),
        ),
        { status: 201 },
      ),
  );
  app.post(
    "/api/devices/:id/token",
    async (ctx) =>
      Response.json(
        await service.deviceToken(
          ctx.state.principal!.userId,
          id(ctx.params.id),
        ),
      ),
  );
  app.delete(
    "/api/devices/:id/token",
    async (ctx) =>
      Response.json(
        await service.deviceToken(
          ctx.state.principal!.userId,
          id(ctx.params.id),
          true,
        ),
      ),
  );
  app.post(
    "/api/tasks",
    async (ctx) =>
      Response.json(
        await service.createTask(
          ctx.state.principal!.userId,
          key(ctx.req),
          parseTaskInput(await body(ctx.req)),
        ),
        { status: 201 },
      ),
  );
  app.get(
    "/api/tasks/:id",
    async (ctx) =>
      Response.json(
        await service.task(ctx.state.principal!.userId, id(ctx.params.id)),
      ),
  );
  app.post("/api/tasks/batch", async (ctx) =>
    Response.json(
      await service.createTasks(
        ctx.state.principal!.userId,
        key(ctx.req),
        await body(ctx.req),
      ),
      { status: 201 },
    ));
  app.patch(
    "/api/tasks/:id",
    async (ctx) =>
      Response.json(
        await service.editTask(
          ctx.state.principal!.userId,
          key(ctx.req),
          id(ctx.params.id),
          parseTaskPatch(await body(ctx.req)),
        ),
      ),
  );
  app.delete(
    "/api/tasks/:id",
    async (ctx) =>
      Response.json(
        await service.deleteTask(
          ctx.state.principal!.userId,
          key(ctx.req),
          id(ctx.params.id),
        ),
      ),
  );
  app.post(
    "/api/tasks/:id/actions",
    async (ctx) =>
      Response.json(
        await service.taskAction(
          ctx.state.principal!.userId,
          key(ctx.req),
          id(ctx.params.id),
          parseTaskAction(await body(ctx.req)),
        ),
      ),
  );
  app.put("/api/tasks/:id/dependencies", async (ctx) => {
    const v = strict(await body(ctx.req), ["dependsOn"]);
    if (!Array.isArray(v.dependsOn) || v.dependsOn.length > 1000) {
      throw new ApiError(400, "Invalid dependencies");
    }
    return Response.json(
      await service.dependencies(
        ctx.state.principal!.userId,
        key(ctx.req),
        id(ctx.params.id),
        v.dependsOn.map(id),
      ),
    );
  });
  app.get(
    "/api/commands",
    async (ctx) =>
      Response.json(await service.commands(ctx.state.principal!.userId)),
  );
  app.get(
    "/api/push-registrations",
    async (ctx) =>
      Response.json(
        await service.db.query(
          "SELECT id,platform FROM push_devices WHERE user_id=$1",
          [ctx.state.principal!.userId],
        ),
      ),
  );
  app.post(
    "/api/push-registrations",
    async (ctx) =>
      Response.json(
        await service.registerPush(
          ctx.state.principal!.userId,
          key(ctx.req),
          await body(ctx.req),
        ),
      ),
  );
  app.delete(
    "/api/push-registrations/:id",
    async (ctx) =>
      Response.json(
        await service.removePush(
          ctx.state.principal!.userId,
          key(ctx.req),
          id(ctx.params.id),
        ),
      ),
  );
}
