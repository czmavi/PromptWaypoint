import { strictEqual } from "node:assert/strict";
import { LocalAgentClient } from "./main.ts";
Deno.test("client sends auth and preserves command id", async () => {
  const client = new LocalAgentClient(
    "http://127.0.0.1:7431",
    "local",
    (_url, init) => {
      strictEqual(
        new Headers(init?.headers).get("authorization"),
        "Bearer local",
      );
      strictEqual(JSON.parse(init?.body as string).commandId, "c");
      return Promise.resolve(
        Response.json({ commandId: "c", status: "completed" }),
      );
    },
  );
  await client.command({ commandId: "c", executionId: "e", action: "resume" });
});

Deno.test("server snapshots reuse unchanged revisions and refresh on another instance's change", async () => {
  const { ServerClient } = await import("./server.ts");
  let revision = "1:online";
  let downloads = 0;
  const client = new ServerClient("https://example.test", "client", (input) => {
    if (String(input).endsWith("/api/revision")) {
      return Promise.resolve(Response.json({ revision }));
    }
    downloads++;
    return Promise.resolve(
      Response.json({ tasks: [{ id: String(downloads) }] }),
    );
  });
  strictEqual((await client.snapshot()).tasks[0].id, "1");
  strictEqual((await client.snapshot()).tasks[0].id, "1");
  strictEqual(downloads, 1);
  revision = "2:online";
  strictEqual((await client.snapshot()).tasks[0].id, "2");
  revision = "2:offline"; // Lease expiry changes revision without a domain write.
  strictEqual((await client.snapshot()).tasks[0].id, "3");
});

Deno.test("revision subscription cancels cleanly during a request", async () => {
  const { ServerClient } = await import("./server.ts");
  const abort = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => started = resolve);
  const client = new ServerClient(
    "https://example.test",
    "client",
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
        started();
      }),
  );
  let changes = 0;
  const subscribed = client.subscribe(() => {
    changes++;
  }, abort.signal);
  await ready;
  abort.abort();
  await subscribed;
  strictEqual(changes, 0);
});
