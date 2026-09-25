import { fileURLToPath } from "node:url";
import { cp } from "node:fs/promises";
const root = new URL("../../../", import.meta.url);
// npm workspace links can otherwise embed desktop/mobile build directories.
const stage = await Deno.makeTempDir({
  prefix: "prompt-waypoint-agent-build-",
});
try {
  for (
    const directory of [
      "apps/agent",
      "packages/core",
      "packages/protocol",
      "packages/provider-types",
    ]
  ) {
    await cp(fileURLToPath(new URL(directory, root)), `${stage}/${directory}`, {
      recursive: true,
      filter: (path) => !path.includes("node_modules"),
    });
  }
  await Deno.writeTextFile(
    `${stage}/deno.json`,
    JSON.stringify({
      workspace: [
        "./apps/agent",
        "./packages/core",
        "./packages/protocol",
        "./packages/provider-types",
      ],
      nodeModulesDir: "none",
    }),
  );
  const lock = JSON.parse(await Deno.readTextFile(new URL("deno.lock", root)));
  lock.workspace.members = {
    "apps/agent": lock.workspace.members["apps/agent"],
  };
  await Deno.writeTextFile(
    `${stage}/deno.lock`,
    JSON.stringify(lock, null, 2) + "\n",
  );
  for (const arch of ["aarch64", "x86_64"]) {
    const output = new URL(`apps/desktop/src-tauri/agent-bin/${arch}/`, root);
    await Deno.mkdir(output, { recursive: true });
    for (
      const [name, entry] of [
        ["prompt-waypoint-agent", "apps/agent/main.ts"],
        ["claude-discovery", "apps/agent/src/providers/claude-discovery.ts"],
      ]
    ) {
      const result = await new Deno.Command(Deno.execPath(), {
        cwd: stage,
        args: [
          "compile",
          "--frozen",
          "--exclude-unused-npm",
          "--target",
          `${arch}-apple-darwin`,
          "--allow-read",
          "--allow-write",
          "--allow-env",
          "--allow-net",
          "--allow-run",
          "--allow-sys=homedir",
          "--output",
          fileURLToPath(new URL(name, output)),
          entry,
        ],
        stdout: "inherit",
        stderr: "inherit",
      }).output();
      if (!result.success) {
        throw new Error(`Could not compile ${name} for ${arch}`);
      }
    }
  }
} finally {
  await Deno.remove(stage, { recursive: true });
}
