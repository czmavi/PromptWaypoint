// Register before serving so Deno Deploy discovers the job during warmup.
Deno.cron("companion-maintenance", "* * * * *", {
  backoffSchedule: [1000, 5000, 10000],
}, async () => {
  // The Fresh bundle initializes this shared runtime hook. Keep serve.ts free
  // of source imports so the packaged _fresh directory remains self-contained.
  const runtime = (globalThis as typeof globalThis & {
    [key: symbol]: { maintenance(): Promise<void> } | undefined;
  })[Symbol.for("pmai.server.runtime")];
  if (!runtime) throw new Error("Server runtime not initialized");
  await runtime.maintenance();
});

// Keep the existing host/port environment contract when serving the Vite build.
const entry = new URL("./_fresh/server.js", import.meta.url);
const { default: server } = await import(entry.href);
Deno.serve({
  hostname: Deno.env.get("PMAI_SERVER_HOST") ?? "127.0.0.1",
  port: Number(Deno.env.get("PORT") ?? 8000),
}, server.fetch);
