import {
  Client,
  StreamableHTTPClientTransport,
} from "npm:@modelcontextprotocol/client@2.0.0";
import { StdioClientTransport } from "npm:@modelcontextprotocol/client@2.0.0/stdio";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import { Database } from "../src/db/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { issue } from "../src/auth/auth.ts";
import { ControlPlane } from "../src/services/control_plane.ts";
import { createApp } from "../app.ts";
import { McpRateLimit } from "../src/mcp/rate_limit.ts";
import { Agent } from "../../agent/src/agent.ts";
import { Store } from "../../agent/src/store.ts";
import { ServerSync } from "../../agent/src/sync.ts";
import { FakeCodingAgentProvider } from "../../agent/src/providers/fake.ts";
import { actionResult, creation } from "../../../packages/mcp/schemas.ts";
const databaseURL = Deno.env.get("PMAI_TEST_DATABASE_URL");
async function until(check: () => Promise<boolean> | boolean) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("MCP execution condition timed out");
}
Deno.test("MCP limiter bounds per-user windows independently", () => {
  let now = 0;
  const limit = new McpRateLimit(2, 100, () => now);
  ok(limit.take("a"));
  ok(limit.take("a"));
  ok(!limit.take("a"));
  ok(limit.take("b"));
  now = 101;
  ok(limit.take("a"));
});
Deno.test({
  name:
    "MCP real Fresh HTTP and stdio: atomic backlog, auth isolation, retries and explicit fake execution",
  ignore: !databaseURL,
  async fn() {
    const db = new Database(databaseURL!);
    await migrate(db);
    const service = new ControlPlane(db);
    const userId = crypto.randomUUID();
    const otherUser = crypto.randomUUID();
    await db.query(
      "INSERT INTO users(id,name) VALUES($1,'MCP A'),($2,'MCP B')",
      [userId, otherUser],
    );
    const token = await db.transaction((tx) => issue(tx, userId));
    const otherToken = await db.transaction((tx) => issue(tx, otherUser));
    const device = await service.registerDevice(userId, {
      id: crypto.randomUUID(),
      name: "MCP Mac",
      platform: "darwin",
    });
    const repositoryId = crypto.randomUUID();
    const fake = new FakeCodingAgentProvider();
    await service.observations.registration(userId, device.device.id, {
      device: {
        id: device.device.id,
        name: device.device.name,
        platform: device.device.platform,
      },
      profiles: [{
        id: "personal",
        deviceId: device.device.id,
        name: "Personal",
        provider: "codex",
        capabilities: fake.capabilities,
      }],
      repositories: [{
        id: repositoryId,
        deviceId: device.device.id,
        name: "MCP Project",
        localPath: "/tmp",
        defaultProviderProfileId: "personal",
      }],
    });
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen() {} },
      createApp(service).handler(),
    );
    const base = `http://127.0.0.1:${server.addr.port}`;
    const client = new Client({ name: "integration", version: "1" }, {
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    });
    const other = new Client({ name: "other", version: "1" });
    const stdio = new Client({ name: "stdio-test", version: "1" }, {
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    });
    const store = new Store(":memory:");
    const agent = new Agent(store, () => fake);
    let sync: ServerSync | undefined;
    try {
      for (
        const headers of [{}, { Authorization: "Bearer invalid" }] as Record<
          string,
          string
        >[]
      ) {
        const response = await fetch(`${base}/mcp`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: "{}",
        });
        strictEqual(response.status, 401);
        ok(response.headers.has("WWW-Authenticate"));
        await response.body?.cancel();
      }
      const forbidden = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          Origin: "https://untrusted.example",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      strictEqual(forbidden.status, 403);
      await forbidden.body?.cancel();
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      await other.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${otherToken}` } },
        }),
      );
      strictEqual((await client.listTools()).tools.length, 14);
      strictEqual((await client.listResources()).resources.length, 2);
      ok(
        !JSON.stringify(
          await other.readResource({ uri: "pmai://repositories" }),
        ).includes(repositoryId),
      );
      const prompt = "First line\n\n  exact indentation\r\nLast line\n";
      const batch = {
        mutationId: crypto.randomUUID(),
        repositoryId,
        tasks: [{ clientId: "schema", title: "Schema", prompt }, {
          clientId: "api",
          title: "API",
          prompt: "Only the API",
          dependsOnClientIds: ["schema"],
        }],
      };
      const call = (name: string, args: Record<string, unknown>) =>
        client.callTool({ name, arguments: args });
      const first = await call("pmai_create_tasks", batch);
      ok(!first.isError, JSON.stringify(first));
      const created = creation.parse(first.structuredContent);
      const retry = await call("pmai_create_tasks", batch);
      deepStrictEqual(retry.structuredContent, first.structuredContent);
      let snap = await service.snapshots.read(userId);
      strictEqual(snap.tasks.length, 2);
      strictEqual(
        snap.tasks.find((t) => t.id === created.references.schema)?.prompt,
        prompt,
      );
      strictEqual(snap.executions.length, 0);
      strictEqual(fake.prompts, 0);
      strictEqual(snap.tasks[0].origin?.type, "mcp");
      ok(snap.dependencies.some((d) =>
        d.taskId === created.references.api &&
        d.dependsOnId === created.references.schema
      ));
      ok(
        snap.tasks.find((t) => t.id === created.references.schema)!.position <
          snap.tasks.find((t) => t.id === created.references.api)!.position,
      );
      for (
        const tasks of [
          [{
            clientId: "a",
            title: "A",
            prompt: "a",
            dependsOnClientIds: ["b"],
          }, {
            clientId: "b",
            title: "B",
            prompt: "b",
            dependsOnClientIds: ["a"],
          }],
          [{ title: "Valid first", prompt: "a" }, {
            title: "Invalid profile second",
            prompt: "b",
            providerProfileId: "missing",
          }],
          [{
            title: "Dependency missing",
            prompt: "a",
            dependsOn: ["missing"],
          }],
          [{ clientId: "duplicate", title: "A", prompt: "a" }, {
            clientId: "duplicate",
            title: "B",
            prompt: "b",
          }],
        ]
      ) {
        const result = await call("pmai_create_tasks", {
          mutationId: crypto.randomUUID(),
          repositoryId,
          tasks,
        });
        ok(result.isError);
        strictEqual(
          (await service.snapshots.read(userId)).tasks.length,
          2,
          "batch rollback",
        );
      }
      ok(
        (await call("pmai_create_task", {
          mutationId: crypto.randomUUID(),
          repositoryId: "missing",
          title: "X",
          prompt: "x",
        })).isError,
      );
      ok(
        (await other.callTool({
          name: "pmai_create_task",
          arguments: {
            mutationId: crypto.randomUUID(),
            repositoryId,
            title: "X",
            prompt: "x",
          },
        })).isError,
      );
      ok(
        (await other.callTool({
          name: "pmai_get_task",
          arguments: { taskId: created.references.schema },
        })).isError,
      );
      ok(
        (await other.callTool({
          name: "pmai_run_task",
          arguments: {
            mutationId: crypto.randomUUID(),
            taskId: created.references.schema,
          },
        })).isError,
      );
      await rejects(
        other.readResource({ uri: `pmai://task/${created.references.schema}` }),
      );
      ok(
        (await call("pmai_create_tasks", {
          ...batch,
          tasks: [{ title: "Different request", prompt: "x" }],
        })).isError,
        "key cannot be reused for changed payload",
      );
      ok(
        (await call("pmai_create_task", {
          mutationId: crypto.randomUUID(),
          repositoryId,
          title: "Router",
          prompt: "x",
          executionMode: "recommend",
        })).isError,
      );
      const otherRepositoryId = crypto.randomUUID();
      await db.transaction((tx) =>
        service.catalog.repository(tx, userId, device.device.id, {
          id: otherRepositoryId,
          deviceId: device.device.id,
          name: "Other project",
          localPath: "/other",
        })
      );
      const crossRepository = await call("pmai_create_task", {
        mutationId: crypto.randomUUID(),
        repositoryId: otherRepositoryId,
        title: "Cross repository",
        prompt: "x",
        dependsOn: [created.references.schema],
      });
      ok(crossRepository.isError);
      strictEqual((await service.snapshots.read(userId)).tasks.length, 2);
      const oversized = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ padding: "x".repeat(1000000) }),
      });
      strictEqual(oversized.status, 413);
      await oversized.body?.cancel();
      const changed = await call("pmai_update_task", {
        mutationId: crypto.randomUUID(),
        taskId: created.references.schema,
        status: "ready",
        priority: 5,
      });
      ok(!changed.isError);
      const queued = actionResult.parse(
        (await call("pmai_queue_task", {
          mutationId: crypto.randomUUID(),
          taskId: created.references.api,
        })).structuredContent,
      );
      strictEqual(queued.status, "queued");
      strictEqual(queued.deviceOnline, false);
      const runArgs = {
        mutationId: crypto.randomUUID(),
        taskId: created.references.schema,
      };
      const run = await call("pmai_run_task", runArgs);
      ok(!run.isError, JSON.stringify(run));
      const runResult = actionResult.parse(run.structuredContent);
      ok(runResult.commandId);
      strictEqual(runResult.deviceOnline, false);
      deepStrictEqual(
        (await call("pmai_run_task", runArgs)).structuredContent,
        run.structuredContent,
      );
      await call("pmai_run_task", {
        ...runArgs,
        mutationId: crypto.randomUUID(),
      });
      strictEqual((await service.snapshots.read(userId)).executions.length, 1);
      ok(
        (await call("pmai_update_task", {
          mutationId: crypto.randomUUID(),
          taskId: created.references.schema,
          title: "Forbidden active edit",
        })).isError,
      );
      store.device = {
        id: device.device.id,
        name: device.device.name,
        platform: "darwin",
      };
      store.put("profiles", "personal", {
        id: "personal",
        provider: "codex",
        name: "Personal",
        configDirectory: "/tmp",
        autoResume: false,
      });
      store.put("repositories", repositoryId, {
        id: repositoryId,
        deviceId: device.device.id,
        name: "MCP Project",
        localPath: "/tmp",
        defaultProviderProfileId: "personal",
      });
      sync = new ServerSync(
        agent,
        "wss://test.invalid",
        device.token,
        () => new WebSocket(`${base.replace("http:", "ws:")}/ws/agent`),
      );
      sync.start();
      await until(() => fake.prompts === 1);
      await until(async () =>
        (await service.task(userId, created.references.schema)).status ===
          "running"
      );
      const sessionId = (await service.snapshots.read(userId)).executions[0]
        .sessionId!;
      fake.event(sessionId, "waiting_input");
      await agent.refresh();
      await until(async () =>
        (await service.task(userId, created.references.schema)).status ===
          "waiting_input"
      );
      const send = await call("pmai_send_prompt", {
        mutationId: crypto.randomUUID(),
        taskId: created.references.schema,
        prompt: "Use the explicit flow.",
      });
      ok(!send.isError, JSON.stringify(send));
      await until(() => fake.prompts === 2);
      fake.event(sessionId, "waiting_input");
      await agent.refresh();
      await until(async () =>
        (await service.task(userId, created.references.schema)).status ===
          "waiting_input"
      );
      const resume = await call("pmai_resume_task", {
        mutationId: crypto.randomUUID(),
        taskId: created.references.schema,
      });
      ok(!resume.isError, JSON.stringify(resume));
      await until(() => fake.prompts === 3);
      const stop = await call("pmai_stop_task", {
        mutationId: crypto.randomUUID(),
        taskId: created.references.schema,
      });
      ok(!stop.isError, JSON.stringify(stop));
      await until(async () =>
        (await service.task(userId, created.references.schema)).status ===
          "waiting_input"
      );
      await stdio.connect(
        new StdioClientTransport({
          command: Deno.execPath(),
          args: [
            "run",
            "--allow-env",
            "--allow-net",
            "--config",
            new URL("../../../deno.json", import.meta.url).pathname,
            new URL("../../mcp/main.ts", import.meta.url).pathname,
          ],
          env: { PMAI_SERVER_URL: base, PMAI_CLIENT_TOKEN: token },
          stderr: "pipe",
        }),
      );
      strictEqual((await stdio.listTools()).tools.length, 14);
      strictEqual((await stdio.listResources()).resources.length, 2);
      const stdioArgs = {
        mutationId: crypto.randomUUID(),
        repositoryId,
        title: "From stdio",
        prompt: "Preserve\n\nthis prompt.",
      };
      const stdioTask = await stdio.callTool({
        name: "pmai_create_task",
        arguments: stdioArgs,
      });
      ok(!stdioTask.isError, JSON.stringify(stdioTask));
      deepStrictEqual(
        (await stdio.callTool({
          name: "pmai_create_task",
          arguments: stdioArgs,
        })).structuredContent,
        stdioTask.structuredContent,
      );
      deepStrictEqual(
        (await call("pmai_create_task", stdioArgs)).structuredContent,
        stdioTask.structuredContent,
        "same mutation survives a different transport/session",
      );
      snap = await service.snapshots.read(userId);
      strictEqual(snap.tasks.length, 3);
      strictEqual(fake.prompts, 3);
      ok(
        JSON.stringify(await stdio.readResource({ uri: "pmai://repositories" }))
          .includes(repositoryId),
      );
      const smoke = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-env",
          "--allow-net",
          "--config",
          new URL("../../../deno.json", import.meta.url).pathname,
          new URL("../../mcp/smoke.ts", import.meta.url).pathname,
        ],
        env: { PMAI_SERVER_URL: base, PMAI_CLIENT_TOKEN: token },
        stdout: "piped",
        stderr: "piped",
      }).output();
      ok(smoke.success, "Read-only smoke command succeeds");
      const smokeOutput = new TextDecoder().decode(smoke.stdout);
      strictEqual(JSON.parse(smokeOutput).ok, true);
      ok(
        !smokeOutput.includes(token) && !smokeOutput.includes(repositoryId),
        "Smoke output omits credentials and account data",
      );
      const response = await fetch(`${base}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await response.body?.cancel();
      const revoked = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      for (let i = 0; i < 120; i++) {
        const limited = await fetch(`${base}/mcp`, {
          headers: { Authorization: `Bearer ${otherToken}` },
        });
        if (i === 119) {
          strictEqual(limited.status, 429);
          strictEqual(limited.headers.get("retry-after"), "60");
        }
        await limited.body?.cancel();
      }
      strictEqual(revoked.status, 401);
      await revoked.body?.cancel();
    } finally {
      await stdio.close();
      await client.close();
      await other.close();
      sync?.close();
      await agent.close();
      store.close();
      await service.close();
      await server.shutdown();
      await db.close();
    }
  },
});
