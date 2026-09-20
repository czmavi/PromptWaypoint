// Read-only checks of the canonical settings and regenerated Xcode project.
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
const root = new URL("../src-tauri/", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const config = JSON.parse(await read("tauri.ios.conf.json"));
strictEqual(config.identifier, "com.caretsix.aiproductmanager");
strictEqual(config.productName, "Prompt Waypoint");
ok(/^\d+\.\d+\.\d+$/.test(config.version));
ok(/^[1-9]\d*$/.test(config.bundle.iOS.bundleVersion));
strictEqual(config.bundle.iOS.minimumSystemVersion, "16.4");
const baseConfig = JSON.parse(await read("tauri.conf.json"));
strictEqual(
  baseConfig.bundle.iOS.minimumSystemVersion,
  config.bundle.iOS.minimumSystemVersion,
);
ok((await read("companion-native/ios/Package.swift")).includes('.iOS("16.4")'));
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
const privacy = await plist("ios/PrivacyInfo.xcprivacy");
strictEqual(privacy.NSPrivacyTracking, false);
deepStrictEqual(privacy.NSPrivacyTrackingDomains, []);
for (
  const [category, reason] of [
    ["UserDefaults", "CA92.1"],
    ["FileTimestamp", "C617.1"],
  ]
) {
  ok(
    privacy.NSPrivacyAccessedAPITypes.some((entry: {
      NSPrivacyAccessedAPIType: string;
      NSPrivacyAccessedAPITypeReasons: string[];
    }) =>
      entry.NSPrivacyAccessedAPIType ===
        `NSPrivacyAccessedAPICategory${category}` &&
      entry.NSPrivacyAccessedAPITypeReasons.includes(reason)
    ),
    `Missing privacy reason: ${category}`,
  );
}
const resources = Object.values(project.objects).filter((object) =>
  (object as { isa: string }).isa === "PBXResourcesBuildPhase"
) as { files: string[] }[];
ok(
  resources.some((phase) =>
    phase.files.some((id) => {
      const fileRef = project.objects[id].fileRef;
      const reference = project.objects[fileRef];
      return reference?.path === "PrivacyInfo.xcprivacy" &&
        Object.values(project.objects).some((value) => {
          const group = value as {
            isa: string;
            path?: string;
            children?: string[];
          };
          return group.isa === "PBXGroup" && group.path === "../../ios" &&
            group.children?.includes(fileRef);
        });
    })
  ),
  "PrivacyInfo.xcprivacy must be in the Xcode resources build phase; regenerate the project",
);
ok(
  resources.every((phase) =>
    phase.files.every((id) => {
      const reference = project.objects[project.objects[id].fileRef];
      return !reference?.path?.endsWith(".a");
    })
  ),
  "Static libraries must be linked, not copied into app resources",
);
const rootProject = project.objects[project.rootObject];
for (
  const id of project.objects[rootProject.buildConfigurationList]
    .buildConfigurations
) {
  strictEqual(
    String(project.objects[id].buildSettings.IPHONEOS_DEPLOYMENT_TARGET),
    config.bundle.iOS.minimumSystemVersion,
  );
}
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
