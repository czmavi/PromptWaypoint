import { deepStrictEqual as equal, ok } from "node:assert/strict";
import { join } from "node:path";
import { discoverProviderProfiles } from "./profile-discovery.ts";
import { Agent, localApi, Store } from "../../main.ts";
import { FakeCodingAgentProvider } from "./fake.ts";
import type { ProviderProfile } from "../../../../packages/core/main.ts";

Deno.test("profile discovery finds defaults and overrides, excludes existing canonical paths and does not modify profiles", async () => {
  const temp = await Deno.makeTempDir();
  const home = await Deno.realPath(temp);
  try {
    for (const folder of [".codex", ".claude", "work"]) {
      await Deno.mkdir(join(home, folder));
    }
    const locations = {
      home,
      codexHome: join(home, "work"),
      claudeConfigDir: join(home, ".claude"),
    };
    const found = await discoverProviderProfiles([], locations);
    equal(found.profiles.map((p) => [p.provider, p.source]), [
      ["codex", "default"],
      ["codex", "environment"],
      ["claude", "default"],
    ]);
    equal(found.warnings, []);
    const existing: ProviderProfile[] = [{
      id: "personal",
      provider: "codex",
      name: "My name",
      configDirectory: join(home, ".codex"),
      autoResume: true,
    }];
    const next = await discoverProviderProfiles(existing, locations);
    equal(next.profiles.length, 2);
    equal(existing[0].name, "My name");
    equal(existing[0].autoResume, true);
    const relative = await discoverProviderProfiles([], {
      home,
      codexHome: "relative/path",
      claudeConfigDir: "~/work",
    });
    ok(relative.warnings.some((warning) => warning.includes("absolute")));
    ok(
      relative.profiles.some((p) =>
        p.provider === "claude" && p.configDirectory === join(home, "work")
      ),
    );
    if (Deno.build.os !== "windows") {
      await Deno.symlink(join(home, ".codex"), join(home, "alias"));
      const alias = await discoverProviderProfiles([], {
        home,
        codexHome: join(home, "alias"),
      });
      equal(alias.profiles.length, 2);
      const registeredAlias = await discoverProviderProfiles([{
        ...existing[0],
        configDirectory: join(home, "alias"),
      }], { home });
      equal(registeredAlias.profiles.map((p) => p.provider), ["claude"]);
    }
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
});

Deno.test("profile discovery handles missing homes, missing overrides and files without inventing profiles", async () => {
  const home = await Deno.makeTempDir();
  try {
    equal(await discoverProviderProfiles([], { home }), {
      profiles: [],
      warnings: [],
    });
    await Deno.writeTextFile(join(home, ".codex"), "not a directory");
    const found = await discoverProviderProfiles([], {
      home,
      claudeConfigDir: join(home, "missing"),
    });
    equal(found.profiles, []);
    equal(found.warnings.length, 2);
    equal((await discoverProviderProfiles([], {})).warnings.length, 1);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("local profile discovery is authenticated and repeated concurrent imports preserve the existing profile", async () => {
  const directory = await Deno.makeTempDir();
  const store = new Store(":memory:");
  const agent = new Agent(store, () => new FakeCodingAgentProvider());
  let scans = 0;
  const api = localApi(agent, "secret", undefined, (profiles) => {
    scans++;
    return discoverProviderProfiles(profiles, {
      home: directory,
      codexHome: directory,
    });
  });
  const request = (path: string, body?: unknown, token = "secret") =>
    api(
      new Request(`http://127.0.0.1:7431${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  try {
    equal(
      (await request("/profiles/discover", undefined, "invalid")).status,
      401,
    );
    equal(scans, 0);
    const response = await request("/profiles/discover");
    equal(response.status, 200);
    const found = await response.json();
    equal(found.profiles.length, 1);
    equal(store.all("profiles"), []);
    const profile = {
      ...found.profiles[0],
      name: "Personal",
      autoResume: true,
    };
    const first = await (await request("/profiles", profile)).json();
    const duplicates = await Promise.all([
      request("/profiles", {
        ...profile,
        name: "Overwrite",
        autoResume: false,
      }),
      request("/profiles", profile),
    ]);
    for (const duplicate of duplicates) equal(await duplicate.json(), first);
    equal(store.all("profiles").length, 1);
    equal((await (await request("/profiles/discover")).json()).profiles, []);
  } finally {
    await agent.close();
    store.close();
    await Deno.remove(directory, { recursive: true });
  }
});
