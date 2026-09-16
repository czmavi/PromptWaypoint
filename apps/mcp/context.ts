import {
  LocalAgentClient,
  ServerClient,
} from "../../packages/api-client/main.ts";
import { ServerApiError } from "../../packages/api-client/server.ts";
import {
  type PmaiMcpContext,
  PmaiMcpError,
} from "../../packages/mcp/context.ts";
import type { McpConfig } from "./config.ts";
import { resolveCurrentRepository } from "./local_context.ts";

export function clientMcpContext(
  config: McpConfig,
  cwd: string,
  transport: typeof fetch = fetch,
): PmaiMcpContext {
  // Do not follow redirects with Prompt Waypoint or Local Agent credentials.
  const boundedFetch: typeof fetch = (input, init) =>
    transport(input, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  const client = new ServerClient(
    config.serverUrl,
    config.clientToken,
    boundedFetch,
  );
  const agent = config.agentUrl && config.agentToken
    ? new LocalAgentClient(config.agentUrl, config.agentToken, boundedFetch)
    : undefined;
  async function safe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new PmaiMcpError(
        error instanceof ServerApiError && error.status < 500
          ? error.detail ??
            `Prompt Waypoint API returned ${error.status}. Check access and task state.`
          : "Prompt Waypoint server unavailable. Retry with the same mutationId.",
      );
    }
  }
  return {
    snapshot: () => safe(() => client.snapshot()),
    createTasks: (input, key) => safe(() => client.createTasks(input, key)),
    editTask: (id, input, key) => safe(() => client.editTask(id, input, key)),
    dependencies: (id, dependsOn, key) =>
      safe(() => client.dependencies(id, dependsOn, key)),
    action: (id, input, key) => safe(() => client.action(id, input, key)),
    currentRepository: agent
      ? async () =>
        resolveCurrentRepository(
          cwd,
          () => agent.state(),
          await safe(() => client.snapshot()),
        )
      : undefined,
  };
}
