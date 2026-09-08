import { strict as assert } from "node:assert";
import { capture, fixture } from "./fixture.ts";
import { MobileController } from "../src/model/controller.ts";
import { deepLink, notificationDestination } from "../src/model/navigation.ts";
Deno.test("mobile create/edit preserves multiline prompts and repository profile default", async () => {
  const f = fixture();
  await f.controller.sync();
  const t = f.controller.capture(capture);
  await f.controller.sync();
  assert.equal(f.snapshot.tasks.length, 1);
  assert.equal(f.snapshot.tasks[0].prompt, capture.prompt);
  assert.equal(f.controller.profile(t)?.name, "Codex Personal");
  f.controller.edit(t.id, { title: "Edited", status: "ready" });
  await f.controller.sync();
  assert.equal(f.controller.task(t.id)?.title, "Edited");
  assert.equal(f.controller.task(t.id)?.status, "ready");
});
Deno.test("offline create persists across restart and syncs exactly once after reconnect", async () => {
  const f = fixture();
  await f.controller.sync();
  f.offline(true);
  await f.controller.sync();
  const t = f.controller.capture(capture);
  await f.controller.sync();
  assert.equal(f.snapshot.tasks.length, 0);
  const restored = new MobileController(f.store, f.api);
  assert.equal(restored.task(t.id)?.prompt, capture.prompt);
  assert.equal(restored.data.mutations.length, 1);
  f.offline(false);
  await restored.sync();
  await restored.sync();
  assert.equal(f.snapshot.tasks.length, 1);
  assert.equal(restored.data.mutations.length, 0);
});
Deno.test("lost create receipt retries the same client ID and mutation key", async () => {
  const f = fixture();
  await f.controller.sync();
  f.loseResponse();
  const t = f.controller.capture(capture);
  await f.controller.sync();
  await f.controller.sync();
  assert.equal(f.snapshot.tasks.length, 1);
  assert.equal(f.snapshot.tasks[0].id, t.id);
  const calls = f.calls.filter((c) => c.kind === "create");
  assert.equal(calls[0].key, calls[1].key);
  assert.deepEqual(calls[0].payload, calls[1].payload);
});
Deno.test("Run double tap creates one server action", async () => {
  const f = fixture();
  await f.controller.sync();
  const t = f.controller.capture(capture);
  await f.controller.sync();
  let release!: () => void;
  f.delay(new Promise<void>((resolve) => release = resolve));
  const first = f.controller.action(t.id, "run");
  const second = f.controller.action(t.id, "run");
  release();
  await Promise.all([first, second]);
  assert.equal(f.calls.filter((c) => c.kind === "action").length, 1);
  assert.equal(f.controller.task(t.id)?.status, "running");
});
Deno.test("uncertain Run reconnect retries original idempotency key without a second execution", async () => {
  const f = fixture();
  await f.controller.sync();
  const t = f.controller.capture(capture);
  await f.controller.sync();
  f.loseResponse();
  await assert.rejects(() => f.controller.action(t.id, "run"), /pending/);
  const id = f.controller.data.mutations[0].id;
  assert.equal(f.controller.data.mutations[0].kind, "action");
  await f.controller.sync();
  assert.equal(f.controller.data.mutations.length, 0);
  const actions = f.calls.filter((c) => c.kind === "action");
  assert.deepEqual(actions.map((a) => a.key), [id, id]);
  assert.equal(f.controller.task(t.id)?.status, "running");
});
Deno.test("offline Device allows create/edit/Ready/Queue but not Run", async () => {
  const f = fixture();
  await f.controller.sync();
  const t = f.controller.capture({ ...capture, repositoryId: "remote" });
  await f.controller.sync();
  f.controller.edit(t.id, { status: "ready", title: "Remote idea" });
  await f.controller.sync();
  assert.match(
    f.controller.reason(f.controller.task(t.id)!, "run")!,
    /Device is offline/,
  );
  await assert.rejects(
    () => f.controller.action(t.id, "run"),
    /Device is offline/,
  );
  await f.controller.action(t.id, "queue");
  assert.equal(f.controller.task(t.id)?.status, "queued");
});
async function waiting(state: "waiting_input" | "waiting_quota") {
  const f = fixture();
  await f.controller.sync();
  const t = f.controller.capture(capture);
  await f.controller.sync();
  f.snapshot.tasks[0].status = state;
  f.snapshot.executions = [{
    id: "exec",
    taskId: t.id,
    deviceId: "mac",
    repositoryId: "repo",
    providerProfileId: "personal",
    sessionId: "session",
    state,
    dispatchedAt: new Date().toISOString(),
    autoResume: true,
  }];
  f.snapshot.sessions = [{
    id: "session",
    deviceId: "mac",
    providerProfileId: "personal",
    provider: "codex",
    cwd: "/tmp",
    state,
    observedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    managed: true,
    origin: "companion",
    availability: "available",
    stale: false,
    taskId: t.id,
    lastMessage: "Which option should I use?",
  }];
  await f.controller.sync();
  return { ...f, t };
}
Deno.test("WAITING_INPUT reply double tap sends one exact prompt through Server", async () => {
  const f = await waiting("waiting_input");
  await Promise.all([
    f.controller.action(f.t.id, "sendPrompt", "Use option B\nKeep the API"),
    f.controller.action(f.t.id, "sendPrompt", "Use option B\nKeep the API"),
  ]);
  const actions = f.calls.filter((c) => c.kind === "action");
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].payload, {
    action: "sendPrompt",
    prompt: "Use option B\nKeep the API",
  });
});
Deno.test("WAITING_QUOTA Resume double tap, profile capabilities and stale session guard", async () => {
  const f = await waiting("waiting_quota");
  await Promise.all([
    f.controller.action(f.t.id, "resume"),
    f.controller.action(f.t.id, "resume"),
  ]);
  assert.equal(f.calls.filter((c) => c.kind === "action").length, 1);
  f.snapshot.tasks[0].status = "waiting_quota";
  f.snapshot.profiles[0].capabilities!.stop = false;
  await f.controller.sync();
  assert.match(
    f.controller.reason(f.controller.task(f.t.id)!, "stop")!,
    /does not support/,
  );
  f.snapshot.sessions[0].stale = true;
  await f.controller.sync();
  assert.match(
    f.controller.reason(f.controller.task(f.t.id)!, "resume")!,
    /Refresh first/,
  );
});
Deno.test("several Devices and same profile IDs remain isolated", async () => {
  const f = fixture();
  await f.controller.sync();
  const a = f.controller.capture(capture);
  const b = f.controller.capture({ ...capture, repositoryId: "remote" });
  const c = f.controller.capture({ ...capture, providerProfileId: "work" });
  await f.controller.sync();
  assert.equal(f.controller.profile(a)?.provider, "codex");
  assert.equal(f.controller.profile(b)?.provider, "claude");
  assert.equal(f.controller.profile(c)?.name, "Claude Work");
});
Deno.test("rejected commands remain reviewable and do not retry automatically", async () => {
  const f = fixture();
  await f.controller.sync();
  const t = f.controller.capture(capture);
  await f.controller.sync();
  f.rejectAction();
  await assert.rejects(() => f.controller.action(t.id, "run"), /rejected/);
  const mutation = f.controller.data.mutations[0];
  await f.controller.sync();
  assert.equal(f.calls.filter((c) => c.kind === "action").length, 1);
  f.controller.discard(mutation.id);
  assert.equal(f.controller.data.mutations.length, 0);
});
Deno.test("notification deep-links open Task or scoped Session and reject foreign URLs", () => {
  assert.deepEqual(
    notificationDestination({
      data: { taskId: "task-1", kind: "waiting_input" },
    }),
    { kind: "task", id: "task-1" },
  );
  assert.deepEqual(
    notificationDestination({
      deepLink: "pmai://sessions/session-1",
      deviceId: "mac",
      providerProfileId: "personal",
    }),
    {
      kind: "session",
      id: "session-1",
      deviceId: "mac",
      providerProfileId: "personal",
    },
  );
  assert.equal(deepLink("https://evil.example/tasks/task-1"), undefined);
  assert.equal(deepLink("pmai://tasks/../settings"), undefined);
  assert.equal(deepLink("pmai://tasks/%3Cscript%3E"), undefined);
});
Deno.test("push registration is persisted and retried after internet reconnect", async () => {
  const f = fixture();
  await f.controller.sync();
  f.offline(true);
  await f.controller.registerPush("fcm", "push-token");
  assert.equal(f.controller.data.pushSynced, undefined);
  f.offline(false);
  await f.controller.sync();
  assert.equal(f.controller.data.pushSynced, "push-token");
});
