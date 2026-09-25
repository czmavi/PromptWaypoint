import { fileURLToPath } from "node:url";
import { releaseManifest } from "./release-manifest.ts";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const tauri = `${desktop}/src-tauri`;
const config = JSON.parse(await Deno.readTextFile(`${tauri}/tauri.conf.json`));
const version = config.version as string;
const identity = required("APPLE_SIGNING_IDENTITY");
if (!identity.startsWith("Developer ID Application:")) {
  throw new Error("Use a Developer ID Application identity.");
}
required("PMAI_UPDATER_PUBLIC_KEY");
required("TAURI_SIGNING_PRIVATE_KEY");
const keyPath = required("APPLE_API_KEY_PATH");
const keyId = required("APPLE_API_KEY");
const issuer = required("APPLE_API_ISSUER");
const notes = Deno.args[0]
  ? await Deno.readTextFile(Deno.args[0])
  : `Prompt Waypoint ${version} for macOS.`;
releaseManifest(version, "validation", notes);
const app =
  `${tauri}/target/universal-apple-darwin/release/bundle/macos/Prompt Waypoint.app`;
const output = `${tauri}/target/macos-release`;
await Deno.mkdir(output, { recursive: true });
const temporary = await Deno.makeTempDir({
  prefix: "prompt-waypoint-release-",
});
try {
  await run("lipo", [
    "-verify_arch",
    "arm64",
    "x86_64",
    `${app}/Contents/MacOS/desktop`,
  ]);
  for (const arch of ["aarch64", "x86_64"]) {
    for (const name of ["prompt-waypoint-agent", "claude-discovery"]) {
      const helper = `${app}/Contents/Resources/agent-bin/${arch}/${name}`;
      await run("codesign", [
        "--force",
        "--options",
        "runtime",
        "--timestamp",
        "--sign",
        identity,
        "--entitlements",
        `${tauri}/macos/Agent.entitlements`,
        helper,
      ]);
      await run("codesign", ["--verify", "--strict", helper]);
    }
  }
  await run("codesign", [
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--sign",
    identity,
    app,
  ]);
  await run("codesign", ["--verify", "--deep", "--strict", app]);
  await run(Deno.execPath(), [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-net",
    "--allow-run",
    "scripts/smoke-bundled-agent.ts",
    `${app}/Contents/Resources/agent-bin/${Deno.build.arch}`,
  ]);
  const zip = `${temporary}/app.zip`;
  await run("ditto", ["-c", "-k", "--keepParent", app, zip]);
  await notarize(zip);
  await run("xcrun", ["stapler", "staple", app]);
  await run("xcrun", ["stapler", "validate", app]);
  await run("spctl", ["--assess", "--type", "execute", "--verbose", app]);

  const contents = `${temporary}/dmg`;
  await Deno.mkdir(contents);
  await run("ditto", [app, `${contents}/Prompt Waypoint.app`]);
  await Deno.symlink("/Applications", `${contents}/Applications`);
  const dmg = `${output}/Prompt-Waypoint.dmg`;
  await run("hdiutil", [
    "create",
    "-volname",
    "Prompt Waypoint",
    "-srcfolder",
    contents,
    "-ov",
    "-format",
    "UDZO",
    dmg,
  ]);
  await run("codesign", ["--force", "--timestamp", "--sign", identity, dmg]);
  await notarize(dmg);
  await run("xcrun", ["stapler", "staple", dmg]);
  await run("xcrun", ["stapler", "validate", dmg]);

  // Archive after stapling. The updater signature covers the final exact bytes.
  const archive = `${output}/Prompt-Waypoint.app.tar.gz`;
  await run("tar", ["-czf", archive, "-C", `${app}/..`, "Prompt Waypoint.app"]);
  await run(Deno.execPath(), ["task", "tauri", "signer", "sign", archive]);
  const signature = await Deno.readTextFile(`${archive}.sig`);
  // Verify against the key embedded in the application before publishing.
  await Deno.writeTextFile(
    `${temporary}/updater.pub`,
    atob(required("PMAI_UPDATER_PUBLIC_KEY")),
  );
  await Deno.writeTextFile(`${temporary}/updater.sig`, atob(signature.trim()));
  await run("minisign", [
    "-Vm",
    archive,
    "-p",
    `${temporary}/updater.pub`,
    "-x",
    `${temporary}/updater.sig`,
  ]);
  await Deno.writeTextFile(
    `${output}/latest.json`,
    JSON.stringify(releaseManifest(version, signature, notes), null, 2) + "\n",
  );
  console.log(`Signed and notarized release ready in ${output}`);
} finally {
  await Deno.remove(temporary, { recursive: true });
}
function required(name: string) {
  const value = Deno.env.get(name);
  if (!value?.trim()) throw new Error(`Missing ${name}`);
  return value;
}
async function run(command: string, args: string[]) {
  const result = await new Deno.Command(command, {
    args,
    cwd: desktop,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) throw new Error(`${command} failed (${result.code})`);
}
async function notarize(path: string) {
  const result = await new Deno.Command("xcrun", {
    args: [
      "notarytool",
      "submit",
      path,
      "--key",
      keyPath,
      "--key-id",
      keyId,
      "--issuer",
      issuer,
      "--wait",
      "--output-format",
      "json",
    ],
    stdout: "piped",
    stderr: "inherit",
  }).output();
  const response = JSON.parse(new TextDecoder().decode(result.stdout));
  if (!result.success || response.status !== "Accepted") {
    throw new Error(
      `Notarization failed: ${response.status ?? "unknown"}, submission ${
        response.id ?? "unknown"
      }`,
    );
  }
}
