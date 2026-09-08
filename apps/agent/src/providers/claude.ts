import { now, type Quota } from "../../../../packages/core/main.ts";
import {
  type CodingAgentProvider,
  type Observation,
  ProviderError,
} from "../../../../packages/provider-types/main.ts";
import { object } from "../../../../packages/protocol/main.ts";
export class ClaudeProvider implements CodingAgentProvider {
  capabilities = {
    sessionDiscovery: true,
    resume: true,
    sendPrompt: true,
    stop: true,
    liveSteering: false,
    quotaInspection: false,
    quotaResetTime: false,
    completionEvents: true,
  };
  private sessions = new Map<string, Observation>();
  private processes = new Map<string, Deno.ChildProcess>();
  private readers = new Set<Promise<void>>();
  private listeners = new Set<(s?: Observation) => void>();
  private fresh = new Set<string>();
  constructor(private configDirectory: string, private executable = "claude") {}
  private async discover(id?: string): Promise<Observation[]> {
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--config",
        new URL("../../deno.json", import.meta.url).pathname,
        "--allow-read",
        "--allow-env",
        "--allow-sys=homedir",
        new URL("./claude-discovery.ts", import.meta.url).pathname,
        ...(id ? [id] : []),
      ],
      env: { CLAUDE_CONFIG_DIR: this.configDirectory },
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch { /* Exited */ }
    }, 15000);
    try {
      const output = await child.output();
      if (!output.success) throw new ProviderError("provider_unavailable");
      return JSON.parse(new TextDecoder().decode(output.stdout));
    } finally {
      clearTimeout(timer);
    }
  }
  async list() {
    const disk = await this.discover();
    const result = new Map(disk.map((s) => [s.id, s]));
    for (const s of this.sessions.values()) result.set(s.id, s);
    return [...result.values()];
  }
  async inspect(id: string) {
    const own = this.sessions.get(id);
    if (own) return { ...own, observedAt: now() };
    const s = (await this.discover(id))[0];
    if (!s) throw new ProviderError("provider_unavailable");
    return s;
  }
  prepare(cwd: string, _executionId: string) {
    const s: Observation = {
      id: crypto.randomUUID(),
      cwd,
      state: "waiting_input",
      availability: "available",
      observedAt: now(),
      updatedAt: now(),
    };
    this.sessions.set(s.id, s);
    this.fresh.add(s.id);
    return Promise.resolve(s);
  }
  async prompt(id: string, prompt: string, commandId: string) {
    const s = await this.inspect(id);
    if (this.processes.has(id)) return s;
    if (s.state === "unknown") {
      throw new ProviderError(
        "unsupported",
        "External Claude liveness is unknown",
      );
    }
    const isNew = this.fresh.has(id);
    let child: Deno.ChildProcess;
    try {
      child = new Deno.Command(this.executable, {
        args: [
          "-p",
          "--verbose",
          "--output-format",
          "stream-json",
          isNew ? "--session-id" : "--resume",
          id,
        ],
        cwd: s.cwd,
        env: { CLAUDE_CONFIG_DIR: this.configDirectory },
        stdin: "piped",
        stdout: "piped",
        stderr: "null",
      }).spawn();
    } catch {
      throw new ProviderError("provider_unavailable");
    }
    this.fresh.delete(id);
    this.processes.set(id, child);
    const running = {
      ...s,
      state: "running" as const,
      turnId: commandId,
      observedAt: now(),
      updatedAt: now(),
    };
    this.sessions.set(id, running);
    const reader = this.consume(id, child).finally(() =>
      this.readers.delete(reader)
    );
    this.readers.add(reader);
    const writer = child.stdin.getWriter();
    try {
      await writer.write(new TextEncoder().encode(prompt));
      await writer.close();
    } finally {
      writer.releaseLock();
    }
    return running;
  }
  private update(id: string, patch: Partial<Observation>) {
    const s = {
      ...this.sessions.get(id)!,
      ...patch,
      updatedAt: now(),
      observedAt: now(),
    };
    this.sessions.set(id, s);
    for (const listener of this.listeners) listener(s);
  }
  private async consume(id: string, child: Deno.ChildProcess) {
    let resultSeen = false;
    try {
      let buffer = "";
      for await (
        const text of child.stdout.pipeThrough(new TextDecoderStream())
      ) {
        buffer += text;
        if (buffer.length > 16_000_000) throw new Error("Frame too large");
        let i: number;
        while ((i = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, i);
          buffer = buffer.slice(i + 1);
          if (!line.trim()) continue;
          const m = object(JSON.parse(line));
          if (m.type === "assistant" && m.message) {
            const content = object(m.message).content;
            if (Array.isArray(content)) {
              this.update(id, {
                lastMessage: content.filter((c) => c.type === "text").map((c) =>
                  c.text
                ).join("\n"),
              });
            }
          }
          if (m.type === "result") {
            resultSeen = true;
            this.update(id, {
              state: m.is_error
                ? "failed"
                : Array.isArray(m.permission_denials) &&
                    m.permission_denials.length
                ? "waiting_input"
                : "completed",
              lastMessage: typeof m.result === "string"
                ? m.result
                : this.sessions.get(id)?.lastMessage,
            });
          }
        }
      }
      const status = await child.status;
      if (!resultSeen) {
        this.update(id, { state: status.success ? "unknown" : "failed" });
      }
    } catch {
      this.update(id, {
        state: "unknown",
        availability: "provider_unavailable",
      });
    } finally {
      this.processes.delete(id);
    }
  }
  async stop(id: string) {
    const child = this.processes.get(id);
    if (!child) throw new ProviderError("unsupported");
    child.kill("SIGINT");
    await child.status;
    this.update(id, { state: "waiting_input" });
    return this.inspect(id);
  }
  quota(): Promise<Quota> {
    return Promise.resolve({ state: "unsupported", observedAt: now() });
  }
  subscribe(listener: (s?: Observation) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async close() {
    for (const child of this.processes.values()) {
      try {
        child.kill("SIGTERM");
      } catch { /* Exited */ }
    }
    await Promise.all(this.readers);
  }
}
