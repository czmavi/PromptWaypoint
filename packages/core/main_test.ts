import { notStrictEqual } from "node:assert/strict";
import { sessionKey } from "./main.ts";
Deno.test("session identity includes profile", () => {
  notStrictEqual(sessionKey("a", "same"), sessionKey("b", "same"));
});
