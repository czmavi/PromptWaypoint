interface Subscriber {
  controller: ReadableStreamDefaultController<Uint8Array>;
  close: () => void;
}
export class ClientEvents {
  private clients = new Map<string, Set<Subscriber>>();
  private encoder = new TextEncoder();
  publish(userId: string, type = "changed") {
    for (const client of this.clients.get(userId) ?? []) {
      try {
        if ((client.controller.desiredSize ?? 0) <= 0) client.close();
        else {client.controller.enqueue(
            this.encoder.encode(
              `event: ${type}\ndata: ${
                JSON.stringify({ type, at: new Date().toISOString() })
              }\n\n`,
            ),
          );}
      } catch {
        client.close();
      }
    }
  }
  response(
    userId: string,
    signal: AbortSignal,
    authorized: () => Promise<boolean> = () => Promise.resolve(true),
  ): Response {
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let set = this.clients.get(userId);
        if (!set) {
          set = new Set();
          this.clients.set(userId, set);
        }
        const entry: Subscriber = { controller, close: () => cleanup() };
        set.add(entry);
        controller.enqueue(
          this.encoder.encode('event: connected\ndata: {"refresh":true}\n\n'),
        );
        const heartbeat = setInterval(() => {
          void authorized().then((valid) => {
            if (!valid) {
              cleanup();
              return;
            }
            try {
              if ((controller.desiredSize ?? 0) <= 0) {
                cleanup();
                return;
              }
              controller.enqueue(this.encoder.encode(": heartbeat\n\n"));
            } catch {
              cleanup();
            }
          }).catch(cleanup);
        }, 15000);
        cleanup = () => {
          clearInterval(heartbeat);
          set!.delete(entry);
          signal.removeEventListener("abort", cleanup);
          try {
            controller.close();
          } catch { /*Closed*/ }
        };
        signal.addEventListener("abort", cleanup, { once: true });
        if (signal.aborted) cleanup();
      },
      cancel: () => cleanup(),
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-store",
        "x-accel-buffering": "no",
      },
    });
  }
  closeUser(userId: string) {
    for (const c of this.clients.get(userId) ?? []) c.close();
    this.clients.delete(userId);
  }
  close() {
    for (const user of this.clients.keys()) this.closeUser(user);
  }
}
