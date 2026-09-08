import { Agent } from "./src/agent.ts";
import { localApi } from "./src/api.ts";
import { Store } from "./src/store.ts";
import { CodexProvider } from "./src/providers/codex.ts";
import { ClaudeProvider } from "./src/providers/claude.ts";
import { StdioRpc } from "./src/providers/rpc.ts";
import { ServerSync } from "./src/sync.ts";
export { Agent, localApi, Store };
if (import.meta.main) {
  const directory = Deno.env.get("PMAI_AGENT_DIR") ??
    `${Deno.env.get("HOME") ?? "."}/.pmai-agent`;
  await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
  // OS file lock prevents two daemons from dispatching against one SQLite store.
  const lock = await Deno.open(`${directory}/daemon.lock`, {
    create: true,
    write: true,
  });
  await lock.lock(true);
  const tokenPath = `${directory}/local-token`;
  let token: string;
  try {
    token = (await Deno.readTextFile(tokenPath)).trim();
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
    token = crypto.randomUUID() + crypto.randomUUID();
    await Deno.writeTextFile(tokenPath, token, {
      mode: 0o600,
      createNew: true,
    });
  }
  const store = new Store(
    `${directory}/agent.sqlite`,
    Deno.env.get("PMAI_DEVICE_NAME"),
  );
  const agent = new Agent(
    store,
    (p) =>
      p.provider === "codex"
        ? new CodexProvider(
          new StdioRpc(
            Deno.env.get("PMAI_CODEX_BIN") ?? "codex",
            p.configDirectory,
          ),
        )
        : new ClaudeProvider(
          p.configDirectory,
          Deno.env.get("PMAI_CLAUDE_BIN") ?? "claude",
        ),
  );
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: Number(Deno.env.get("PMAI_AGENT_PORT") ?? 7431),
  }, localApi(agent, token));
  const url = Deno.env.get("PMAI_SERVER_URL");
  const serverToken = Deno.env.get("PMAI_DEVICE_TOKEN");
  const sync = url && serverToken
    ? new ServerSync(agent, url, serverToken)
    : undefined;
  sync?.start();
  await agent.start(Number(Deno.env.get("PMAI_RECONCILE_MS") ?? 60000));
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    sync?.close();
    await server.shutdown();
    await agent.close();
    store.close();
    await lock.unlock();
    lock.close();
  };
  Deno.addSignalListener("SIGINT", () => {
    void close();
  });
  Deno.addSignalListener("SIGTERM", () => {
    void close();
  });
}
