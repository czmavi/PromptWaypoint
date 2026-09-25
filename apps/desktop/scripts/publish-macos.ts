import { fileURLToPath } from "node:url";
import { releasesRepository } from "./release-manifest.ts";

const output = fileURLToPath(
  new URL("../src-tauri/target/macos-release/", import.meta.url),
);
const manifest = JSON.parse(await Deno.readTextFile(`${output}/latest.json`));
const tag = `macos-v${manifest.version}`;
if (Deno.env.get("RELEASE_TAG") !== tag) {
  throw new Error("Release tag does not match built artifacts");
}
const repo = JSON.parse(await gh(["api", `repos/${releasesRepository}`]));
if (repo.private) throw new Error("The downloads repository must be public");
const existing = JSON.parse(
  await gh([
    "release",
    "list",
    "--repo",
    releasesRepository,
    "--limit",
    "100",
    "--json",
    "tagName,isDraft,isLatest",
  ]),
);
const previous = existing.find((r: { tagName: string }) => r.tagName === tag);
if (previous && !previous.isDraft) {
  throw new Error("Published releases are immutable; bump the app version");
}
const latest = existing.find((r: { isLatest: boolean }) => r.isLatest);
if (latest) {
  const a = manifest.version.split(".").map(Number);
  const b = latest.tagName.replace(/^macos-v/, "").split(".").map(Number);
  const difference = a.map((v: number, i: number) => v - b[i]).find((
    v: number,
  ) => v !== 0);
  if (
    !difference || difference < 0 || b.some((v: number) => !Number.isFinite(v))
  ) {
    throw new Error("A release must be newer than the current latest release");
  }
}
const files = [
  "Prompt-Waypoint.dmg",
  "Prompt-Waypoint.app.tar.gz",
  "Prompt-Waypoint.app.tar.gz.sig",
  "latest.json",
];
for (const file of files) {
  if (!(await Deno.stat(`${output}/${file}`)).size) {
    throw new Error(`Empty artifact: ${file}`);
  }
}
// Notes are a tracked input, never interpolated into a shell command.
const notes = fileURLToPath(new URL("../RELEASE_NOTES.md", import.meta.url));
if (!previous) {
  await gh([
    "release",
    "create",
    tag,
    "--repo",
    releasesRepository,
    "--draft",
    "--title",
    `Prompt Waypoint ${manifest.version} for macOS`,
    "--notes-file",
    notes,
  ]);
}
await gh([
  "release",
  "upload",
  tag,
  "--repo",
  releasesRepository,
  "--clobber",
  ...files.map((f) => `${output}/${f}`),
]);
const uploaded = JSON.parse(
  await gh([
    "release",
    "view",
    tag,
    "--repo",
    releasesRepository,
    "--json",
    "assets,isDraft",
  ]),
);
if (!uploaded.isDraft) throw new Error("Release changed while uploading");
for (const file of files) {
  if (
    !uploaded.assets.some((a: { name: string; size: number }) =>
      a.name === file && a.size === Deno.statSync(`${output}/${file}`).size
    )
  ) {
    throw new Error(`Uploaded artifact missing or incomplete: ${file}`);
  }
}
await gh([
  "release",
  "edit",
  tag,
  "--repo",
  releasesRepository,
  "--draft=false",
  "--latest",
  "--notes-file",
  notes,
]);
console.log(
  `Published https://github.com/${releasesRepository}/releases/tag/${tag}`,
);
async function gh(args: string[]) {
  const result = await new Deno.Command("gh", {
    args,
    stdout: "piped",
    stderr: "inherit",
  }).output();
  if (!result.success) throw new Error(`GitHub CLI failed (${result.code})`);
  return new TextDecoder().decode(result.stdout);
}
