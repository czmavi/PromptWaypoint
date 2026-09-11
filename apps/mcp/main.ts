import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createPmaiMcpServer } from "../../packages/mcp/server.ts";
import { readConfig } from "./config.ts";
import { clientMcpContext } from "./context.ts";

if (import.meta.main) {
  try {
    const context = clientMcpContext(readConfig(), Deno.cwd());
    serveStdio(() => createPmaiMcpServer(context), {
      onerror: () => console.error("PM.ai MCP transport error."),
    });
  } catch {
    console.error(
      "PM.ai MCP startup failed. Check PMAI_SERVER_URL, PMAI_CLIENT_TOKEN and optional Local Agent configuration.",
    );
    Deno.exit(1);
  }
}
