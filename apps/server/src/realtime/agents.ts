import {
  id,
  parseAgentFrame,
  strict,
  text,
} from "../../../../packages/protocol/main.ts";
import type { AuthProvider, Principal } from "../auth/auth.ts";
import type { Database } from "../db/database.ts";
import type { Observations } from "../services/observations.ts";
import { Dispatcher } from "../commands/dispatcher.ts";
interface Connection {
  socket: WebSocket;
  principal?: Principal;
  token?: string;
  lastSeen: number;
  registered: boolean;
  sent: Map<string, number>;
  tail: Promise<void>;
}
export class AgentConnections {
  private devices = new Map<string, Connection>();
  private connections = new Set<Connection>();
  private dispatcher: Dispatcher;
  constructor(
    private db: Database,
    private auth: AuthProvider,
    private observations: Observations,
    private changed: (userId: string) => void,
  ) {
    this.dispatcher = new Dispatcher(db);
  }
  online(deviceId: string): boolean {
    const c = this.devices.get(deviceId);
    return !!c?.registered && c.socket.readyState === WebSocket.OPEN &&
      Date.now() - c.lastSeen < 45000;
  }
  upgrade(req: Request): Response {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }
    if (this.connections.size >= 256) {
      return new Response("Busy", { status: 503 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    const c: Connection = {
      socket,
      lastSeen: Date.now(),
      registered: false,
      sent: new Map(),
      tail: Promise.resolve(),
    };
    this.connections.add(c);
    const helloDeadline = setTimeout(() => {
      if (!c.principal) socket.close(1008, "Hello required");
    }, 10000);
    socket.onmessage = (event) => {
      c.tail = c.tail.then(() => this.receive(c, event.data)).catch(() => {
        socket.close(1008, "Invalid or unauthorized protocol");
      });
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      clearTimeout(helloDeadline);
      this.connections.delete(c);
      const p = c.principal;
      if (p?.deviceId && this.devices.get(p.deviceId) === c) {
        this.devices.delete(p.deviceId);
        this.changed(p.userId);
      }
    };
    return response;
  }
  private send(c: Connection, value: unknown) {
    if (c.socket.readyState === WebSocket.OPEN) {
      if (c.socket.bufferedAmount > 4000000) {
        c.socket.close(1013, "Slow peer");
        return;
      }
      c.socket.send(JSON.stringify(value));
    }
  }
  private async receive(c: Connection, raw: unknown) {
    if (typeof raw !== "string" || raw.length > 2000000) {
      throw new Error("Invalid frame");
    }
    const frame = parseAgentFrame(JSON.parse(raw));
    if (!c.principal) {
      if (frame.type !== "hello" || frame.version !== 1) {
        throw new Error("Hello required");
      }
      const device = strict(frame.device, ["id", "name", "platform"]);
      const deviceId = id(device.id);
      c.token = text(frame.token, "token", 256);
      const principal = await this.auth.authenticate(c.token, "device");
      if (principal.deviceId !== deviceId) throw new Error("Device mismatch");
      if (c.socket.readyState !== WebSocket.OPEN) return;
      const old = this.devices.get(deviceId);
      old?.socket.close(1000, "Replaced by reconnect");
      c.principal = principal;
      this.devices.set(deviceId, c);
      this.send(c, { type: "welcome", version: 1 });
      return;
    }
    const p = await this.auth.authenticate(c.token!, "device");
    if (this.devices.get(p.deviceId!) !== c) {
      throw new Error("Superseded connection");
    }
    c.lastSeen = Date.now();
    await this.db.query(
      "UPDATE devices SET last_seen_at=now() WHERE id=$1 AND user_id=$2",
      [p.deviceId, p.userId],
    );
    switch (frame.type) {
      case "registration":
        await this.observations.registration(p.userId, p.deviceId!, frame);
        c.registered = true;
        this.changed(p.userId);
        await this.deliver(c);
        break;
      case "heartbeat":
        this.send(c, { type: "heartbeatAck" });
        break;
      case "heartbeatAck":
        break;
      case "ack":
        if (!c.registered) throw new Error("Registration required");
        await this.dispatcher.ack(p.userId, p.deviceId!, id(frame.commandId));
        break;
      case "commandResult":
        if (!c.registered) throw new Error("Registration required");
        await this.observations.commandResult(
          p.userId,
          p.deviceId!,
          frame.result,
        );
        break;
      case "event":
        if (!c.registered) throw new Error("Registration required");
        this.send(c, {
          type: "eventAck",
          eventId: await this.observations.event(
            p.userId,
            p.deviceId!,
            frame.event,
          ),
        });
        break;
      default:
        throw new Error("Unexpected message");
    }
  }
  private async deliver(c: Connection) {
    if (
      !c.registered || !c.principal ||
      this.devices.get(c.principal.deviceId!) !== c
    ) return;
    for (
      const command of await this.dispatcher.pending(
        c.principal.userId,
        c.principal.deviceId!,
      )
    ) {
      if (Date.now() - (c.sent.get(command.commandId) ?? 0) < 30000) continue;
      this.send(c, { type: "command", command });
      c.sent.set(command.commandId, Date.now());
    }
  }
  async flush(userId?: string) {
    for (const c of this.devices.values()) {
      if (userId && c.principal?.userId !== userId) continue;
      if (Date.now() - c.lastSeen > 45000) {
        c.socket.close(1001, "Heartbeat timeout");
        continue;
      }
      try {
        await this.auth.authenticate(c.token!, "device");
        await this.deliver(c);
        this.send(c, { type: "heartbeat" });
      } catch {
        c.socket.close(1008, "Authentication expired");
      }
    }
  }
  revoke(deviceId: string) {
    this.devices.get(deviceId)?.socket.close(1008, "Token revoked");
  }
  async close() {
    for (const c of this.connections) c.socket.close(1001, "Server shutdown");
    await Promise.all([...this.connections].map((c) => c.tail));
    this.devices.clear();
  }
}
