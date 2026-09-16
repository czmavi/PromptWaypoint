import type { App } from "fresh";
import type { State } from "../utils.ts";
import type { ControlPlane } from "../src/services/control_plane.ts";
import type { Principal } from "../src/auth/auth.ts";
import { ApiError } from "../src/services/errors.ts";
import { createMcpHandler } from "../../../packages/mcp/http.ts";
import { createPmaiMcpServer } from "../../../packages/mcp/server.ts";
import { PmaiMcpError } from "../../../packages/mcp/context.ts";
import { serverMcpContext } from "../src/mcp/context.ts";
import { McpRateLimit } from "../src/mcp/rate_limit.ts";
import { body } from "./api/routes.ts";

/** Replaceable boundary for a future OAuth verifier; tools only receive user-scoped operations. */
export type McpAuthenticator = (request: Request) => Promise<Principal>;
export function mcpRoutes(
  app: App<State>,
  service: ControlPlane,
  authenticate: McpAuthenticator = async (request) => {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
      throw new ApiError(
        401,
        "Unauthorized",
      );
    }
    return await service.auth.authenticate(authorization.slice(7), "client");
  },
) {
  const requests = new McpRateLimit();
  const creates = new McpRateLimit(10);
  const handler = createMcpHandler((ctx) => {
    const userId = ctx.authInfo?.extra?.userId;
    if (typeof userId !== "string") {
      throw new Error("Authenticated context required");
    }
    return createPmaiMcpServer(serverMcpContext(service, userId, () => {
      if (!creates.take(userId)) {
        throw new PmaiMcpError(
          "Task creation rate limit reached. Retry after 60 seconds with the same mutationId.",
        );
      }
    }));
  }, {
    legacy: "stateless",
    responseMode: "auto",
    maxSubscriptions: 0,
    keepAliveMs: 0,
  });
  service.onClose(() => handler.close());
  app.all("/mcp", async (ctx) => {
    let principal: Principal;
    try {
      principal = await authenticate(ctx.req);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      return Response.json({ error: "Unauthorized" }, {
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="Prompt Waypoint MCP"' },
      });
    }
    if (!requests.take(principal.userId)) {
      return Response.json({ error: "MCP request rate limit exceeded" }, {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    }
    // Parse/bound the HTTP body, but leave every MCP protocol decision to the SDK.
    const parsedBody = ctx.req.method === "POST"
      ? await body(ctx.req)
      : undefined;
    return handler.fetch(ctx.req, {
      authInfo: {
        token: "",
        clientId: principal.userId,
        scopes: [],
        extra: { userId: principal.userId },
      },
      ...(parsedBody === undefined ? {} : { parsedBody }),
    });
  });
}
