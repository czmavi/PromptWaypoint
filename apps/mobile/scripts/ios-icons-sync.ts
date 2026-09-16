// Restore the approved icon set after Tauri regenerates the Xcode project.
const root = new URL("../src-tauri/", import.meta.url);
const catalog = new URL("gen/apple/Assets.xcassets/AppIcon.appiconset/", root);
const manifest = JSON.parse(
  await Deno.readTextFile(new URL("Contents.json", catalog)),
);
for (const entry of manifest.images as { filename: string }[]) {
  if (!/^AppIcon-[\w@.-]+\.png$/.test(entry.filename)) {
    throw new Error("Unexpected iOS icon filename");
  }
  await Deno.copyFile(
    new URL(`icons/ios/${entry.filename}`, root),
    new URL(entry.filename, catalog),
  );
}
console.log("Prompt Waypoint iOS icons synchronized.");
