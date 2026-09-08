import { ProviderError } from "../../../../packages/provider-types/main.ts";
export interface Rpc {
  call(method: string, params: unknown): Promise<unknown>;
  subscribe(listener: (method: string, params: unknown) => void): () => void;
  close(): Promise<void>;
}
export class StdioRpc implements Rpc {
  private child?: Deno.ChildProcess;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private reader?: Promise<void>;
  private ready?: Promise<void>;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private listeners = new Set<(method: string, params: unknown) => void>();
  constructor(
    private executable: string,
    private configDirectory: string,
    private timeout = 15000,
  ) {}
  private initialize() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      try {
        this.child = new Deno.Command(this.executable, {
          args: ["app-server"],
          env: { CODEX_HOME: this.configDirectory },
          stdin: "piped",
          stdout: "piped",
          stderr: "null",
        }).spawn();
        this.writer = this.child.stdin.getWriter();
        this.reader = this.read(this.child.stdout);
        await this.request("initialize", {
          clientInfo: { name: "pmai_local_agent", version: "0.1.0" },
          capabilities: {},
        });
        await this.send({ method: "initialized", params: {} });
      } catch {
        this.ready = undefined;
        throw new ProviderError("provider_unavailable");
      }
    })();
    return this.ready;
  }
  private send(message: unknown) {
    return this.writer!.write(
      new TextEncoder().encode(JSON.stringify(message) + "\n"),
    );
  }
  private request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ProviderError("timeout"));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params }).catch(() => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new ProviderError("provider_unavailable"));
      });
    });
  }
  async call(method: string, params: unknown) {
    await this.initialize();
    return this.request(method, params);
  }
  private async read(stream: ReadableStream<Uint8Array>) {
    try {
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const bytes of stream) {
        const chunk = decoder.decode(bytes, { stream: true });
        buffer += chunk;
        if (buffer.length > 32_000_000) throw new Error("RPC frame too large");
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (!line.trim()) continue;
          const m = JSON.parse(line);
          if (m.method) {
            for (const listener of this.listeners) listener(m.method, m.params);
            // Never automatically approve tool or filesystem requests.
            if (m.id !== undefined) {
              await this.send({
                id: m.id,
                error: {
                  code: -32601,
                  message: "Interactive approval is unsupported by this client",
                },
              });
            }
          } else {
            const pending = this.pending.get(m.id);
            if (pending) {
              clearTimeout(pending.timer);
              this.pending.delete(m.id);
              if (m.error) {
                pending.reject(new ProviderError("provider_unavailable"));
              } else pending.resolve(m.result);
            }
          }
        }
      }
    } catch {
      /* The pending calls are failed below without retaining raw provider output. */
    } finally {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new ProviderError("provider_unavailable"));
      }
      this.pending.clear();
      this.ready = undefined;
    }
  }
  subscribe(listener: (method: string, params: unknown) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async close() {
    if (this.child) {
      try {
        this.child.kill("SIGTERM");
      } catch { /* Already exited. */ }
      await this.child.status;
      await this.reader;
      this.writer?.releaseLock();
      this.child = undefined;
    }
  }
}
