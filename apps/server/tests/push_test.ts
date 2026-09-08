import { ok, rejects, strictEqual as equal } from "node:assert/strict";
import { ApnsPushProvider, FcmPushProvider } from "../src/push/providers.ts";
import type { Notification } from "../../../packages/core/main.ts";
const notification: Notification = {
  kind: "waiting_input",
  taskId: "task",
  sessionId: "session",
  deviceId: "mac",
  providerProfileId: "profile",
  deepLink: "pmai://tasks/task",
};
Deno.test("APNS adapter sends alert and task/session deep link", async () => {
  let called = false;
  const provider = new ApnsPushProvider(
    "com.pmai.app",
    () => Promise.resolve("fixture-bearer"),
    true,
    (url, init) => {
      called = true;
      ok(
        String(url).startsWith("https://api.sandbox.push.apple.com/3/device/"),
      );
      equal(new Headers(init?.headers).get("apns-push-type"), "alert");
      const payload = JSON.parse(init?.body as string);
      equal(payload.deepLink, notification.deepLink);
      equal(payload.sessionId, "session");
      equal(payload.aps.alert.title, "Agent needs input");
      return Promise.resolve(new Response(null, { status: 200 }));
    },
  );
  await provider.send({
    id: "phone",
    platform: "apns",
    token: "fixture-device",
  }, notification);
  ok(called);
});
Deno.test("FCM adapter uses v1 envelope and retries provider errors through rejection", async () => {
  const provider = new FcmPushProvider(
    "project",
    () => Promise.resolve("fixture-token"),
    (url, init) => {
      equal(
        String(url),
        "https://fcm.googleapis.com/v1/projects/project/messages:send",
      );
      const body = JSON.parse(init?.body as string);
      equal(body.message.data.taskId, "task");
      equal(body.message.token, "device-token");
      return Promise.resolve(new Response(null, { status: 503 }));
    },
  );
  await rejects(() =>
    provider.send(
      { id: "phone", platform: "fcm", token: "device-token" },
      notification,
    )
  );
});
