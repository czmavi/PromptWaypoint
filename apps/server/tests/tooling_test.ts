import {
  Client,
  StreamableHTTPClientTransport,
} from "npm:@modelcontextprotocol/client@2.0.0";

const databaseURL = Deno.env.get("PMAI_TEST_DATABASE_URL");
const cwd = new URL("../", import.meta.url);
const secret = "tooling-test-bootstrap-secret-32-characters";
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test({
  name:
    "Vite development and production build preserve HTTP, SSE and native WebSocket",
  ignore: !databaseURL,
  async fn() {
    const build = await new Deno.Command(Deno.execPath(), {
      cwd,
      args: ["task", "build"],
      env: { DATABASE_URL: "" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(build.success, new TextDecoder().decode(build.stderr));
    for (const mode of ["production", "dev"]) {
      const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
      const port = listener.addr.port;
      listener.close();
      const process = new Deno.Command(Deno.execPath(), {
        cwd,
        args: mode === "dev"
          ? ["run", "-A", "npm:vite@7.3.6", "--configLoader", "native"]
          : ["run", "--allow-env", "--allow-net", "--allow-read", "serve.ts"],
        env: {
          DATABASE_URL: databaseURL!,
          PMAI_DEV_AUTH_SECRET: secret,
          PMAI_SERVER_HOST: "127.0.0.1",
          PORT: String(port),
          PMAI_PUBLIC_URL: "https://example.com",
        },
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const output = process.output();
      const base = `http://127.0.0.1:${port}`;
      let socket: WebSocket | undefined;
      const abort = new AbortController();
      try {
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            const response = await fetch(`${base}/health`);
            const body = await response.text();
            if (response.ok && JSON.parse(body).ok) {
              ready = true;
              break;
            }
          } catch { /* Wait for the listener and module evaluation. */ }
          await new Promise((r) => setTimeout(r, 100));
        }
        assert(ready, `${mode} did not become healthy`);
        const home = await fetch(base);
        const html = await home.text();
        assert(
          home.ok && home.headers.get("content-type")?.includes("text/html"),
          `${mode}: public SSR`,
        );
        assert(
          html.includes("Turn ideas into work"),
          `${mode}: landing headline`,
        );
        assert(
          (html.match(/<html\b/g) ?? []).length === 1,
          `${mode}: valid document wrapper`,
        );
        assert(
          html.includes('rel="canonical" href="https://example.com/"'),
          `${mode}: configured SEO`,
        );
        assert(
          html.includes('content="https://example.com/marketing/icon.png"'),
          `${mode}: social preview`,
        );
        assert(!/<form\b|<input\b/.test(html), `${mode}: read-only page`);
        if (mode === "production") {
          assert(!/<script\b/.test(html), "no production client JavaScript");
        }
        for (
          const [asset, contentType] of [["site.css", "text/css"], [
            "brand.png",
            "image/png",
          ], [
            "icon.png",
            "image/png",
          ]]
        ) {
          const response = await fetch(`${base}/marketing/${asset}`);
          assert(
            response.ok &&
              response.headers.get("content-type")?.includes(contentType),
            `${mode}: ${asset} served (${response.status})`,
          );
          await response.body?.cancel();
        }
        const unauthenticated = await fetch(`${base}/api/snapshot`);
        await unauthenticated.body?.cancel();
        assert(unauthenticated.status === 401, `${mode}: auth guard`);
        const login = await fetch(`${base}/api/auth/dev-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret }),
        });
        const { token } = await login.json();
        assert(login.ok && token, `${mode}: login`);
        const headers = { Authorization: `Bearer ${token}` };
        const mcp = new Client({ name: "fresh-tooling-test", version: "1" }, {
          versionNegotiation: { mode: { pin: "2026-07-28" } },
        });
        try {
          await mcp.connect(
            new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
              requestInit: { headers },
            }),
          );
          assert(
            (await mcp.listTools()).tools.length === 14,
            `${mode}: MCP discovery`,
          );
          assert(
            !(await mcp.callTool({ name: "pmai_list_devices", arguments: {} }))
              .isError,
            `${mode}: MCP call`,
          );
          assert(
            (await mcp.listResources()).resources.length === 2,
            `${mode}: MCP resources`,
          );
        } finally {
          await mcp.close();
        }
        const snapshot = await fetch(`${base}/api/snapshot`, { headers });
        assert(
          snapshot.ok && Array.isArray((await snapshot.json()).tasks),
          `${mode}: snapshot`,
        );
        const events = await fetch(`${base}/api/events`, {
          headers,
          signal: abort.signal,
        });
        assert(
          events.headers.get("content-type")?.includes("text/event-stream"),
          `${mode}: SSE`,
        );
        const reader = events.body!.getReader();
        const first = await reader.read();
        assert(first.value?.length, `${mode}: SSE first event`);
        await reader.cancel();
        const device = {
          id: crypto.randomUUID(),
          name: "Vite smoke",
          platform: "test",
        };
        const paired = await fetch(`${base}/api/devices`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(device),
        });
        const registration = await paired.json();
        assert(paired.ok && registration.token, `${mode}: device pairing`);
        socket = new WebSocket(`${base.replace("http:", "ws:")}/ws/agent`);
        const ws = socket;
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error(`${mode}: WebSocket timeout`)),
            5000,
          );
          ws.onopen = () =>
            ws.send(
              JSON.stringify({
                type: "hello",
                version: 1,
                token: registration.token,
                device,
              }),
            );
          ws.onerror = () => {
            clearTimeout(timeout);
            reject(new Error(`${mode}: WebSocket failed`));
          };
          ws.onmessage = (event) => {
            clearTimeout(timeout);
            if (JSON.parse(event.data).type === "welcome") resolve();
            else reject(new Error(`${mode}: unexpected agent response`));
          };
        });
        if (mode === "dev") {
          // Trigger Vite's file watcher without editing source contents.
          const entry = new URL("main.ts", cwd);
          const before = await Deno.stat(entry);
          const closed = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () =>
                reject(
                  new Error("Reload did not close the old agent connection"),
                ),
              5000,
            );
            ws.onclose = () => {
              clearTimeout(timeout);
              resolve();
            };
          });
          try {
            await Deno.utime(entry, new Date(), new Date());
            await closed;
            const refreshed = await fetch(`${base}/health`);
            assert(
              refreshed.ok && (await refreshed.json()).ok,
              "Reloaded runtime is healthy",
            );
            const retained = await fetch(`${base}/api/snapshot`, { headers });
            assert(
              retained.ok &&
                (await retained.json()).devices.some((d: { id: string }) =>
                  d.id === device.id
                ),
              "Reload preserves database state and auth",
            );
          } finally {
            if (before.atime && before.mtime) {
              await Deno.utime(entry, before.atime, before.mtime);
            }
          }
        }
      } finally {
        abort.abort();
        socket?.close();
        try {
          process.kill("SIGTERM");
        } catch { /* Already exited. */ }
        const result = await output;
        if (!result.success) {
          console.error(new TextDecoder().decode(result.stderr));
        }
      }
    }
  },
});
