import { throws } from "node:assert/strict";
import { parseCommand } from "./main.ts";
Deno.test("reject invalid command action", () => {
  throws(() =>
    parseCommand({ commandId: "x", executionId: "e", action: "deleteAll" })
  );
});
