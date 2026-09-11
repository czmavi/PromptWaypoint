import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { createPmaiMcpServer } from "./server.ts";
import type { PmaiMcpContext } from "./context.ts";
import { resolveRepository } from "./resolution.ts";
import type { Repository, ServerSnapshot } from "../core/main.ts";

export const emptySnapshot = (): ServerSnapshot => ({
  devices: [],
  repositories: [],
  profiles: [],
  tasks: [],
  dependencies: [],
  executions: [],
  sessions: [],
});
Deno.test("MCP factory discovers tools/resources and validates schemas without executing on create", async () => {
  const snap = emptySnapshot();
  snap.devices = [{
    id: "device",
    name: "Mac",
    platform: "darwin",
    userId: "private-user",
    online: false,
  }];
  snap.repositories = [{
    id: "repo",
    deviceId: "device",
    name: "Project",
    localPath: "/project",
  }];
  let writes = 0;
  const never = () => {
    throw new Error("Unexpected execution");
  };
  const context: PmaiMcpContext = {
    snapshot: () => Promise.resolve(snap),
    editTask: never,
    dependencies: never,
    action: never,
    createTasks: (input) => {
      writes++;
      const tasks = input.tasks.map((t, i) => ({
        id: `task-${i}`,
        repositoryId: input.repositoryId,
        title: t.title,
        prompt: t.prompt,
        status: t.status ?? "inbox" as const,
        priority: 0,
        position: i,
        autoResume: false,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }));
      snap.tasks.push(...tasks);
      return Promise.resolve({ tasks, references: {} });
    },
  };
  const [local, remote] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(() => createPmaiMcpServer(context), {
    transport: remote,
  });
  const client = new Client({ name: "test", version: "1" });
  try {
    await client.connect(local);
    strictEqual(client.getServerCapabilities()?.tools?.listChanged, false);
    strictEqual(client.getServerCapabilities()?.resources?.subscribe, false);
    const { tools } = await client.listTools();
    strictEqual(tools.length, 14);
    ok(tools.every((t) => t.inputSchema && t.outputSchema));
    ok(
      tools.find((t) => t.name === "pmai_list_tasks")?.annotations
        ?.readOnlyHint,
    );
    ok(
      tools.find((t) => t.name === "pmai_stop_task")?.annotations
        ?.destructiveHint,
    );
    strictEqual((await client.listResources()).resources.length, 2);
    strictEqual(
      (await client.listResourceTemplates()).resourceTemplates.length,
      2,
    );
    const resources = await client.readResource({ uri: "pmai://repositories" });
    ok(JSON.stringify(resources).includes("Project"));
    ok(!JSON.stringify(resources).includes("private-user"));
    const invalid = await client.callTool({
      name: "pmai_create_task",
      arguments: {
        mutationId: crypto.randomUUID(),
        repositoryId: "repo",
        title: "Bad",
        prompt: " ",
      },
    });
    ok(invalid.isError);
    strictEqual(writes, 0);
    const prompt = "First paragraph.\n\n  Preserve spaces.\r\nFinal line.\n";
    const result = await client.callTool({
      name: "pmai_create_task",
      arguments: {
        mutationId: crypto.randomUUID(),
        repositoryId: "repo",
        title: "Good",
        prompt,
      },
    });
    ok(!result.isError);
    strictEqual(writes, 1);
    strictEqual(snap.tasks[0].prompt, prompt);
    strictEqual(snap.tasks[0].status, "inbox");
    const listed = await client.callTool({
      name: "pmai_list_tasks",
      arguments: {},
    });
    ok(!JSON.stringify(listed).includes("Preserve spaces"));
    const full = await client.readResource({ uri: "pmai://task/task-0" });
    ok(JSON.stringify(full).includes("Preserve spaces"));
    const bad = await client.callTool({
      name: "pmai_create_tasks",
      arguments: {
        mutationId: crypto.randomUUID(),
        repositoryId: "repo",
        tasks: Array(51).fill({ title: "x", prompt: "x" }),
      },
    });
    ok(bad.isError);
    strictEqual(writes, 1);
  } finally {
    await client.close();
    await handle.close();
  }
});
Deno.test("repository resolution distinguishes exact, partial and duplicate device names", () => {
  const repos: Repository[] = [
    { id: "a", deviceId: "mac", name: "Datovka", localPath: "/a" },
    { id: "b", deviceId: "pc", name: "SchoolData", localPath: "/b" },
    { id: "c", deviceId: "mac", name: "SchoolData", localPath: "/c" },
  ];
  strictEqual(resolveRepository(repos, [], "datovka").exactMatch?.id, "a");
  strictEqual(resolveRepository(repos, [], "datov").exactMatch, undefined);
  strictEqual(resolveRepository(repos, [], "datov").candidates.length, 1);
  strictEqual(resolveRepository(repos, [], "SchoolData").exactMatch, undefined);
  strictEqual(resolveRepository(repos, [], "SchoolData").candidates.length, 2);
  strictEqual(
    resolveRepository(repos, [], "SchoolData", "pc").exactMatch?.id,
    "b",
  );
  deepStrictEqual(resolveRepository(repos, [], "missing").candidates, []);
});
