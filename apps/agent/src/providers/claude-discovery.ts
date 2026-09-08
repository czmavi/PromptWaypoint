// Dedicated process: the SDK reads CLAUDE_CONFIG_DIR without racing other profiles.
import {
  getSessionMessages,
  listSessions,
} from "@anthropic-ai/claude-agent-sdk";
import { now } from "../../../../packages/core/main.ts";
import { object } from "../../../../packages/protocol/main.ts";
const sessions = await listSessions();
const result = [];
for (const s of sessions) {
  if (!s.cwd || (Deno.args[0] && s.sessionId !== Deno.args[0])) continue;
  let lastMessage: string | undefined;
  if (Deno.args[0]) {
    const messages = await getSessionMessages(s.sessionId);
    const last = messages.filter((m) => m.type === "assistant").at(-1);
    if (last) {
      const content = object(last.message).content;
      if (Array.isArray(content)) {
        lastMessage = content.filter((c) => c.type === "text").map((c) =>
          c.text
        ).join("\n");
      }
    }
  }
  result.push({
    id: s.sessionId,
    cwd: s.cwd,
    state: "unknown",
    availability: "available",
    updatedAt: new Date(s.lastModified).toISOString(),
    startedAt: s.createdAt ? new Date(s.createdAt).toISOString() : undefined,
    observedAt: now(),
    lastMessage,
  });
}
console.log(JSON.stringify(result));
