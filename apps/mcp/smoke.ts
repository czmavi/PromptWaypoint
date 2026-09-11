import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { readConfig } from "./config.ts";

/** Read-only smoke client; unlike main.ts this is not a stdio server. */
if (import.meta.main) {
  const client = new Client({ name: "pmai-smoke", version: "0.1.0" }, {
    versionNegotiation: { mode: "auto" },
  });
  try {
    const config = readConfig();
    await client.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", config.serverUrl), {
        requestInit: {
          headers: { Authorization: `Bearer ${config.clientToken}` },
          redirect: "error",
        },
      }),
    );
    const tools = await client.listTools();
    const resources = await client.listResources();
    const result = await client.callTool({
      name: "pmai_list_devices",
      arguments: {},
    });
    if (result.isError) throw new Error("Tool call failed");
    await client.readResource({ uri: "pmai://repositories" });
    console.log(
      JSON.stringify(
        {
          ok: true,
          tools: tools.tools.map((t) => t.name),
          resources: resources.resources.map((r) => r.uri),
        },
        null,
        2,
      ),
    );
  } catch {
    console.error(
      "PM.ai MCP smoke failed. Check server URL, Companion token and server availability.",
    );
    Deno.exitCode = 1;
  } finally {
    await client.close();
  }
}
