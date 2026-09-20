import { isAbsolute, join } from "node:path";
import type {
  ProfileDiscoveryResult,
  Provider,
  ProviderProfile,
} from "../../../../packages/core/main.ts";

export interface DiscoveryLocations {
  home?: string;
  codexHome?: string;
  claudeConfigDir?: string;
}

export async function discoverProviderProfiles(
  existing: ProviderProfile[],
  locations: DiscoveryLocations = {
    home: Deno.env.get("HOME") || Deno.env.get("USERPROFILE"),
    codexHome: Deno.env.get("CODEX_HOME"),
    claudeConfigDir: Deno.env.get("CLAUDE_CONFIG_DIR"),
  },
): Promise<ProfileDiscoveryResult> {
  const result: ProfileDiscoveryResult = { profiles: [], warnings: [] };
  const seen = new Set<string>();
  for (const profile of existing) {
    const path = await Deno.realPath(profile.configDirectory).catch(() =>
      profile.configDirectory
    );
    seen.add(JSON.stringify([profile.provider, path]));
  }
  if (!locations.home) {
    result.warnings.push("Agent home directory is unavailable.");
  }
  const providers: [Provider, string, string | undefined][] = [
    ["codex", "Codex", locations.codexHome],
    ["claude", "Claude", locations.claudeConfigDir],
  ];
  for (const [provider, label, override] of providers) {
    const candidates = [
      {
        path: locations.home ? join(locations.home, `.${provider}`) : undefined,
        source: "default" as const,
      },
      { path: override, source: "environment" as const },
    ];
    for (const candidate of candidates) {
      if (!candidate.path) continue;
      let path = candidate.path;
      if (path.startsWith("~/") && locations.home) {
        path = join(locations.home, path.slice(2));
      }
      if (!isAbsolute(path)) {
        result.warnings.push(
          `${label}: configuration directory must be an absolute path.`,
        );
        continue;
      }
      try {
        path = await Deno.realPath(path);
        if (!(await Deno.stat(path)).isDirectory) {
          result.warnings.push(
            `${label}: configured location is not a directory.`,
          );
          continue;
        }
        const key = JSON.stringify([provider, path]);
        if (seen.has(key)) continue;
        seen.add(key);
        result.profiles.push({
          provider,
          name: `${label} — ${
            candidate.source === "default" ? "Default" : "Custom"
          }`,
          configDirectory: path,
          source: candidate.source,
        });
      } catch (error) {
        if (
          error instanceof Deno.errors.NotFound &&
          candidate.source === "default"
        ) continue;
        result.warnings.push(
          `${label}: configuration directory is missing or inaccessible.`,
        );
      }
    }
  }
  return result;
}
