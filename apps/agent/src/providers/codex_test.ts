import {
  deepStrictEqual,
  rejects,
  strictEqual as equal,
} from "node:assert/strict";
import { CodexProvider, normalizeThread } from "./codex.ts";
import type { Rpc } from "./rpc.ts";
const thread = (status: unknown = { type: "idle" }, turns: unknown[] = []) => ({
  id: "thread",
  cwd: "/tmp",
  status,
  turns,
  createdAt: 1,
  updatedAt: 2,
});
Deno.test("Codex structured thread normalizes active/input/quota/last message", () => {
  equal(
    normalizeThread(thread({ type: "active", activeFlags: [] })).state,
    "running",
  );
  equal(
    normalizeThread(
      thread({ type: "active", activeFlags: ["waitingOnUserInput"] }),
    ).state,
    "waiting_input",
  );
  const s = normalizeThread(
    thread({ type: "idle" }, [{
      id: "turn",
      status: "failed",
      error: { codexErrorInfo: "usageLimitExceeded" },
      items: [{ type: "agentMessage", text: "Last reply" }],
    }]),
  );
  equal(s.state, "waiting_quota");
  equal(s.lastMessage, "Last reply");
  equal(s.turnId, "turn");
  equal(
    normalizeThread(
      thread({ type: "notLoaded" }, [{ id: "turn", status: "inProgress" }]),
    ).state,
    "unknown",
  );
});
Deno.test("Codex pagination includes App Server sessions and quota checks both windows", async () => {
  const calls: string[] = [];
  const rpc: Rpc = {
    call(method, params) {
      calls.push(method);
      if (method === "thread/list") {
        const p = params as { cursor: string | null; sourceKinds: string[] };
        equal(p.sourceKinds.includes("appServer"), true);
        return Promise.resolve({
          data: [thread()],
          nextCursor: p.cursor ? null : "page2",
        });
      }
      return Promise.resolve({
        rateLimits: {
          primary: { usedPercent: 40, resetsAt: 100 },
          secondary: { usedPercent: 100, resetsAt: 200 },
        },
      });
    },
    subscribe: () => () => {},
    close: () => Promise.resolve(),
  };
  const p = new CodexProvider(rpc);
  equal((await p.list()).length, 2);
  const q = await p.quota();
  equal(q.state, "exhausted");
  equal(q.resetsAt, new Date(200000).toISOString());
  deepStrictEqual(calls, [
    "thread/list",
    "thread/list",
    "account/rateLimits/read",
  ]);
});
Deno.test("Codex resume rechecks active thread before turn/start", async () => {
  let calls = 0;
  const p = new CodexProvider({
    call() {
      calls++;
      return Promise.resolve({
        thread: thread({ type: "active", activeFlags: [] }),
      });
    },
    subscribe: () => () => {},
    close: () => Promise.resolve(),
  });
  equal((await p.prompt("thread", "Continue", "cmd")).state, "running");
  equal(calls, 1);
});
Deno.test("Codex malformed discovery does not mean no sessions", async () => {
  const p = new CodexProvider({
    call: () => Promise.resolve({ data: null }),
    subscribe: () => () => {},
    close: () => Promise.resolve(),
  });
  await rejects(() => p.list());
});
