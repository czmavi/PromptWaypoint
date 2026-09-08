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
