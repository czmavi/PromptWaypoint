import { isAbsolute, normalize } from "node:path";
import type { LocalState } from "../../packages/api-client/main.ts";
import type { ServerSnapshot } from "../../packages/core/main.ts";

const normalized = (path: string) =>
  normalize(path).replace(/[\\/]+$/, "") || "/";
/** Lexical path comparison only: no Git, directory traversal, symlinks or filesystem reads. */
export async function resolveCurrentRepository(
  cwd: string,
  readLocal: () => Promise<Pick<LocalState, "device" | "repositories">>,
  snapshot: ServerSnapshot,
): Promise<{ repositoryId?: string; message: string }> {
  const choose = {
    message: "No unique local cwd match. Choose repositoryId explicitly.",
  };
  try {
    const local = await readLocal();
    if (!isAbsolute(cwd)) return choose;
    const matches = local.repositories.filter((r) =>
      r.deviceId === local.device.id && isAbsolute(r.localPath) &&
      normalized(r.localPath) === normalized(cwd)
    );
    if (matches.length !== 1) return choose;
    const matchesServer = snapshot.repositories.filter((r) =>
      r.id === matches[0].id && r.deviceId === local.device.id &&
      isAbsolute(r.localPath) && normalized(r.localPath) === normalized(cwd)
    );
    return matchesServer.length === 1
      ? {
        repositoryId: matchesServer[0].id,
        message: "Unique local cwd match.",
      }
      : choose;
  } catch {
    return {
      message: "Local Agent unavailable. Choose repositoryId explicitly.",
    };
  }
}
