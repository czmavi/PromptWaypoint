import {
  deepStrictEqual,
  ok,
  rejects,
  strictEqual as equal,
} from "node:assert/strict";
import { Database } from "../src/db/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { ControlPlane } from "../src/services/control_plane.ts";
import { issue } from "../src/auth/auth.ts";
import { createApp } from "../app.ts";
import type {
  Execution,
  ProfileMetadata,
} from "../../../packages/core/main.ts";
import type { TaskInput } from "../../../packages/protocol/main.ts";
import {
  parseAgentFrame,
  parseProfile,
  parseTaskInput,
} from "../../../packages/protocol/main.ts";
import { FakeCodingAgentProvider } from "../../agent/src/providers/fake.ts";
import { Agent } from "../../agent/src/agent.ts";
import { Store } from "../../agent/src/store.ts";
import { ServerSync } from "../../agent/src/sync.ts";
import { ServerClient } from "../../../packages/api-client/main.ts";
const url = Deno.env.get("PMAI_TEST_DATABASE_URL");
const capabilities = {
  sessionDiscovery: true,
  resume: true,
  sendPrompt: true,
  stop: true,
  liveSteering: false,
  quotaInspection: true,
  quotaResetTime: true,
  completionEvents: true,
};
async function fixture() {
  const db = new Database(url!);
  await migrate(db);
  const userId = crypto.randomUUID();
  await db.query("INSERT INTO users(id,name) VALUES($1,'Test user')", [userId]);
  const service = new ControlPlane(db);
  const token = await db.transaction((tx) => issue(tx, userId));
  const registered = await service.registerDevice(userId, {
    id: crypto.randomUUID(),
    name: "Mac",
    platform: "darwin",
  });
  const repositoryId = crypto.randomUUID();
  const profileId = "personal";
  const profile: ProfileMetadata = {
    id: profileId,
    deviceId: registered.device.id,
    name: "Personal",
    provider: "codex",
    capabilities,
  };
  await service.observations.registration(userId, registered.device.id, {
    device: { id: registered.device.id, name: "Mac", platform: "darwin" },
    profiles: [profile],
    repositories: [{
      id: repositoryId,
      deviceId: registered.device.id,
      name: "Same name",
      localPath: "/tmp",
      defaultProviderProfileId: profileId,
    }],
  });
  const input = (id = crypto.randomUUID()): TaskInput => ({
    id,
    repositoryId,
    title: "Task",
    prompt: "Implement task",
    status: "ready",
  });
  return {
    db,
    service,
    userId,
    token,
    device: registered.device,
    deviceToken: registered.token,
    repositoryId,
    profileId,
    input,
    close: async () => {
      await service.close();
      await db.close();
    },
  };
}
function integration(name: string, fn: () => Promise<void>) {
  Deno.test({ name, ignore: !url, fn });
}
Deno.test("shared runtime schemas reject credentials and invalid commands", () => {
  for (
    const v of [null, {}, { type: "anything" }, {
      type: "hello",
      token: "x",
      version: 1,
      device: {},
      authJson: { secret: "no" },
    }]
  ) {
    let failed = false;
    try {
      parseAgentFrame(v);
    } catch {
      failed = true;
    }
    ok(failed);
  }
  let failed = false;
  try {
    parseProfile({
      id: "p",
      name: "Profile",
      provider: "codex",
      configDirectory: "/private/credentials",
    }, "device");
  } catch {
    failed = true;
  }
  ok(failed);
  failed = false;
  try {
    parseTaskInput({
      id: "task",
      repositoryId: "repo",
      title: "Title",
      prompt: "Prompt",
      status: "running",
    });
  } catch {
    failed = true;
  }
  ok(failed);
});
integration(
  "offline device: READY never dispatches; Run persists one immutable command",
  async () => {
    const f = await fixture();
    try {
      const task = await f.service.createTask(f.userId, "create", f.input());
      await f.service.maintenance();
      equal((await f.service.commands(f.userId)).length, 0);
      const result = await f.service.taskAction(f.userId, "run", task.id, {
        action: "run",
      });
      equal(result.task.status, "dispatching");
      equal(result.command?.status, "pending");
      equal(
        (await f.service.snapshots.read(f.userId)).devices[0].online,
        false,
      );
    } finally {
      await f.close();
    }
  },
);
integration(
  "concurrent Run and duplicate mobile requests preserve one execution",
  async () => {
    const f = await fixture();
    try {
      const input = f.input();
      const [a, b] = await Promise.all([
        f.service.createTask(f.userId, "create", input),
        f.service.createTask(f.userId, "create", input),
      ]);
      equal(a.id, b.id);
      const results = await Promise.all(
        Array.from(
          { length: 8 },
          (_, i) =>
            f.service.taskAction(f.userId, `run${i}`, a.id, { action: "run" }),
        ),
      );
      equal(new Set(results.map((r) => r.command?.commandId)).size, 1);
      equal((await f.service.snapshots.read(f.userId)).executions.length, 1);
      await rejects(() =>
        f.service.createTask(f.userId, "create", {
          ...input,
          title: "Other payload",
        })
      );
    } finally {
      await f.close();
    }
  },
);
integration(
  "pending commands and executions survive service/database reconnect",
  async () => {
    let f = await fixture();
    try {
      const task = await f.service.createTask(f.userId, "create", f.input());
      const run = await f.service.taskAction(f.userId, "run", task.id, {
        action: "run",
      });
      const userId = f.userId;
      await f.service.close();
      await f.db.close();
      const db = new Database(url!);
      const service = new ControlPlane(db);
      f = {
        ...f,
        db,
        service,
        close: async () => {
          await service.close();
          await db.close();
        },
      };
      const commands = await service.commands(userId);
      equal(commands[0].commandId, run.command!.commandId);
      equal((await service.snapshots.read(userId)).executions.length, 1);
      equal((await service.snapshots.read(userId)).devices[0].online, false);
    } finally {
      await f.close();
    }
  },
);
integration(
  "multiple devices may have identical repo names/paths and session IDs",
  async () => {
    const f = await fixture();
    try {
      const second = await f.service.registerDevice(f.userId, {
        id: crypto.randomUUID(),
        name: "Office",
        platform: "linux",
      });
      await f.service.observations.registration(f.userId, second.device.id, {
        device: { id: second.device.id, name: "Office", platform: "linux" },
        profiles: [{
          id: f.profileId,
          name: "Personal",
          provider: "codex",
          capabilities,
        }],
        repositories: [{
          id: crypto.randomUUID(),
          deviceId: second.device.id,
          name: "Same name",
          localPath: "/tmp",
          defaultProviderProfileId: f.profileId,
        }],
      });
      for (const deviceId of [f.device.id, second.device.id]) {
        await f.service.observations.event(f.userId, deviceId, {
          id: crypto.randomUUID(),
          deviceId,
          type: "session",
          at: new Date().toISOString(),
          data: {
            id: "same-session",
            providerProfileId: f.profileId,
            provider: "codex",
            cwd: "/tmp",
            state: "running",
            observedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            managed: false,
            origin: "external",
            availability: "available",
          },
        });
      }
      const snapshot = await f.service.snapshots.read(f.userId);
      equal(snapshot.repositories.length, 2);
      equal(snapshot.sessions.length, 2);
      equal(snapshot.profiles.length, 2);
    } finally {
      await f.close();
    }
  },
);
integration(
  "dependencies gate dispatch and cycle updates roll back atomically",
  async () => {
    const f = await fixture();
    try {
      const a = await f.service.createTask(f.userId, "a", f.input());
      const b = await f.service.createTask(f.userId, "b", f.input());
      await f.service.dependencies(f.userId, "dep-b", b.id, [a.id]);
      await rejects(() =>
        f.service.taskAction(f.userId, "blocked", b.id, { action: "run" })
      );
      await rejects(() =>
        f.service.dependencies(f.userId, "cycle", a.id, [b.id])
      );
      deepStrictEqual((await f.service.snapshots.read(f.userId)).dependencies, [
        { taskId: b.id, dependsOnId: a.id },
      ]);
      equal((await f.service.commands(f.userId)).length, 0);
    } finally {
      await f.close();
    }
  },
);
integration(
  "stale session masks running; duplicate and old events cannot regress state",
  async () => {
    const f = await fixture();
    try {
      const at = new Date(Date.now() - 300000).toISOString();
      const event = {
        id: crypto.randomUUID(),
        deviceId: f.device.id,
        type: "session",
        at,
        data: {
          id: "session",
          providerProfileId: f.profileId,
          provider: "codex",
          cwd: "/tmp",
          state: "running",
          observedAt: at,
          updatedAt: at,
          managed: false,
          origin: "external",
          availability: "available",
        },
      };
      await f.service.observations.event(f.userId, f.device.id, event);
      await f.service.observations.event(f.userId, f.device.id, event);
      const sessions = (await f.service.snapshots.read(f.userId)).sessions;
      equal(sessions.length, 1);
      equal(sessions[0].stale, true);
      equal(sessions[0].state, "unknown");
      equal(
        (await f.db.query(
          "SELECT * FROM agent_events WHERE device_id=$1 AND id=$2",
          [f.device.id, event.id],
        )).length,
        1,
      );
    } finally {
      await f.close();
    }
  },
);
integration(
  "transaction failure creates neither execution, command nor mutation receipt",
  async () => {
    const f = await fixture();
    try {
      const task = await f.service.createTask(f.userId, "task", f.input());
      await rejects(() =>
        f.service.mutations.run(f.userId, "atomic", {}, async (tx) => {
          await f.service.tasks.action(tx, f.userId, task.id, {
            action: "run",
          });
          throw new Error("crash before commit");
        })
      );
      equal((await f.service.snapshots.read(f.userId)).executions.length, 0);
      equal((await f.service.commands(f.userId)).length, 0);
      equal(
        (await f.db.query(
          "SELECT * FROM mutation_journal WHERE user_id=$1 AND id='atomic'",
          [f.userId],
        )).length,
        0,
      );
      equal((await f.service.task(f.userId, task.id)).status, "ready");
    } finally {
      await f.close();
    }
  },
);
integration("HTTP tenant isolation, auth and token revocation", async () => {
  const f = await fixture();
  try {
    const other = crypto.randomUUID();
    await f.db.query("INSERT INTO users(id,name) VALUES($1,'Other')", [other]);
    const task = await f.service.createTask(f.userId, "create", f.input());
    await rejects(() => f.service.task(other, task.id));
    await rejects(() => f.service.deviceToken(other, f.device.id));
    await f.service.deviceToken(f.userId, f.device.id, true);
    await rejects(() => f.service.auth.authenticate(f.deviceToken, "device"));
    const handler = createApp(f.service).handler();
    equal(
      (await handler(new Request("http://localhost/api/tasks"))).status,
      401,
    );
    const response = await handler(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${f.token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "bad",
        },
        body: JSON.stringify({ ...f.input(), status: "running" }),
      }),
    );
    equal(response.status, 400);
    await response.body?.cancel();
  } finally {
    await f.close();
  }
});
integration(
  "execution result drives completion and durable push without duplicate notifications",
  async () => {
    const f = await fixture();
    try {
      await f.service.registerPush(f.userId, "push", {
        id: "phone",
        platform: "fcm",
        token: "fixture-token",
      });
      const task = await f.service.createTask(f.userId, "task", f.input());
      const run = await f.service.taskAction(f.userId, "run", task.id, {
        action: "run",
      });
      const old = (await f.service.snapshots.read(f.userId)).executions[0];
      const execution: Execution = {
        ...old,
        state: "completed",
        sessionId: "session",
        completedAt: new Date().toISOString(),
      };
      const event = {
        id: crypto.randomUUID(),
        deviceId: f.device.id,
        type: "execution",
        at: new Date().toISOString(),
        data: execution,
      };
      await f.service.observations.event(f.userId, f.device.id, event);
      await f.service.observations.event(f.userId, f.device.id, event);
      await f.service.observations.commandResult(f.userId, f.device.id, {
        commandId: run.command!.commandId,
        status: "completed",
        execution,
      });
      equal((await f.service.task(f.userId, task.id)).status, "completed");
      equal(
        (await f.db.query("SELECT * FROM push_jobs WHERE user_id=$1", [
          f.userId,
        ])).length,
        1,
      );
      const retried = await f.service.taskAction(f.userId, "retry", task.id, {
        action: "run",
      });
      ok(retried.command!.executionId !== old.id);
      equal((await f.service.snapshots.read(f.userId)).executions.length, 2);
    } finally {
      await f.close();
    }
  },
);
async function eventually(
  check: () => Promise<boolean> | boolean,
  timeout = 5000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Condition timed out");
}
integration(
  "real Agent HTTPS sync: registration, ACK, reconnect, offline queue",
  async () => {
    const f = await fixture();
    const store = new Store(":memory:");
    const fake = new FakeCodingAgentProvider();
    let server: Deno.HttpServer | undefined;
    let sync: ServerSync | undefined;
    const agent = new Agent(store, () => fake);
    try {
      store.device = {
        id: f.device.id,
        name: f.device.name,
        platform: f.device.platform,
      };
      store.put("profiles", f.profileId, {
        id: f.profileId,
        provider: "codex",
        name: "Personal",
        configDirectory: "/tmp",
        autoResume: false,
      });
      store.put("repositories", f.repositoryId, {
        id: f.repositoryId,
        deviceId: f.device.id,
        name: "Same name",
        localPath: "/tmp",
        defaultProviderProfileId: f.profileId,
      });
      const handler = createApp(f.service).handler();
      server = Deno.serve(
        { hostname: "127.0.0.1", port: 0, onListen() {} },
        handler,
      );
      const endpoint = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
      const client = new ServerClient(endpoint, f.token);
      const task = await client.createTask(f.input(), "create");
      await client.action(task.id, { action: "queue" }, "queue");
      equal((await f.service.snapshots.read(f.userId)).executions.length, 0);
      sync = new ServerSync(
        agent,
        "https://test.invalid",
        f.deviceToken,
        (input, init) =>
          fetch(new URL(new URL(String(input)).pathname, endpoint), init),
      );
      sync.start();
      await eventually(() => fake.prompts === 1);
      await eventually(async () =>
        (await f.service.task(f.userId, task.id)).status === "running"
      );
      sync.close();
      await f.db.query(
        "UPDATE devices SET last_seen_at=now()-interval '46 seconds' WHERE id=$1",
        [f.device.id],
      );
      equal(
        (await f.service.snapshots.read(f.userId)).devices[0].online,
        false,
      );
      sync = new ServerSync(
        agent,
        "https://test.invalid",
        f.deviceToken,
        (input, init) =>
          fetch(new URL(new URL(String(input)).pathname, endpoint), init),
      );
      sync.start();
      await eventually(async () =>
        (await f.service.snapshots.read(f.userId)).devices[0].online
      );
      await f.service.maintenance();
      equal(fake.prompts, 1);
      equal((await client.commands()).length, 1);
    } finally {
      sync?.close();
      await agent.close();
      store.close();
      await f.service.close();
      await server?.shutdown();
      await f.db.close();
    }
  },
);
integration("completed Task deletion preserves execution history", async () => {
  const f = await fixture();
  try {
    const task = await f.service.createTask(f.userId, "create", f.input());
    await f.service.taskAction(f.userId, "run", task.id, { action: "run" });
    const execution = (await f.service.snapshots.read(f.userId)).executions[0];
    await f.service.observations.event(f.userId, f.device.id, {
      id: crypto.randomUUID(),
      deviceId: f.device.id,
      type: "execution",
      at: new Date().toISOString(),
      data: { ...execution, state: "completed" },
    });
    await f.service.deleteTask(f.userId, "delete", task.id);
    const snapshot = await f.service.snapshots.read(f.userId);
    equal(snapshot.tasks.length, 0);
    equal(snapshot.executions.length, 1);
    await rejects(() => f.service.task(f.userId, task.id));
  } finally {
    await f.close();
  }
});
integration(
  "invalid event transaction persists neither event receipt nor credential payload",
  async () => {
    const f = await fixture();
    try {
      const eventId = crypto.randomUUID();
      await rejects(() =>
        f.service.observations.event(f.userId, f.device.id, {
          id: eventId,
          deviceId: f.device.id,
          type: "profile",
          at: new Date().toISOString(),
          data: {
            id: "bad",
            name: "Profile",
            provider: "codex",
            credentials: { secret: "forbidden" },
          },
        })
      );
      equal(
        (await f.db.query(
          "SELECT id FROM agent_events WHERE device_id=$1 AND id=$2",
          [f.device.id, eventId],
        )).length,
        0,
      );
      equal((await f.service.snapshots.read(f.userId)).profiles.length, 1);
    } finally {
      await f.close();
    }
  },
);
integration(
  "server ACK and result transitions never regress on duplicate ACK",
  async () => {
    const f = await fixture();
    try {
      const task = await f.service.createTask(f.userId, "task", f.input());
      const run = await f.service.taskAction(f.userId, "run", task.id, {
        action: "run",
      });
      const commandId = run.command!.commandId;
      await f.service.observations.commandResult(f.userId, f.device.id, {
        commandId,
        status: "completed",
      });
      const principal = await f.service.auth.authenticate(
        f.deviceToken,
        "device",
      );
      const sessionId = crypto.randomUUID();
      await f.service.sync.connect(principal, {
        sessionId,
        generation: 1,
        device: { id: f.device.id, name: "Mac", platform: "darwin" },
        profiles: [],
        repositories: [],
      });
      await f.service.sync.exchange(principal, {
        sessionId,
        events: [],
        hasMore: false,
        acknowledged: [commandId],
      });
      equal((await f.service.commands(f.userId))[0].status, "completed");
      equal((await f.service.task(f.userId, task.id)).status, "dispatching");
    } finally {
      await f.close();
    }
  },
);
integration(
  "revision polling is authenticated and sees committed changes",
  async () => {
    const f = await fixture();
    try {
      const handler = createApp(f.service).handler();
      equal(
        (await handler(new Request("http://test/api/revision"))).status,
        401,
      );
      const client = new ServerClient(
        "http://test",
        f.token,
        (input, init) => Promise.resolve(handler(new Request(input, init))),
      );
      const before = await client.revision();
      await f.service.createTask(f.userId, "revision-task", f.input());
      ok((await client.revision()).revision !== before.revision);
      equal((await client.snapshot()).tasks.length, 1);
      await client.logout();
      await rejects(() => client.revision());
    } finally {
      await f.close();
    }
  },
);
integration(
  "offline desktop execution is adopted only after explicit Task sync",
  async () => {
    const f = await fixture();
    try {
      const input = f.input();
      const execution: Execution = {
        id: crypto.randomUUID(),
        taskId: input.id!,
        deviceId: f.device.id,
        repositoryId: f.repositoryId,
        providerProfileId: f.profileId,
        state: "completed",
        dispatchedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        autoResume: false,
      };
      const emit = (data: Execution) =>
        f.service.observations.event(f.userId, f.device.id, {
          id: crypto.randomUUID(),
          deviceId: f.device.id,
          type: "execution",
          at: new Date().toISOString(),
          data,
        });
      await emit(execution);
      equal((await f.service.snapshots.read(f.userId)).tasks.length, 0);
      equal((await f.service.snapshots.read(f.userId)).executions.length, 0);
      await f.service.createTask(f.userId, "desktop-save", input);
      await emit(execution);
      await emit(execution);
      const snapshot = await f.service.snapshots.read(f.userId);
      equal(snapshot.executions.length, 1);
      equal(snapshot.tasks[0].status, "completed");
      await rejects(() =>
        emit({ ...execution, id: crypto.randomUUID(), repositoryId: "foreign" })
      );
    } finally {
      await f.close();
    }
  },
);

integration(
  "two instances share presence, revisions, queue scheduling and fenced sessions",
  async () => {
    const f = await fixture();
    const db2 = new Database(url!);
    let second = new ControlPlane(db2);
    try {
      const p = await f.service.auth.authenticate(f.deviceToken, "device");
      const sessionId = crypto.randomUUID();
      const registration = {
        generation: 1,
        sessionId,
        device: { id: f.device.id, name: "Mac", platform: "darwin" },
        profiles: [],
        repositories: [],
      };
      const exchange = {
        sessionId,
        events: [],
        hasMore: false,
        acknowledged: [],
      };
      await f.service.sync.connect(p, registration);
      const initial = await second.snapshots.revision(f.userId);
      equal((await second.snapshots.read(f.userId)).devices[0].online, true);
      await f.service.sync.exchange(p, exchange);
      // A heartbeat alone must not force a full snapshot download.
      equal(
        (await second.snapshots.revision(f.userId)).revision,
        initial.revision,
      );
      const task = await second.createTask(
        f.userId,
        "cross-instance-task",
        f.input(),
      );
      await second.taskAction(f.userId, "cross-instance-queue", task.id, {
        action: "queue",
      });
      const replies = await Promise.all([
        f.service.sync.exchange(p, exchange),
        second.sync.exchange(p, exchange),
      ]);
      const commands = replies.flatMap((r) => r.commands);
      equal(commands.length, 1);
      equal((await second.snapshots.read(f.userId)).executions.length, 1);
      ok(
        (await f.service.snapshots.revision(f.userId)).revision !==
          initial.revision,
      );
      // Simulate an instance restart and a response lost after the DB commit.
      await second.close();
      second = new ControlPlane(db2);
      await db2.query(
        "UPDATE commands SET delivered_at=now()-interval '31 seconds' WHERE id=$1",
        [commands[0].commandId],
      );
      const replay = await second.sync.exchange(p, exchange);
      deepStrictEqual(replay.commands, commands);
      // Completion replay is deduplicated; the next queue item starts on sync.
      const next = await second.createTask(f.userId, "next-task", f.input());
      await second.taskAction(f.userId, "next-queue", next.id, {
        action: "queue",
      });
      const execution = (await second.snapshots.read(f.userId)).executions[0];
      const event = {
        id: crypto.randomUUID(),
        deviceId: f.device.id,
        type: "execution",
        at: new Date().toISOString(),
        data: { ...execution, state: "completed" },
      };
      await f.service.sync.exchange(p, { ...exchange, events: [event] });
      await second.sync.exchange(p, { ...exchange, events: [event] });
      equal((await second.snapshots.read(f.userId)).executions.length, 2);
      equal(
        (await db2.query(
          "SELECT id FROM agent_events WHERE device_id=$1 AND id=$2",
          [f.device.id, event.id],
        )).length,
        1,
      );
      // Session B replaces A across instances; even A's delayed connect retry fails.
      const newer = {
        ...registration,
        generation: 3,
        sessionId: crypto.randomUUID(),
      };
      await second.sync.connect(p, newer);
      await rejects(
        () =>
          f.service.sync.connect(p, {
            ...registration,
            generation: 2,
            sessionId: crypto.randomUUID(),
          }),
        /superseded/,
      );
      await rejects(() => f.service.sync.exchange(p, exchange), /superseded/);
      await rejects(
        () => f.service.sync.connect(p, registration),
        /superseded/,
      );
      await f.service.sync.connect(p, newer); // lost handshake response is safe to retry
      const beforeOffline = await second.snapshots.revision(f.userId);
      await db2.query(
        "UPDATE devices SET last_seen_at=now()-interval '46 seconds' WHERE id=$1",
        [f.device.id],
      );
      equal(
        (await f.service.snapshots.read(f.userId)).devices[0].online,
        false,
      );
      ok(
        (await second.snapshots.revision(f.userId)).revision !==
          beforeOffline.revision,
      );
      await second.sync.exchange(p, {
        ...exchange,
        sessionId: newer.sessionId,
      });
      await f.service.deviceToken(f.userId, f.device.id, true);
      await rejects(
        () =>
          second.sync.exchange(p, { ...exchange, sessionId: newer.sessionId }),
        /Unauthorized/,
      );
      equal((await second.snapshots.read(f.userId)).devices[0].online, false);
    } finally {
      await second.close();
      await db2.close();
      await f.close();
    }
  },
);

integration(
  "sync batches commit events and ACK atomically and defer dispatch until replay finishes",
  async () => {
    const f = await fixture();
    try {
      const p = await f.service.auth.authenticate(f.deviceToken, "device");
      const sessionId = crypto.randomUUID();
      await f.service.sync.connect(p, {
        generation: 1,
        sessionId,
        device: { id: f.device.id, name: "Mac", platform: "darwin" },
        profiles: [],
        repositories: [],
      });
      const task = await f.service.createTask(
        f.userId,
        "replay-task",
        f.input(),
      );
      await f.service.taskAction(f.userId, "replay-queue", task.id, {
        action: "queue",
      });
      const before = await f.service.snapshots.revision(f.userId);
      const event = {
        id: crypto.randomUUID(),
        deviceId: f.device.id,
        type: "repository",
        at: new Date().toISOString(),
        data: {
          id: f.repositoryId,
          deviceId: f.device.id,
          name: "Updated",
          localPath: "/tmp",
          defaultProviderProfileId: f.profileId,
        },
      };
      const request = {
        sessionId,
        events: [event],
        hasMore: true,
        acknowledged: [],
      };
      await rejects(() =>
        f.service.sync.exchange(p, {
          ...request,
          events: [event, {
            ...event,
            id: crypto.randomUUID(),
            type: "invalid",
          }],
        })
      );
      equal(
        (await f.service.snapshots.revision(f.userId)).revision,
        before.revision,
      );
      equal(
        (await f.db.query(
          "SELECT id FROM agent_events WHERE device_id=$1 AND id=$2",
          [f.device.id, event.id],
        )).length,
        0,
      );
      const response = await f.service.sync.exchange(p, request);
      deepStrictEqual(response.eventIds, [event.id]);
      equal(response.commands.length, 0);
      await f.service.changed(f.userId); // a concurrent client mutation cannot bypass replay
      equal((await f.service.commands(f.userId)).length, 0);
      const final = await f.service.sync.exchange(p, {
        ...request,
        events: [],
        hasMore: false,
      });
      equal(final.commands.length, 1);
      // Device credentials are not accepted by client endpoints, or vice versa.
      const handler = createApp(f.service).handler();
      equal(
        (await handler(
          new Request("http://test/api/revision", {
            headers: { Authorization: `Bearer ${f.deviceToken}` },
          }),
        )).status,
        401,
      );
      equal(
        (await handler(
          new Request("http://test/api/agent/sync", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${f.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
          }),
        )).status,
        401,
      );
    } finally {
      await f.close();
    }
  },
);
