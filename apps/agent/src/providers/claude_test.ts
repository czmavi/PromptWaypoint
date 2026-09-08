import { strictEqual as equal } from "node:assert/strict";
import { ClaudeProvider } from "./claude.ts";
Deno.test("Claude structured CLI completion and profile-isolated SDK discovery", async () => {
  const directory = await Deno.makeTempDir();
  const provider = new ClaudeProvider(
    directory,
    new URL("../../tests/fixtures/claude-cli.sh", import.meta.url).pathname,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    equal((await provider.list()).length, 0);
    equal((await provider.quota()).state, "unsupported");
    equal(provider.capabilities.liveSteering, false);
    const session = await provider.prepare(directory, "execution");
    let resolve!: () => void;
    const completed = new Promise<void>((r) => {
      resolve = r;
    });
    provider.subscribe((s) => {
      if (s?.state === "completed") resolve();
    });
    equal(
      (await provider.prompt(session.id, "Fixture prompt", "command")).state,
      "running",
    );
    await Promise.race([
      completed,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Fixture timeout")), 3000);
      }),
    ]);
    const observed = await provider.inspect(session.id);
    equal(observed.state, "completed");
    equal(observed.lastMessage, "Fixture completed");
  } finally {
    clearTimeout(timer);
    await provider.close();
    await Deno.remove(directory, { recursive: true });
  }
});
