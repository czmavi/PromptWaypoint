// Keep the existing host/port environment contract when serving the Vite build.
const entry = new URL("./_fresh/server.js", import.meta.url);
const { default: server } = await import(entry.href);
Deno.serve({
  hostname: Deno.env.get("PMAI_SERVER_HOST") ?? "127.0.0.1",
  port: Number(Deno.env.get("PORT") ?? 8000),
}, server.fetch);
