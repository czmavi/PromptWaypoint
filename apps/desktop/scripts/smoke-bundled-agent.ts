import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const binaries = Deno.args[0] ? resolve(Deno.args[0]) : fileURLToPath(
  new URL(`../src-tauri/agent-bin/${Deno.build.arch}/`, import.meta.url),
);
const directory = await Deno.makeTempDir({ prefix: "prompt-waypoint-smoke-" });
const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
const port = listener.addr.port;
listener.close();
const base = `http://127.0.0.1:${port}`;
const env = {
  HOME: directory,
  PATH: "/usr/bin:/bin",
  PMAI_AGENT_DIR: directory,
  PMAI_AGENT_PORT: String(port),
  PMAI_MANAGED_AGENT: "1",
  PMAI_DEVICE_TOKEN: "",
  CLAUDE_CONFIG_DIR: directory,
};
let child: Deno.ChildProcess | undefined;
let socket: WebSocket | undefined;
try {
  let device: string | undefined;
  let savedToken: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    child = new Deno.Command(`${binaries}/prompt-waypoint-agent`, {
      cwd: directory,
      env,
      stdin: "piped",
      stdout: "null",
      stderr: "inherit",
    }).spawn();
    let token = "";
    await (async () => {
      const until = Date.now() + 10000;
      while (Date.now() < until) {
        try {
          token = (await Deno.readTextFile(`${directory}/local-token`)).trim();
          const response = await fetch(`${base}/state`, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(1000),
          });
          const state = await response.json();
          assert.equal(response.status, 200);
          if (device) assert.equal(state.device.id, device);
          if (savedToken) assert.equal(token, savedToken);
          device = state.device.id;
          savedToken = token;
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      throw new Error("Bundled agent did not become ready");
    })();
    socket = new WebSocket(`ws://127.0.0.1:${port}/events`, [
      "pmai-events",
      `pmai-auth.${token}`,
    ]);
    await deadline(() =>
      new Promise<void>((resolve, reject) => {
        socket!.onopen = () => resolve();
        socket!.onerror = () => reject(new Error("Agent events failed"));
      }), 3000);
    const drained = await fetch(`${base}/lifecycle/drain`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(drained.status, 200);
    await drained.body?.cancel();
    await child.stdin.close();
    const status = await deadline(() => child!.status, 10000);
    assert.equal(status.success, true);
    child = undefined;
    socket.close();
    socket = undefined;
  }
  const discovery = await new Deno.Command(`${binaries}/claude-discovery`, {
    cwd: directory,
    env,
    stdout: "piped",
    stderr: "inherit",
  }).output();
  assert.equal(discovery.success, true);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(discovery.stdout)), []);
  console.log(
    "Bundled agent: authenticated HTTP, WebSocket, graceful exit, restart persistence and isolated Claude discovery passed without Deno on PATH.",
  );
} finally {
  socket?.close();
  if (child) {
    try {
      child.kill("SIGKILL");
    } catch { /* Already exited. */ }
    await child.status;
  }
  await Deno.remove(directory, { recursive: true });
}
async function deadline<T>(run: () => Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Bundled agent smoke test timed out")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
