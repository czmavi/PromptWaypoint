import { createApp } from "../app.ts";
import { Database } from "./db/database.ts";
import { migrate } from "./db/migrate.ts";
import { ControlPlane } from "./services/control_plane.ts";
import { apnsTokenSupplier } from "./push/apns_token.ts";
import {
  ApnsPushProvider,
  FcmPushProvider,
  type PushProvider,
} from "./push/providers.ts";

interface Runtime {
  app: ReturnType<typeof createApp>;
  close(): Promise<void>;
  maintenance(): Promise<void>;
}
// Vite re-evaluates server modules. Serialize cleanup across module generations.
const key = Symbol.for("pmai.server.runtime");
const registry = globalThis as typeof globalThis & { [key]?: Runtime };
export async function closeRuntime() {
  await registry[key]?.close();
}
export async function createRuntime(): Promise<Runtime> {
  await closeRuntime();
  const url = Deno.env.get("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL required");
  const db = new Database(url);
  try {
    await migrate(db);
  } catch (error) {
    await db.close();
    throw error;
  }
  const push: Partial<Record<"apns" | "fcm", PushProvider>> = {};
  const apnsTopic = Deno.env.get("PMAI_APNS_TOPIC"),
    apnsKeyFile = Deno.env.get("PMAI_APNS_KEY_FILE"),
    apnsKeyId = Deno.env.get("PMAI_APNS_KEY_ID"),
    apnsTeamId = Deno.env.get("PMAI_APNS_TEAM_ID"),
    fcmProject = Deno.env.get("PMAI_FCM_PROJECT"),
    fcmTokenFile = Deno.env.get("PMAI_FCM_TOKEN_FILE");
  try {
    if (
      Deno.env.get("PMAI_APNS_TOKEN_FILE") ||
      [apnsTopic, apnsKeyFile, apnsKeyId, apnsTeamId].some(Boolean) &&
        ![apnsTopic, apnsKeyFile, apnsKeyId, apnsTeamId].every(Boolean)
    ) {
      throw new Error(
        "Configure PMAI_APNS_KEY_FILE, PMAI_APNS_KEY_ID, PMAI_APNS_TEAM_ID and PMAI_APNS_TOPIC; pre-generated APNs tokens are no longer supported",
      );
    }
    if (apnsTopic && apnsKeyFile && apnsKeyId && apnsTeamId) {
      push.apns = new ApnsPushProvider(
        apnsTopic,
        apnsTokenSupplier({
          keyFile: apnsKeyFile,
          keyId: apnsKeyId,
          teamId: apnsTeamId,
        }),
        Deno.env.get("PMAI_APNS_SANDBOX") === "true",
      );
    }
    if (fcmProject && fcmTokenFile) {
      push.fcm = new FcmPushProvider(
        fcmProject,
        async () => (await Deno.readTextFile(fcmTokenFile)).trim(),
      );
    }
  } catch (error) {
    await db.close();
    throw error;
  }
  const service = new ControlPlane(db, {
    devSecret: Deno.env.get("PMAI_DEV_AUTH_SECRET"),
    push,
  });
  const extraOrigins =
    Deno.env.get("PMAI_CORS_ORIGINS")?.split(",").filter(Boolean) ?? [];
  const app = createApp(service, [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    ...extraOrigins,
  ]);
  let closing: Promise<void> | undefined;
  const signal = () => {
    void close().then(() => Deno.exit(0));
  };
  function close(): Promise<void> {
    return closing ??= (async () => {
      Deno.removeSignalListener("SIGINT", signal);
      Deno.removeSignalListener("SIGTERM", signal);
      try {
        await service.close();
      } finally {
        await db.close();
      }
    })();
  }
  Deno.addSignalListener("SIGINT", signal);
  Deno.addSignalListener("SIGTERM", signal);
  const runtime = { app, close, maintenance: () => service.maintenance() };
  registry[key] = runtime;
  return runtime;
}
