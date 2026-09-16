// Read-only checks of the canonical settings and regenerated Xcode project.
import { ok, strictEqual } from "node:assert/strict";
const root = new URL("../src-tauri/", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const config = JSON.parse(await read("tauri.ios.conf.json"));
strictEqual(config.identifier, "com.caretsix.aiproductmanager");
strictEqual(config.productName, "Prompt Waypoint");
strictEqual(config.version, "0.1.0");
ok(/^[1-9]\d*$/.test(config.bundle.iOS.bundleVersion));
strictEqual(config.bundle.iOS.minimumSystemVersion, "15.0");
strictEqual(config.bundle.iOS.template, "src-tauri/ios/project.yml.hbs");
async function plist(path: string) {
  const result = await new Deno.Command("plutil", {
    args: ["-convert", "json", "-o", "-", new URL(path, root).pathname],
  }).output();
  ok(result.success, `Invalid plist: ${path}`);
  return JSON.parse(new TextDecoder().decode(result.stdout));
}
const info = await plist("gen/apple/mobile_iOS/Info.plist");
strictEqual(info.CFBundleDisplayName, config.productName);
strictEqual(info.CFBundleShortVersionString, config.version);
strictEqual(info.CFBundleVersion, config.bundle.iOS.bundleVersion);
strictEqual(info.ITSAppUsesNonExemptEncryption, false);
ok(
  info.CFBundleURLTypes.some((v: { CFBundleURLSchemes: string[] }) =>
    v.CFBundleURLSchemes.includes("pmai")
  ),
);
strictEqual(info.UILaunchStoryboardName, "LaunchScreen");
const entitlements = await plist(
  "gen/apple/mobile_iOS/mobile_iOS.entitlements",
);
strictEqual(entitlements["aps-environment"], "$(PMAI_APNS_ENVIRONMENT)");
const project = await plist("gen/apple/mobile.xcodeproj/project.pbxproj");
let configurations = 0;
for (
  const object of Object.values(project.objects) as {
    isa: string;
    name?: string;
    buildSettings?: Record<string, string>;
  }[]
) {
  if (
    object.isa !== "XCBuildConfiguration" ||
    !object.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER
  ) continue;
  configurations++;
  strictEqual(
    object.buildSettings.PRODUCT_BUNDLE_IDENTIFIER,
    config.identifier,
  );
  strictEqual(object.buildSettings.PRODUCT_NAME, config.productName);
  strictEqual(object.buildSettings.CODE_SIGN_STYLE, "Automatic");
  strictEqual(
    object.buildSettings.PMAI_APNS_ENVIRONMENT,
    object.name === "release" ? "production" : "development",
  );
}
strictEqual(configurations, 2);
const iconsRoot = "gen/apple/Assets.xcassets/AppIcon.appiconset/";
const icons = JSON.parse(await read(iconsRoot + "Contents.json"));
let marketing = false;
for (const icon of icons.images) {
  ok(icon.filename, "Icon entry has no PNG");
  const data = await Deno.readFile(new URL(iconsRoot + icon.filename, root));
  const canonical = await Deno.readFile(
    new URL(`icons/ios/${icon.filename}`, root),
  );
  ok(
    data.length === canonical.length &&
      data.every((byte, i) => byte === canonical[i]),
    `Stale generated icon: ${icon.filename}; run ios:icons:sync`,
  );
  strictEqual(new TextDecoder().decode(data.slice(1, 4)), "PNG");
  strictEqual(
    data[25],
    2,
    `iOS icon must be RGB without alpha: ${icon.filename}`,
  );
  const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const expected = Number(icon.size.split("x")[0]) *
    Number(icon.scale.replace("x", ""));
  strictEqual(header.getUint32(16), expected, icon.filename);
  strictEqual(header.getUint32(20), expected, icon.filename);
  if (icon.idiom === "ios-marketing") {
    marketing = true;
    strictEqual(expected, 1024);
  }
}
ok(marketing, "Missing 1024px App Store icon");
console.log(
  `iOS configuration and ${icons.images.length} PNG icon entries verified. This does not validate signing or an archive.`,
);
console.log(
  "Prompt Waypoint icon master: assets/branding/app-icon.png; generated iOS assets: src-tauri/icons/ios/.",
);
