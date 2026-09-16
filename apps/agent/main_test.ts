import { deepStrictEqual as equal, ok } from "node:assert/strict";
import { Agent, localApi, Store } from "./main.ts";
import { FakeCodingAgentProvider } from "./src/providers/fake.ts";
import {
  type Execution,
  type Session,
  sessionKey,
} from "../../packages/core/main.ts";
import { type Command, parseCommand } from "../../packages/protocol/main.ts";
import { backoff, ServerSync } from "./src/sync.ts";
function fixture(path = ":memory:", fake = new FakeCodingAgentProvider()) {
  const store = new Store(path);
  store.put("profiles", "p", {
    id: "p",
    provider: "codex",
    name: "Personal",
    configDirectory: "/tmp",
    autoResume: true,
  });
  store.put("repositories", "r", {
    id: "r",
    deviceId: store.device.id,
    name: "Repo",
    localPath: "/tmp",
    defaultProviderProfileId: "p",
  });
  const agent = new Agent(store, () => fake);
  const command: Command = {
    commandId: "c",
    executionId: "e",
    action: "run",
    taskId: "t",
    repositoryId: "r",
    prompt: "Do task",
    autoResume: true,
  };
  return {
    store,
    fake,
    agent,
    command,
    close: async () => {
      await agent.close();
      store.close();
    },
  };
}
Deno.test("duplicate command and concurrent double Run dispatch once", async () => {
  const f = fixture();
  try {
    const results = await Promise.all([
      f.agent.command(f.command),
      f.agent.command(f.command),
    ]);
    equal(results[0], results[1]);
    equal(f.fake.prompts, 1);
    equal(f.fake.prepares, 1);
  } finally {
    await f.close();
  }
});
Deno.test("duplicate execution with another command does not dispatch", async () => {
  const f = fixture();
  try {
    await f.agent.command(f.command);
    await f.agent.command({ ...f.command, commandId: "c2" });
    equal(f.fake.prompts, 1);
  } finally {
    await f.close();
  }
});
Deno.test("DISPATCHING persisted before provider process starts", async () => {
  const f = fixture();
  try {
    f.fake.onPrepare = () =>
      equal(f.store.get<Execution>("executions", "e")?.state, "dispatching");
    await f.agent.command(f.command);
  } finally {
    await f.close();
  }
});
Deno.test("crash after prompt reconciles across SQLite restart without replay", async () => {
  const dir = await Deno.makeTempDir();
  const fake = new FakeCodingAgentProvider();
  let f = fixture(`${dir}/state.sqlite`, fake);
  try {
    fake.crashAfterPrompt = true;
    equal((await f.agent.command(f.command)).status, "unknown");
    const device = f.store.device.id;
    await f.close();
    f = fixture(`${dir}/state.sqlite`, fake);
    equal(f.store.device.id, device);
    await f.agent.refresh();
    equal(f.store.get<Execution>("executions", "e")?.state, "running");
    await f.agent.command(f.command);
    equal(fake.prompts, 1);
  } finally {
    await f.close();
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("crash with journal and DISPATCHING but no session never replays", async () => {
  const f = fixture();
  try {
    f.store.put("commands", "c", { command: f.command });
    f.store.put("executions", "e", { id: "e", state: "dispatching" });
    equal((await f.agent.command(f.command)).status, "unknown");
    equal(f.fake.prompts, 0);
  } finally {
    await f.close();
  }
});
Deno.test("external discovery attaches workspace and does not create execution", async () => {
  const f = fixture();
  try {
    f.fake.external("ext", "/tmp/subdir");
    await f.agent.refresh();
    const s = f.store.get<Session>("sessions", sessionKey("p", "ext"))!;
    equal(s.origin, "external");
    equal(s.managed, false);
    equal(s.repositoryId, "r");
    equal(f.store.all("executions").length, 0);
    const inspected = f.fake.inspections;
    await f.agent.refresh();
    equal(f.fake.inspections, inspected);
  } finally {
    await f.close();
  }
});
for (const error of ["timeout", "provider_unavailable"] as const) {
  Deno.test(`${error} retains session and marks observed state unknown`, async () => {
    const f = fixture();
    try {
      f.fake.external("ext");
      await f.agent.refresh();
      f.fake.error = error;
      await f.agent.refresh();
      const s = f.store.get<Session>("sessions", sessionKey("p", "ext"))!;
      equal(s.state, "unknown");
      equal(s.availability, "provider_unavailable");
    } finally {
      await f.close();
    }
  });
}
Deno.test("pre-action refresh corrects WAITING_QUOTA versus active without resume", async () => {
  const f = fixture();
  try {
    await f.agent.command(f.command);
    const e = f.store.get<Execution>("executions", "e")!;
    e.state = "waiting_quota";
    f.store.put("executions", e.id, e);
    await f.agent.command({
      commandId: "resume",
      executionId: "e",
      action: "resume",
    });
    equal(f.fake.prompts, 1);
    equal(f.store.get<Execution>("executions", "e")?.state, "running");
  } finally {
    await f.close();
  }
});
Deno.test("WAITING_QUOTA auto-resumes exactly once after fresh capacity", async () => {
  const f = fixture();
  try {
    await f.agent.command(f.command);
    const e = f.store.get<Execution>("executions", "e")!;
    f.fake.event(e.sessionId!, "waiting_quota");
    f.fake.quotaState.state = "exhausted";
    await f.agent.refresh();
    await f.agent.autoResume();
    equal(f.fake.prompts, 1);
    equal(f.store.get<Execution>("executions", "e")?.state, "waiting_quota");
    f.fake.quotaState.state = "available";
    await f.agent.refresh();
    await Promise.all([f.agent.autoResume(), f.agent.autoResume()]);
    equal(f.fake.prompts, 2);
    equal(f.store.get<Execution>("executions", "e")?.state, "running");
  } finally {
    await f.close();
  }
});
Deno.test("multiple same-provider profiles isolate identical session IDs", async () => {
  const f = fixture();
  const second = new FakeCodingAgentProvider();
  try {
    f.store.put("profiles", "p2", {
      id: "p2",
      provider: "codex",
      name: "Work",
      configDirectory: "/tmp/work",
      autoResume: false,
    });
    f.agent.factory = (p) => p.id === "p" ? f.fake : second;
    f.fake.external("same");
    second.external("same", "/tmp/work");
    await f.agent.refresh();
    equal(f.store.all("sessions").length, 2);
    equal(
      f.store.get<Session>("sessions", sessionKey("p2", "same"))?.cwd,
      "/tmp/work",
    );
  } finally {
    await f.close();
  }
});
Deno.test("local API requires token, blocks foreign origins and works without cloud", async () => {
  const f = fixture();
  try {
    const api = localApi(f.agent, "token");
    equal((await api(new Request("http://127.0.0.1/state"))).status, 401);
    equal(
      (await api(
        new Request("http://127.0.0.1/state", {
          headers: {
            Authorization: "Bearer token",
            Origin: "https://evil.example",
          },
        }),
      )).status,
      403,
    );
    const res = await api(
      new Request("http://127.0.0.1/state", {
        headers: { Authorization: "Bearer token" },
      }),
    );
    equal(res.status, 200);
    equal((await res.json()).repositories.length, 1);
  } finally {
    await f.close();
  }
});
Deno.test("invalid protocol command rejected", () => {
  for (
    const value of [null, {}, {
      action: "run",
      commandId: "c",
      executionId: "e",
    }, { action: "rm", commandId: "c", executionId: "e" }]
  ) {
    let failed = false;
    try {
      parseCommand(value);
    } catch {
      failed = true;
    }
    ok(failed);
  }
});
Deno.test("reconnect backoff bounded and queued events persist across restart", async () => {
  equal(backoff(0, () => 1), 1000);
  equal(backoff(100, () => 1), 60000);
  const dir = await Deno.makeTempDir();
  let store = new Store(`${dir}/db`);
  try {
    const event = store.event("session", { state: "running" });
    store.close();
    store = new Store(`${dir}/db`);
    equal(store.all("outbox"), [event]);
  } finally {
    store.close();
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("HTTPS retries retain event IDs and upload no provider credentials", async () => {
  const f = fixture();
  const event = f.store.event("test", {});
  let attempts = 0;
  const seen: string[] = [];
  const sync = new ServerSync(
    f.agent,
    "https://example.test",
    "secret",
    (_input, init) => {
      const body = JSON.parse(String(init?.body));
      ok(!String(init?.body).includes("configDirectory"));
      if (body.device) {
        return Promise.resolve(
          Response.json({ sessionId: body.sessionId }),
        );
      }
      seen.push(body.events[0].id);
      if (++attempts === 1) return Promise.reject(new Error("lost response"));
      return Promise.resolve(
        Response.json({
          sessionId: body.sessionId,
          eventIds: [event.id],
          acknowledged: [],
          commands: [],
          pollAfterMs: 4000,
        }),
      );
    },
  );
  try {
    sync.start();
    await waitFor(() => f.store.all("outbox").length === 0);
    equal(seen, [event.id, event.id]);
  } finally {
    sync.close();
    await f.close();
  }
});
async function waitFor(check: () => boolean, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Condition timed out");
}
Deno.test("proven pre-submit crash returns task to READY without retry", async () => {
  const f = fixture();
  try {
    f.store.put("commands", "c", { command: f.command, phase: "accepted" });
    f.store.put("executions", "e", { id: "e", state: "dispatching" });
    await f.agent.recover();
    const result = await f.agent.command(f.command);
    equal(result.taskState, "ready");
    equal(f.fake.prompts, 0);
  } finally {
    await f.close();
  }
});
Deno.test("provider failure before prepare returns READY; no phantom running", async () => {
  const f = fixture();
  try {
    f.fake.error = "provider_unavailable";
    const result = await f.agent.command(f.command);
    equal(result.status, "failed");
    equal(result.taskState, "ready");
    equal(f.fake.prompts, 0);
  } finally {
    await f.close();
  }
});
Deno.test("read deadline protects local API from stalled provider", async () => {
  const f = fixture();
  try {
    f.agent.timeoutMs = 5;
    f.fake.list = () => new Promise(() => {});
    await f.agent.refresh();
    equal(
      f.store.get<{ availability: string }>("reconciliation", "p")
        ?.availability,
      "provider_unavailable",
    );
  } finally {
    await f.close();
  }
});
Deno.test("lost HTTP response redelivers a stable command only once", async () => {
  const f = fixture();
  let uploads = 0;
  let lost = false;
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    async (req) => {
      const body = await req.json();
      if (body.device) return Response.json({ sessionId: body.sessionId });
      const results = body.events.filter((e: { type: string }) =>
        e.type === "commandResult"
      );
      if (results.length && !lost) {
        lost = true;
        return new Response("retry", { status: 503 });
      }
      uploads += results.length;
      return Response.json({
        sessionId: body.sessionId,
        eventIds: body.events.map((e: { id: string }) => e.id),
        acknowledged: body.acknowledged,
        commands: [f.command],
        pollAfterMs: 1000,
      });
    },
  );
  const sync = new ServerSync(
    f.agent,
    "https://test.invalid",
    "device-token",
    (input, init) =>
      fetch(
        new URL(
          new URL(String(input)).pathname,
          `http://127.0.0.1:${server.addr.port}`,
        ),
        init,
      ),
  );
  try {
    sync.start();
    await waitFor(() => uploads >= 2);
    equal(f.fake.prompts, 1);
    equal(lost, true);
  } finally {
    sync.close();
    await server.shutdown();
    await f.close();
  }
});
Deno.test("ACK sees durable journal before provider dispatch", async () => {
  const f = fixture();
  try {
    let accepted = false;
    f.fake.onPrepare = () => equal(accepted, true);
    await f.agent.command(f.command, () => {
      ok(f.store.get("commands", f.command.commandId));
      equal(f.fake.prompts, 0);
      accepted = true;
    });
    equal(accepted, true);
  } finally {
    await f.close();
  }
});
Deno.test("profile metadata update excludes config directory from server outbox", async () => {
  const f = fixture();
  try {
    const api = localApi(f.agent, "token");
    const response = await api(
      new Request("http://127.0.0.1/profiles/p", {
        method: "PATCH",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Updated", autoResume: false }),
      }),
    );
    equal(response.status, 200);
    equal((await response.json()).autoResume, false);
    ok(!JSON.stringify(f.store.all("outbox")).includes("configDirectory"));
  } finally {
    await f.close();
  }
});
Deno.test("independent desktop and server executions for the same task cannot double dispatch", async () => {
  const f = fixture();
  try {
    await f.agent.command(f.command);
    const result = await f.agent.command({
      ...f.command,
      commandId: "server-command",
      executionId: "server-execution",
    });
    equal(result.status, "failed");
    equal(f.fake.prompts, 1);
    equal(f.fake.prepares, 1);
  } finally {
    await f.close();
  }
});
Deno.test("refresh republishes terminal executions for offline desktop synchronization", async () => {
  const f = fixture();
  try {
    await f.agent.command(f.command);
    const e = f.store.get<Execution>("executions", "e")!;
    f.store.put("executions", e.id, { ...e, state: "completed" });
    const before =
      f.store.all<{ type: string; data: unknown }>("outbox").length;
    await f.agent.refresh(true);
    ok(
      f.store.all<{ type: string; data: unknown }>("outbox").slice(before).some(
        (event) =>
          event.type === "execution" &&
          (event.data as Execution).state === "completed",
      ),
    );
  } finally {
    await f.close();
  }
});

Deno.test("sync continues and ACKs durably while provider dispatch is stalled", async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => release = resolve);
  const prompt = f.fake.prompt.bind(f.fake);
  f.fake.prompt = async (...args: Parameters<typeof prompt>) => {
    await gate;
    return prompt(...args);
  };
  let polls = 0;
  let acked = false;
  const sync = new ServerSync(
    f.agent,
    "https://test.invalid",
    "device-token",
    (_input, init) => {
      const body = JSON.parse(String(init!.body));
      if (body.device) {
        return Promise.resolve(
          Response.json({ sessionId: body.sessionId }),
        );
      }
      polls++;
      if (body.acknowledged.includes(f.command.commandId)) {
        ok(f.store.get("commands", f.command.commandId));
        acked = true;
      }
      return Promise.resolve(
        Response.json({
          sessionId: body.sessionId,
          eventIds: body.events.map((e: { id: string }) => e.id),
          acknowledged: body.acknowledged,
          commands: [f.command],
          pollAfterMs: 1000,
        }),
      );
    },
  );
  try {
    sync.start();
    await waitFor(() => polls >= 3 && acked);
    equal(f.fake.prompts, 0);
    release();
    await waitFor(() => f.fake.prompts === 1);
  } finally {
    release();
    sync.close();
    await f.close();
  }
});
