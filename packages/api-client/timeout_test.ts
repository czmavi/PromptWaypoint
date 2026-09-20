import { rejects, strictEqual } from "node:assert/strict";
import { withRequestTimeout } from "./timeout.ts";
import { ServerClient } from "./server.ts";

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    }
  });
}

Deno.test("request deadline aborts a stalled response body", async () => {
  await rejects(
    withRequestTimeout(
      async (signal) => {
        const response = new Response(
          new ReadableStream({
            start(controller) {
              signal.addEventListener(
                "abort",
                () => controller.error(signal.reason),
                {
                  once: true,
                },
              );
              controller.enqueue(new TextEncoder().encode('{"unfinished":'));
            },
          }),
        );
        return await response.json();
      },
      undefined,
      5,
    ),
    { name: "TimeoutError" },
  );
});

Deno.test("request forwards cancellation and skips an already cancelled request", async () => {
  const parent = new AbortController();
  const reason = new DOMException("Stopped", "AbortError");
  const pending = withRequestTimeout(waitForAbort, parent.signal);
  parent.abort(reason);
  await rejects(pending, (error) => error === reason);
  await rejects(
    withRequestTimeout(() => {
      throw new Error("A cancelled request must not be sent");
    }, parent.signal),
    (error) => error === reason,
  );
});

Deno.test("finished requests detach cancellation and clear their timers", async () => {
  const parent = new AbortController();
  let completedSignal!: AbortSignal;
  strictEqual(
    await withRequestTimeout((signal) => {
      completedSignal = signal;
      return Promise.resolve("done");
    }, parent.signal),
    "done",
  );
  parent.abort();
  strictEqual(completedSignal.aborted, false);
  // Deno's resource sanitizer also fails this test if a deadline timer leaks.
  await rejects(
    withRequestTimeout(() => Promise.reject(new Error("offline"))),
    {
      message: "offline",
    },
  );
});

Deno.test("revision subscription works without AbortSignal.any or timeout (iOS 16.4)", async () => {
  const any = Object.getOwnPropertyDescriptor(AbortSignal, "any")!;
  const timeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")!;
  const parent = new AbortController();
  try {
    Object.defineProperty(AbortSignal, "any", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(AbortSignal, "timeout", {
      value: undefined,
      configurable: true,
    });
    const client = new ServerClient(
      "https://example.test",
      "test",
      () => Promise.resolve(Response.json({ revision: "1" })),
    );
    let changes = 0;
    await client.subscribe(() => {
      changes++;
      parent.abort();
    }, parent.signal);
    strictEqual(changes, 1);
  } finally {
    parent.abort();
    Object.defineProperty(AbortSignal, "any", any);
    Object.defineProperty(AbortSignal, "timeout", timeout);
  }
});
