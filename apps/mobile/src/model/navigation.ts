export type Destination = { kind: "task"; id: string } | {
  kind: "session";
  id: string;
  deviceId?: string;
  providerProfileId?: string;
};
export function deepLink(value: unknown): Destination | undefined {
  if (
    typeof value !== "string" ||
    /(?:\/|%2f)(?:\.|%2e){1,2}(?:\/|%2f|$)/i.test(value)
  ) return;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "pmai:" || !["tasks", "sessions"].includes(url.hostname)
    ) return;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 1) return;
    const id = decodeURIComponent(parts[0]);
    if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(id)) return;
    return url.hostname === "tasks" ? { kind: "task", id } : {
      kind: "session",
      id,
      deviceId: url.searchParams.get("deviceId") ?? undefined,
      providerProfileId: url.searchParams.get("providerProfileId") ??
        undefined,
    };
  } catch {
    return;
  }
}
export function notificationDestination(
  payload: unknown,
): Destination | undefined {
  if (!payload || typeof payload !== "object") return;
  const object = payload as Record<string, unknown>;
  const data =
    (object.data && typeof object.data === "object"
      ? object.data
      : object) as Record<string, unknown>;
  if (typeof data.taskId === "string") {
    return deepLink(`pmai://tasks/${encodeURIComponent(data.taskId)}`);
  }
  const target = deepLink(data.deepLink);
  if (target?.kind === "session") {
    return {
      ...target,
      deviceId: typeof data.deviceId === "string"
        ? data.deviceId
        : target.deviceId,
      providerProfileId: typeof data.providerProfileId === "string"
        ? data.providerProfileId
        : target.providerProfileId,
    };
  }
  return target;
}
