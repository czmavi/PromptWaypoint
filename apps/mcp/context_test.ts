import { ok, rejects, strictEqual, throws } from "node:assert/strict";
import { readConfig } from "./config.ts";
import { resolveCurrentRepository } from "./local_context.ts";
import { clientMcpContext } from "./context.ts";
import type { ServerSnapshot } from "../../packages/core/main.ts";
const snapshot = (): ServerSnapshot => ({
  devices: [],
  repositories: [{
    id: "repo",
    deviceId: "mac",
    name: "Project",
    localPath: "/work/project",
  }],
  profiles: [],
  tasks: [],
  dependencies: [],
  executions: [],
  sessions: [],
});
Deno.test("local cwd resolution requires exact path and same registered device", async () => {
  const snap = snapshot();
  const local = {
    device: { id: "mac", name: "Mac", platform: "darwin" },
    repositories: snap.repositories,
  };
  strictEqual(
    (await resolveCurrentRepository(
      "/work/./project/",
      () => Promise.resolve(local),
      snap,
    )).repositoryId,
    "repo",
  );
  strictEqual(
    (await resolveCurrentRepository(
      "/work/project/subdir",
      () => Promise.resolve(local),
      snap,
    )).repositoryId,
    undefined,
  );
  strictEqual(
    (await resolveCurrentRepository("/work/project", () =>
      Promise.resolve({
        ...local,
        repositories: [...local.repositories, ...local.repositories],
      }), snap)).repositoryId,
    undefined,
  );
  strictEqual(
    (await resolveCurrentRepository(
      "/work/project",
      () => Promise.reject(new Error("offline")),
      snap,
    )).repositoryId,
    undefined,
  );
  strictEqual(
    (await resolveCurrentRepository(
      "/work/project",
      () =>
        Promise.resolve({ ...local, device: { ...local.device, id: "other" } }),
      snap,
    )).repositoryId,
    undefined,
  );
});
Deno.test("stdio config requires Companion auth, isolates tokens and never follows redirects", async () => {
  throws(() => readConfig(() => undefined));
  throws(() =>
    readConfig((name) =>
      ({
        PMAI_SERVER_URL: "https://example.com",
        PMAI_AGENT_TOKEN: "not-a-client-token",
      })[name as "PMAI_SERVER_URL"]
    )
  );
  throws(() =>
    readConfig((name) =>
      ({
        PMAI_SERVER_URL: "http://remote.example",
        PMAI_CLIENT_TOKEN: "token",
      })[name as "PMAI_SERVER_URL"]
    )
  );
  const seen: string[] = [];
  const transport: typeof fetch = (_input, init) => {
    seen.push(new Headers(init?.headers).get("authorization")!);
    strictEqual(init?.redirect, "error");
    return Promise.resolve(Response.json(snapshot()));
  };
  await clientMcpContext(
    { serverUrl: "https://example.com", clientToken: "one" },
    "/",
    transport,
  ).snapshot();
  await clientMcpContext(
    { serverUrl: "https://example.com", clientToken: "two" },
    "/",
    transport,
  ).snapshot();
  strictEqual(seen.join(","), "Bearer one,Bearer two");
  const context = clientMcpContext(
    { serverUrl: "https://example.com", clientToken: "secret" },
    "/",
    () => Promise.reject(new Error("secret SQL error")),
  );
  await rejects(
    context.snapshot(),
    (error) => error instanceof Error && !error.message.includes("secret"),
  );
  ok(!context.currentRepository);
});
