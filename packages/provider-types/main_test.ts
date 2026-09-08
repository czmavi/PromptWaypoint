import { strictEqual } from "node:assert/strict";
import { ProviderError } from "./main.ts";
Deno.test("provider failures have stable codes", () => {
  strictEqual(new ProviderError("timeout").code, "timeout");
});
