import { strictEqual } from "node:assert/strict";
import { statusLabels } from "./main.ts";
Deno.test("waiting states use explicit labels", () => {
  strictEqual(statusLabels.waiting_input, "Needs input");
  strictEqual(statusLabels.waiting_quota, "Waiting for quota");
});
