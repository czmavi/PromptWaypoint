import { createApp } from "../app.ts";
import { publicURL, title } from "../routes/index.tsx";
import type { ControlPlane } from "../src/services/control_plane.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("marketing SSR is public, static and independent of private services", async () => {
  // Any attempt to read auth, database, tasks, devices or sessions fails this test.
  const service = new Proxy({}, {
    get(_target, key) {
      if (key === "onClose") return () => {};
      throw new Error(`Marketing accessed private service: ${String(key)}`);
    },
  }) as ControlPlane;
  const handler = createApp(service).handler();
  for (
    const authorization of [undefined, "Bearer private-token-never-render"]
  ) {
    const response = await handler(
      new Request("http://localhost/", {
        headers: authorization ? { Authorization: authorization } : undefined,
      }),
    );
    const html = await response.text();
    assert(response.status === 200, "public homepage");
    assert(html.includes(`<title>${title}</title>`), "SEO title");
    assert(title.startsWith("Prompt Waypoint"), "product name");
    if (!Deno.env.get("PMAI_PUBLIC_URL")) {
      assert(
        html.includes('rel="canonical" href="https://promptwaypoint.com/"'),
        "default production origin",
      );
    }
    assert(html.includes("Turn ideas into work"), "headline");
    assert(
      (html.match(/<html\b/g) ?? []).length === 1,
      "single Fresh document",
    );
    assert(html.includes('<html lang="en">'), "document language");
    assert(html.includes('name="viewport"'), "responsive viewport");
    assert(
      html.includes('<link rel="stylesheet" href="/marketing/site.css"'),
      "static CSS",
    );
    assert((html.match(/<details\b/g) ?? []).length === 7, "native no-JS FAQ");
    assert(
      !/<script\b|<form\b|<input\b|<button\b/i.test(html),
      "no scripts or submission controls",
    );
    assert(
      !/private-token-never-render|\/debug|\/api\/|sessionId|userId/.test(html),
      "no internal state or links",
    );
    assert(
      html.includes("MCP integration lets compatible AI clients"),
      "MCP integration is described accurately",
    );
    assert(
      response.headers.get("Content-Security-Policy")?.includes(
        "script-src 'none'",
      ),
      "page-scoped CSP",
    );
  }
  for (
    const route of ["/api/tasks", "/api/snapshot", "/api/events", "/debug"]
  ) {
    const response = await handler(new Request(`http://localhost${route}`));
    await response.body?.cancel();
    assert(response.status === 401, `${route} stays protected`);
    assert(
      !response.headers.has("Content-Security-Policy"),
      "marketing CSP does not affect backend",
    );
  }
  const mcp = await handler(new Request("http://localhost/mcp"));
  await mcp.body?.cancel();
  assert(
    mcp.status === 401,
    "MCP requires authentication",
  );
});

Deno.test("public canonical URL accepts only configured HTTP origins", () => {
  assert(publicURL(undefined) === undefined, "absent config");
  for (
    const value of [
      "invalid",
      "javascript:alert(1)",
      "https://secret:token@example.com/",
    ]
  ) {
    assert(
      publicURL(value) === undefined,
      "invalid or credential-bearing URLs omitted",
    );
  }
  assert(
    publicURL("https://example.com/path?secret=value#hash") ===
      "https://example.com/",
    "canonical is public root, no query or fragment",
  );
});
