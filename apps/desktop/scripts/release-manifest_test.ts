import { strict as assert } from "node:assert";
import { releaseManifest } from "./release-manifest.ts";
Deno.test("universal updates use immutable versioned URLs and signature for both architectures", () => {
  const m = releaseManifest(
    "0.2.0",
    " signed-content\n",
    "Changes",
    "2026-09-20T12:00:00Z",
  );
  assert.deepEqual(m.platforms["darwin-aarch64"], m.platforms["darwin-x86_64"]);
  assert.equal(
    m.platforms["darwin-aarch64"].url,
    "https://github.com/czmavi/prompt-waypoint-releases/releases/download/macos-v0.2.0/Prompt-Waypoint.app.tar.gz",
  );
  assert.equal(m.platforms["darwin-aarch64"].signature, "signed-content");
  assert.equal(m.notes, "Changes");
  assert.equal(m.pub_date, "2026-09-20T12:00:00Z");
  for (const bad of ["../latest", "0.2", "01.2.0", "0.2.0-beta.1", "0.2.0\n"]) {
    assert.throws(() => releaseManifest(bad, "sig", ""));
  }
  assert.throws(() => releaseManifest("0.2.0", " \n", ""));
});
