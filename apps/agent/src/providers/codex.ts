import { now, type Quota } from "../../../../packages/core/main.ts";
import {
  type CodingAgentProvider,
  type Observation,
  ProviderError,
} from "../../../../packages/provider-types/main.ts";
import { object, string } from "../../../../packages/protocol/main.ts";
import type { Rpc } from "./rpc.ts";
const iso = (v: unknown) =>
  typeof v === "number" ? new Date(v * 1000).toISOString() : now();
export function normalizeThread(value: unknown): Observation {
  const t = object(value);
  const status = object(t.status);
  const turns = Array.isArray(t.turns) ? t.turns : [];
  const turn = turns.length ? object(turns.at(-1)) : undefined;
  let state: Observation["state"] = "unknown";
  if (status.type === "active") {
    state = Array.isArray(status.activeFlags) && status.activeFlags.some((f) =>
        ["waitingOnApproval", "waitingOnUserInput"].includes(f)
      )
      ? "waiting_input"
      : "running";
  } else if (status.type === "systemError") state = "failed";
  else if (turn?.status === "completed") state = "completed";
  else if (turn?.status === "failed") {
    const error = turn.error ? object(turn.error) : undefined;
    state = error?.codexErrorInfo === "usageLimitExceeded"
      ? "waiting_quota"
      : "failed";
  } else if (turn?.status === "interrupted" || status.type === "idle") {
    state = "waiting_input";
  }
  // notLoaded + inProgress is not evidence that another process is still alive.
  const items = turn && Array.isArray(turn.items) ? turn.items : [];
  const message = [...items].reverse().find((i) =>
    object(i).type === "agentMessage"
  );
  return {
    id: string(t.id, "thread id"),
    cwd: string(t.cwd, "cwd"),
    state,
    updatedAt: iso(t.updatedAt),
    startedAt: iso(t.createdAt),
    observedAt: now(),
    availability: "available",
    turnId: typeof turn?.id === "string" ? turn.id : undefined,
    lastMessage: message && typeof object(message).text === "string"
      ? object(message).text as string
      : undefined,
  };
}
export class CodexProvider implements CodingAgentProvider {
  capabilities = {
    sessionDiscovery: true,
    resume: true,
    sendPrompt: true,
    stop: true,
    liveSteering: false,
    quotaInspection: true,
    quotaResetTime: true,
    completionEvents: true,
  };
  constructor(private rpc: Rpc) {}
  async list() {
    const result: Observation[] = [];
    let cursor: string | null = null;
    const cursors = new Set<string>();
    do {
      const page = object(
        await this.rpc.call("thread/list", {
          cursor,
          limit: 100,
          sortKey: "updated_at",
          modelProviders: [],
          sourceKinds: ["cli", "vscode", "exec", "appServer", "unknown"],
        }),
      );
      if (!Array.isArray(page.data)) {
        throw new ProviderError("provider_unavailable");
      }
      result.push(...page.data.map(normalizeThread));
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
      if (cursor && cursors.has(cursor)) {
        throw new ProviderError("provider_unavailable");
      }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return result;
  }
  async inspect(id: string) {
    return normalizeThread(
      object(
        await this.rpc.call("thread/read", {
          threadId: id,
          includeTurns: true,
        }),
      ).thread,
    );
  }
  async prepare(cwd: string, _executionId: string) {
    return normalizeThread(
      object(await this.rpc.call("thread/start", { cwd })).thread,
    );
  }
  async prompt(id: string, prompt: string, commandId: string) {
    const thread = normalizeThread(
      object(await this.rpc.call("thread/resume", { threadId: id })).thread,
    );
    if (thread.state === "running") return thread;
    const result = object(
      await this.rpc.call("turn/start", {
        threadId: id,
        clientUserMessageId: commandId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
      }),
    );
    const turn = object(result.turn);
    return {
      ...thread,
      state: "running" as const,
      turnId: string(turn.id, "turnId"),
      observedAt: now(),
      updatedAt: now(),
    };
  }
  async stop(id: string) {
    const s = await this.inspect(id);
    if (s.state === "running" || s.state === "waiting_input") {
      if (!s.turnId) throw new ProviderError("unsupported");
      await this.rpc.call("turn/interrupt", { threadId: id, turnId: s.turnId });
    }
    return await this.inspect(id);
  }
  async quota(): Promise<Quota> {
    const result = object(await this.rpc.call("account/rateLimits/read", {}));
    if (!result.rateLimits) return { state: "unknown", observedAt: now() };
    const limits = object(result.rateLimits);
    const windows = [limits.primary, limits.secondary].filter((x) =>
      x && typeof object(x).usedPercent === "number"
    ).map(object);
    if (!windows.length) return { state: "unknown", observedAt: now() };
    const exhausted = windows.filter((w) => Number(w.usedPercent) >= 100);
    const resets = exhausted.map((w) => w.resetsAt).filter((v): v is number =>
      typeof v === "number"
    );
    return {
      state: exhausted.length ? "exhausted" : "available",
      usedPercent: Math.max(...windows.map((w) => Number(w.usedPercent))),
      resetsAt: exhausted.length && resets.length === exhausted.length
        ? iso(Math.max(...resets))
        : undefined,
      observedAt: now(),
    };
  }
  subscribe(listener: (s?: Observation) => void) {
    return this.rpc.subscribe((method) => {
      if (
        [
          "thread/started",
          "thread/status/changed",
          "turn/started",
          "turn/completed",
          "account/rateLimits/updated",
        ].includes(method)
      ) listener();
    });
  }
  close() {
    return this.rpc.close();
  }
}
