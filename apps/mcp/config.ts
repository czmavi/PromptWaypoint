export interface McpConfig {
  serverUrl: string;
  clientToken: string;
  agentUrl?: string;
  agentToken?: string;
}
export function readConfig(
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
): McpConfig {
  const server = env("PMAI_SERVER_URL");
  const clientToken = env("PMAI_CLIENT_TOKEN");
  if (!server || !clientToken) {
    throw new Error("PMAI_SERVER_URL and PMAI_CLIENT_TOKEN are required.");
  }
  function url(value: string, localOnly: boolean) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("Invalid MCP connection URL.");
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      parsed.hostname,
    );
    if (
      parsed.username || parsed.password || parsed.search || parsed.hash ||
      parsed.pathname !== "/" ||
      (parsed.protocol !== "https:" &&
        !(parsed.protocol === "http:" && loopback)) ||
      (localOnly && !loopback)
    ) {
      throw new Error(
        "Use an HTTP(S) origin without credentials; remote servers require HTTPS and Local Agent must be loopback.",
      );
    }
    return parsed.origin;
  }
  const agent = env("PMAI_AGENT_URL");
  const agentToken = env("PMAI_AGENT_TOKEN");
  if (!!agent !== !!agentToken) {
    throw new Error(
      "Set both PMAI_AGENT_URL and PMAI_AGENT_TOKEN for optional cwd resolution.",
    );
  }
  return {
    serverUrl: url(server, false),
    clientToken,
    ...(agent ? { agentUrl: url(agent, true), agentToken } : {}),
  };
}
