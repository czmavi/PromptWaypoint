// Validate the actual bundle, rather than inferring readiness from source files.
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { resolve } from "node:path";

const root = new URL("../src-tauri/", import.meta.url);
const config = JSON.parse(
  await Deno.readTextFile(new URL("tauri.ios.conf.json", root)),
);
const unsigned = Deno.args.includes("--unsigned");
const distribution = Deno.args.includes("--distribution");
const paths = Deno.args.filter((arg) => !arg.startsWith("--"));
ok(
  Deno.args.every((arg) =>
    !arg.startsWith("--") || ["--unsigned", "--distribution"].includes(arg)
  ),
  "Unknown option",
);
ok(
  paths.length <= 1 && !(unsigned && distribution),
  "Usage: ios:archive:check [--unsigned | --distribution] [archive.xcarchive | exported.app]",
);
let bundle = resolve(
  paths[0] ?? new URL("gen/apple/build/mobile_iOS.xcarchive", root).pathname,
);
if (bundle.endsWith(".xcarchive")) {
  const apps = [];
  for await (const entry of Deno.readDir(`${bundle}/Products/Applications`)) {
    if (entry.isDirectory && entry.name.endsWith(".app")) apps.push(entry.name);
  }
  strictEqual(
    apps.length,
    1,
    "Expected exactly one application in the archive",
  );
  bundle += `/Products/Applications/${apps[0]}`;
}
ok(bundle.endsWith(".app"), "Pass an .xcarchive or extracted .app directory");
async function command(cmd: string, args: string[]) {
  const result = await new Deno.Command(cmd, { args }).output();
  ok(
    result.success,
    `${cmd} failed: ${new TextDecoder().decode(result.stderr)}`,
  );
  return new TextDecoder().decode(result.stdout);
}
async function plist(path: string) {
  return JSON.parse(
    await command("plutil", ["-convert", "json", "-o", "-", path]),
  );
}
const info = await plist(`${bundle}/Info.plist`);
strictEqual(info.CFBundleIdentifier, config.identifier);
strictEqual(info.CFBundleDisplayName, config.productName);
strictEqual(info.CFBundleShortVersionString, config.version);
strictEqual(info.CFBundleVersion, config.bundle.iOS.bundleVersion);
strictEqual(info.MinimumOSVersion, config.bundle.iOS.minimumSystemVersion);
strictEqual(info.ITSAppUsesNonExemptEncryption, false);
strictEqual(info.CFBundleSupportedPlatforms[0], "iPhoneOS");
ok(
  Number.parseInt(info.DTXcode, 10) >= 2600,
  "Apple requires Xcode 26 or later",
);
const sdk = /^iphoneos(\d+)/.exec(info.DTSDKName);
ok(
  sdk && Number(sdk[1]) >= 26,
  "Apple requires the iOS 26 SDK or later",
);
ok(
  info.CFBundleURLTypes.some((type: { CFBundleURLSchemes: string[] }) =>
    type.CFBundleURLSchemes.includes("pmai")
  ),
);
strictEqual(info.UILaunchStoryboardName, "LaunchScreen");
await Deno.stat(`${bundle}/LaunchScreen.storyboardc`);
await Deno.stat(`${bundle}/Assets.car`);
for await (const entry of Deno.readDir(bundle)) {
  ok(
    !entry.name.endsWith(".a"),
    `Static library must not be shipped as a resource: ${entry.name}`,
  );
}
deepStrictEqual(
  await plist(`${bundle}/PrivacyInfo.xcprivacy`),
  await plist(new URL("ios/PrivacyInfo.xcprivacy", root).pathname),
  "Archive contains a stale privacy manifest",
);
ok(
  (await command("lipo", ["-archs", `${bundle}/${info.CFBundleExecutable}`]))
    .trim().split(/\s+/).includes("arm64"),
);

if (!unsigned) {
  await command("codesign", ["--verify", "--deep", "--strict", bundle]);
  const signed = await command("codesign", [
    "-d",
    "--entitlements",
    ":-",
    bundle,
  ]);
  const result = await new Deno.Command("plutil", {
    args: ["-convert", "json", "-o", "-", "-"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = result.stdin.getWriter();
  await writer.write(new TextEncoder().encode(signed));
  await writer.close();
  const output = await result.output();
  ok(output.success, "Could not read signed entitlements");
  const entitlements = JSON.parse(new TextDecoder().decode(output.stdout));
  // Xcode can archive with development signing and re-sign during export.
  ok(["development", "production"].includes(entitlements["aps-environment"]));
  const team = entitlements["com.apple.developer.team-identifier"];
  ok(typeof team === "string" && team.length > 0, "Missing signing team");
  const identifier = entitlements["application-identifier"];
  ok(
    typeof identifier === "string" &&
      identifier.endsWith(`.${config.identifier}`),
    "Incorrect signed app identity",
  );
  if (distribution) {
    strictEqual(entitlements["aps-environment"], "production");
    ok(
      entitlements["get-task-allow"] !== true,
      "Distribution must disable debugging",
    );
    await Deno.stat(`${bundle}/embedded.mobileprovision`);
  }
}
console.log(
  `Verified ${config.productName} ${info.CFBundleShortVersionString} (${info.CFBundleVersion}), iOS ${info.MinimumOSVersion}+, ${info.DTSDKName}, privacy manifest, icons and launch screen.`,
);
console.log(
  unsigned
    ? "UNSIGNED package validation only: this archive cannot be uploaded to TestFlight."
    : distribution
    ? "Local distribution checks passed. Apple upload/processing and device testing are still required."
    : "Signed archive checks passed. Verify the exported app with --distribution before upload.",
);
