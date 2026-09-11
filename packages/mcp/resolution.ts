import type { Repository, ServerDevice } from "../core/main.ts";
export function repositorySummary(
  repository: Repository,
  devices: ServerDevice[],
) {
  return {
    id: repository.id,
    name: repository.name,
    deviceId: repository.deviceId,
    device: devices.find((d) => d.id === repository.deviceId)?.name ??
      "Unknown device",
    localPath: repository.localPath,
    defaultProviderProfile: repository.defaultProviderProfileId,
  };
}
export function resolveRepository(
  repositories: Repository[],
  devices: ServerDevice[],
  query: string,
  deviceId?: string,
) {
  const pool = repositories.filter((r) => !deviceId || r.deviceId === deviceId);
  const name = query.trim().toLocaleLowerCase();
  const exact = pool.filter((r) =>
    r.name.toLocaleLowerCase() === name || r.id === query
  );
  const candidates = exact.length
    ? exact
    : pool.filter((r) => r.name.toLocaleLowerCase().includes(name));
  const summaries = candidates.slice(0, 100).map((r) =>
    repositorySummary(r, devices)
  );
  return {
    ...(exact.length === 1 ? { exactMatch: summaries[0] } : {}),
    candidates: summaries,
    message: exact.length === 1
      ? "One strong match. Use its repositoryId."
      : candidates.length > 1
      ? "Repository is ambiguous. Ask the user to choose a device/repository; do not select the first candidate."
      : candidates.length === 1
      ? "Partial match only. Confirm this repository with the user."
      : "No match. Choose a repository explicitly.",
  };
}
