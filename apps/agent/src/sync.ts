import {
  type AgentConnectRequest,
  type AgentEvent,
  type AgentSyncRequest,
  type Command,
  object,
  parseAgentSyncResponse,
} from "../../../packages/protocol/main.ts";
import type { ProviderProfile } from "../../../packages/core/main.ts";
import { Agent } from "./agent.ts";
export const backoff = (attempt: number, random = Math.random) =>
  Math.min(60000, 1000 * 2 ** Math.min(attempt, 6)) * (0.75 + random() * 0.25);

/** Outbound, request-scoped sync; execution never blocks the heartbeat loop. */
export class ServerSync {
  private sessionId = crypto.randomUUID();
  private generation: number;
  private connected = false;
  private stopped = true;
  private busy = false;
  private dirty = false;
  private attempt = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private requestAbort?: AbortController;
  private acknowledged = new Set<string>();
  private executing = new Set<string>();
  private listener = () => this.flush();
  private base: URL;
  constructor(
    private agent: Agent,
    url: string,
    private token: string,
    private transport: typeof fetch = fetch,
  ) {
    this.base = new URL(url);
    // Existing installations can keep their WSS setting during the upgrade.
    if (this.base.protocol === "wss:") this.base.protocol = "https:";
    if (
      this.base.protocol !== "https:" || this.base.username ||
      this.base.password
    ) throw new Error("Server connection requires HTTPS");
    const key = `syncGeneration:${this.base.origin}`;
    this.generation = (this.agent.store.get<number>("metadata", key) ?? 0) + 1;
    if (!Number.isSafeInteger(this.generation)) {
      throw new Error("Invalid sync generation");
    }
    this.agent.store.put("metadata", key, this.generation);
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.agent.listeners.add(this.listener);
    this.flush();
  }
  private schedule(ms: number) {
    if (this.stopped) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      void this.exchange();
    }, ms);
  }
  private async post(path: string, body: unknown) {
    this.requestAbort = new AbortController();
    const timeout = setTimeout(() => this.requestAbort?.abort(), 15000);
    try {
      const response = await this.transport(new URL(path, this.base), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: this.requestAbort.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403, 409].includes(response.status)) {
          console.error(
            `Agent server sync stopped (${response.status}); check pairing and restart the agent`,
          );
          this.close();
        }
        throw new Error(`Agent sync HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
      this.requestAbort = undefined;
    }
  }
  private async exchange() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    this.dirty = false;
    let delay = 4000;
    try {
      if (!this.connected) {
        const request: AgentConnectRequest = {
          generation: this.generation,
          sessionId: this.sessionId,
          device: this.agent.store.device,
          repositories: this.agent.store.all("repositories"),
          profiles: this.agent.store.all<ProviderProfile>("profiles").map(
            (p) => ({
              id: p.id,
              name: p.name,
              provider: p.provider,
              capabilities: this.agent.provider(p).capabilities,
            }),
          ),
        };
        const response = object(await this.post("/api/agent/connect", request));
        if (response.sessionId !== this.sessionId) {
          throw new Error("Invalid connect response");
        }
        if (this.stopped) return;
        this.connected = true;
      }
      const pending = this.agent.store.all<AgentEvent>("outbox");
      const events: AgentEvent[] = [];
      let bytes = 0;
      for (const event of pending) {
        const size = new TextEncoder().encode(JSON.stringify(event)).length;
        if (
          events.length >= 100 || events.length > 0 && bytes + size > 3000000
        ) break;
        events.push(event);
        bytes += size;
      }
      const request: AgentSyncRequest = {
        sessionId: this.sessionId,
        events,
        hasMore: events.length < pending.length,
        acknowledged: [...this.acknowledged].slice(0, 100),
      };
      const response = parseAgentSyncResponse(
        await this.post("/api/agent/sync", request),
      );
      if (this.stopped) return;
      if (
        response.sessionId !== this.sessionId || response.eventIds.some((id) =>
          !events.some((e) => e.id === id)
        ) || response.acknowledged.some((id) =>
          !request.acknowledged.includes(id)
        )
      ) throw new Error("Invalid sync acknowledgement");
      this.agent.store.transaction(() => {
        for (const id of response.eventIds) {
          this.agent.store.remove("outbox", id);
        }
        this.agent.store.put("metadata", "serverSync", {
          connectedAt: new Date().toISOString(),
        });
      });
      for (const id of response.acknowledged) this.acknowledged.delete(id);
      this.attempt = 0;
      delay = response.pollAfterMs;
      for (const command of response.commands) this.execute(command);
      if (request.hasMore || this.acknowledged.size) this.dirty = true;
    } catch {
      delay = backoff(this.attempt++);
      // New local events must not defeat the retry backoff while the server is down.
      this.dirty = false;
    } finally {
      this.busy = false;
      this.schedule(this.dirty ? 0 : delay);
    }
  }
  private execute(command: Command) {
    if (this.stopped || this.executing.has(command.commandId)) return;
    this.executing.add(command.commandId);
    void this.agent.command(command, () => {
      this.acknowledged.add(command.commandId);
      this.flush();
    }).then((result) => {
      if (this.stopped) return;
      // Cached results also need a durable upload when a command is redelivered.
      const queued = this.agent.store.all<AgentEvent>("outbox").some((e) =>
        e.type === "commandResult" &&
        object(e.data).commandId === command.commandId
      );
      if (!queued) this.agent.store.event("commandResult", result);
      this.flush();
    }).catch(() => {
      // The durable command journal resolves interrupted dispatch on recovery.
    }).finally(() => this.executing.delete(command.commandId));
  }
  flush() {
    if (this.stopped) return;
    this.dirty = true;
    if (!this.busy && this.attempt === 0) this.schedule(0);
  }
  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.requestAbort?.abort();
    this.agent.listeners.delete(this.listener);
  }
}
