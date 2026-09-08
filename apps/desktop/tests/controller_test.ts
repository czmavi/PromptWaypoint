import { strict as assert } from "node:assert";
import { draft, fixture } from "./fixture.ts";
import { type CloudApi, DesktopController } from "../src/model/controller.ts";
import type { Session } from "../../../packages/core/main.ts";
Deno.test("desktop create/edit keeps multiline prompt and survives controller restart", async () => {
  const f = fixture();
  await f.controller.refresh();
  const task = await f.controller.save(draft);
  assert.equal(f.controller.tasks[0].prompt, draft.prompt);
  await f.controller.save({
    ...draft,
    id: task.id,
    title: "Revised",
    status: "ready",
  });
  const restored = new DesktopController(f.persistence, f.api);
  assert.equal(restored.tasks[0].title, "Revised");
  assert.equal(restored.tasks[0].status, "ready");
  assert.equal(restored.tasks.length, 1);
});
Deno.test("Run double click submits one command and one execution", async () => {
  const f = fixture();
  await f.controller.refresh();
  const task = await f.controller.save(draft);
  let release!: () => void;
  f.delay(new Promise<void>((resolve) => release = resolve));
  const first = f.controller.action(task.id, "run");
  const second = f.controller.action(task.id, "run");
  release();
  await Promise.all([first, second]);
  assert.equal(f.commands.length, 1);
  assert.equal(f.controller.tasks[0].status, "running");
  await assert.rejects(() => f.controller.action(task.id, "run"), /unfinished/);
  assert.equal(f.commands.length, 1);
});
Deno.test("server offline does not block local Run; agent offline keeps tasks readable and editable", async () => {
  const f = fixture();
  f.controller.cloudApi = {
    snapshot: () => Promise.reject(new Error("offline")),
  } as CloudApi;
  await f.controller.refresh();
  const task = await f.controller.save(draft);
  assert.equal(f.controller.serverOnline, false);
  assert.equal(f.controller.agentOnline, true);
  await f.controller.action(task.id, "run");
  assert.equal(f.commands.length, 1);
  f.offline(true);
  await f.controller.refresh();
  assert.equal(f.controller.tasks.length, 1);
  assert.equal(
    f.controller.reason(f.controller.tasks[0], "resume"),
    "Local Agent is offline",
  );
  const offlineDraft = await f.controller.save({
    ...draft,
    title: "Offline idea",
  });
  assert.equal(offlineDraft.title, "Offline idea");
});
Deno.test("profile override and provider unavailable are honored", async () => {
  const f = fixture();
  await f.controller.refresh();
  const task = await f.controller.save({ ...draft, providerProfileId: "work" });
  assert.equal(f.controller.profile(task)?.name, "Claude Work");
  await f.controller.action(task.id, "run");
  assert.equal(f.commands[0].providerProfileId, "work");
  f.state.executions = [];
  Object.assign(f.state.profiles[1], {
    reconciliation: { availability: "provider_unavailable" },
  });
  await f.controller.refresh();
  assert.match(f.controller.reason(task, "run")!, /unavailable/);
});
function waiting(state: Session["state"]): Session {
  return {
    id: "session",
    providerProfileId: "personal",
    provider: "codex",
    cwd: "/tmp/datovka",
    repositoryId: "repo",
    state,
    observedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    managed: false,
    origin: "external",
    availability: "available",
    lastMessage: "Which option should I use?",
  };
}
Deno.test("external WAITING_INPUT session accepts reply without creating a Task", async () => {
  const f = fixture();
  f.state.sessions = [waiting("waiting_input")];
  await f.controller.refresh();
  await f.controller.sessionAction(
    f.controller.sessions[0],
    "sendPrompt",
    "Use the second option",
  );
  assert.equal(f.commands[0].prompt, "Use the second option");
  assert.equal(f.controller.tasks.length, 0);
  assert.equal(f.commands[0].taskId, undefined);
});
Deno.test("WAITING_QUOTA resume uses observed execution profile and rejects unsupported Stop", async () => {
  const f = fixture();
  await f.controller.refresh();
  const t = await f.controller.save({ ...draft, providerProfileId: "work" });
  await f.controller.action(t.id, "run");
  f.state.executions[0].state = "waiting_quota";
  f.state.sessions = [{
    ...waiting("waiting_quota"),
    providerProfileId: "work",
    provider: "claude",
  }];
  await f.controller.refresh();
  assert.match(
    f.controller.reason(f.controller.tasks[0], "stop")!,
    /does not support/,
  );
  assert.equal(f.controller.reason(f.controller.tasks[0], "resume"), undefined);
  await f.controller.action(t.id, "resume");
  assert.equal(f.commands[1].providerProfileId, "work");
});
Deno.test("unknown session disables follow-up and running session prevents duplicate resume", async () => {
  const f = fixture();
  f.state.sessions = [waiting("unknown")];
  await f.controller.refresh();
  await assert.rejects(
    () => f.controller.sessionAction(f.controller.sessions[0], "resume"),
    /Refresh/,
  );
  f.state.sessions = [waiting("running")];
  await f.controller.refresh();
  await assert.rejects(
    () => f.controller.sessionAction(f.controller.sessions[0], "resume"),
    /already running/,
  );
  assert.equal(f.commands.length, 0);
});
Deno.test("queue waits for dependencies, then dispatches once; keyboard reorder persists", async () => {
  const f = fixture();
  await f.controller.refresh();
  const a = await f.controller.save(draft);
  const b = await f.controller.save({
    ...draft,
    title: "Follow-up",
    dependencies: [a.id],
  });
  await f.controller.reorder(b.id, -1);
  assert.equal(f.controller.tasks[0].id, b.id);
  await f.controller.action(b.id, "queue");
  await f.controller.dispatchQueued();
  assert.equal(f.commands.length, 0);
  await f.controller.action(a.id, "run");
  f.state.executions[0].state = "completed";
  await f.controller.refresh();
  await f.controller.dispatchQueued();
  assert.equal(f.commands.length, 2);
  await f.controller.dispatchQueued();
  assert.equal(f.commands.length, 2);
  await assert.rejects(
    () => f.controller.save({ ...draft, id: a.id, dependencies: [b.id] }),
    /cycle/,
  );
});
Deno.test("uncertain delivery retries the identical durable command", async () => {
  const f = fixture();
  await f.controller.refresh();
  const task = await f.controller.save(draft);
  const original = f.api.command;
  f.api.command = (command) => {
    f.commands.push(command);
    return Promise.reject(new Error("Connection lost"));
  };
  await assert.rejects(() => f.controller.action(task.id, "run"));
  const pending = f.persistence.pending(task.id)!;
  f.api.command = original;
  await f.controller.retryPending(task.id);
  assert.deepEqual(f.commands[1], pending);
  assert.equal(f.persistence.pending(task.id), undefined);
});
Deno.test("cloud draft upload uses task IDs and dependency metadata", async () => {
  const f = fixture();
  const created: string[] = [];
  const deps: string[][] = [];
  f.controller.cloudApi = {
    snapshot: () =>
      Promise.resolve({
        devices: [],
        repositories: f.state.repositories,
        profiles: [],
        tasks: [],
        dependencies: [],
        executions: [],
        sessions: [],
      }),
    createTask: (input: Parameters<CloudApi["createTask"]>[0]) => {
      created.push(input.id!);
      return Promise.resolve(
        {
          ...input,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          position: 0,
        } as never,
      );
    },
    dependencies: (_id: string, ids: string[]) => {
      deps.push(ids);
      return Promise.resolve([]);
    },
  } as unknown as CloudApi;
  await f.controller.refresh();
  const t = await f.controller.save(draft);
  await f.controller.syncDrafts();
  assert.deepEqual(created, [t.id]);
  assert.deepEqual(deps, [[]]);
  assert.equal(f.persistence.all()[0].cloud, "synced");
});
Deno.test("remote Run waits for task sync and never reports an undispatched local command", async () => {
  const f = fixture();
  await f.controller.refresh();
  f.controller.cloud = {
    devices: [
      { id: "remote", name: "DGX", platform: "linux", online: true } as never,
    ],
    repositories: [{
      id: "remote-repo",
      deviceId: "remote",
      name: "Remote",
      localPath: "/tmp",
      defaultProviderProfileId: "personal",
    }],
    profiles: [{
      id: "personal",
      deviceId: "remote",
      name: "Personal",
      provider: "codex",
      capabilities: f.state.profiles[0].capabilities,
    }],
    tasks: [],
    dependencies: [],
    executions: [],
    sessions: [],
  };
  f.controller.cloudApi = {
    snapshot: () => Promise.resolve(f.controller.cloud!),
    createTask: () => Promise.reject(new Error("Sync rejected")),
  } as unknown as CloudApi;
  f.controller.serverOnline = true;
  const task = await f.controller.save({
    ...draft,
    repositoryId: "remote-repo",
  });
  await assert.rejects(
    () => f.controller.action(task.id, "run"),
    /Sync this task/,
  );
  assert.equal(f.commands.length, 0);
  assert.equal(f.persistence.pending(task.id), undefined);
});
