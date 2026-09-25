export const releasesRepository = "czmavi/prompt-waypoint-releases";
export function releaseManifest(
  version: string,
  signature: string,
  notes: string,
  publishedAt = new Date().toISOString(),
) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(
      "A stable semantic version is required (for example 0.2.0).",
    );
  }
  if (!signature.trim()) throw new Error("Missing updater signature");
  const artifact = {
    signature: signature.trim(),
    url:
      `https://github.com/${releasesRepository}/releases/download/macos-v${version}/Prompt-Waypoint.app.tar.gz`,
  };
  return {
    version,
    notes,
    pub_date: publishedAt,
    platforms: { "darwin-aarch64": artifact, "darwin-x86_64": artifact },
  };
}
