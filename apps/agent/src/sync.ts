import { type AgentEvent, object } from "../../../packages/protocol/main.ts";
import type { ProviderProfile } from "../../../packages/core/main.ts";
import { Agent } from "./agent.ts";
export const backoff = (attempt: number, random = Math.random) =>
  Math.min(60000, 1000 * 2 ** Math.min(attempt, 6)) * (0.75 + random() * 0.25);
export class ServerSync {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private stopped = false;
  private attempt = 0;
  private lastSeen = 0;
  private authorized = false;
  private listener = () => this.flush();
  constructor(
    private agent: Agent,
    private url: string,
    private token: string,
    private connect: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {
    if (new URL(url).protocol !== "wss:") {
      throw new Error("Server connection requires WSS");
    }
  }
  start() {
    this.agent.listeners.add(this.listener);
    this.open();
  }
  private send(value: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(value));
    }
  }
  private open() {
    if (this.stopped) return;
    this.authorized = false;
    try {
      this.socket = this.connect(this.url);
    } catch {
      this.schedule();
      return;
    }
    const socket = this.socket;
    socket.onopen = () => {
      this.lastSeen = Date.now();
      this.send({
        type: "hello",
        version: 1,
        token: this.token,
        device: this.agent.store.device,
      });
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastSeen > 45000) socket.close();
        else this.send({ type: "heartbeat", at: new Date().toISOString() });
      }, 15000);
    };
    socket.onmessage = (event) => {
      void this.receive(event.data).catch(() =>
        socket.close(1008, "Invalid protocol")
      );
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      this.authorized = false;
      clearInterval(this.heartbeat);
      this.schedule();
    };
  }
  private schedule() {
    if (!this.stopped) {
      this.retry = setTimeout(() => this.open(), backoff(this.attempt++));
    }
  }
  private async receive(raw: unknown) {
    if (typeof raw !== "string" || raw.length > 2_000_000) {
      throw new Error("Invalid frame");
    }
    const m = object(JSON.parse(raw));
    this.lastSeen = Date.now();
    if (m.type === "welcome") {
      this.authorized = true;
      this.attempt = 0;
      this.agent.store.put("metadata", "serverSync", {
        connectedAt: new Date().toISOString(),
      });
      this.send({
        type: "registration",
        device: this.agent.store.device,
        repositories: this.agent.store.all("repositories"),
        profiles: this.agent.store.all<ProviderProfile>("profiles").map((
          p,
        ) => ({
          id: p.id,
          name: p.name,
          provider: p.provider,
          capabilities: this.agent.provider(p).capabilities,
        })),
      });
      this.flush();
    } else if (!this.authorized) throw new Error("Handshake required");
    else if (m.type === "heartbeat") this.send({ type: "heartbeatAck" });
    else if (m.type === "heartbeatAck") { /* Liveness recorded above. */ }
    else if (m.type === "eventAck" && typeof m.eventId === "string") {
      this.agent.store.remove("outbox", m.eventId);
    } else if (m.type === "command") {
      const command = object(m.command);
      const result = await this.agent.command(command, () => {
        this.send({ type: "ack", commandId: command.commandId });
      });
      this.send({ type: "commandResult", result });
    } else throw new Error("Unknown message");
  }
  flush() {
    if (!this.authorized) return;
    for (const event of this.agent.store.all<AgentEvent>("outbox")) {
      this.send({ type: "event", event });
    }
  }
  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    this.agent.listeners.delete(this.listener);
    this.socket?.close();
  }
}
