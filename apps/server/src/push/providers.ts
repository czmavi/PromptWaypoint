import type {
  Notification,
  PushRegistration,
} from "../../../../packages/core/main.ts";
export interface PushProvider {
  send(
    registration: PushRegistration,
    notification: Notification,
  ): Promise<void>;
}
const titles = {
  completed: "Task completed",
  failed: "Task failed",
  waiting_input: "Agent needs input",
  resumed: "Task resumed after quota reset",
};
export class ApnsPushProvider implements PushProvider {
  constructor(
    private topic: string,
    private bearer: () => Promise<string>,
    private sandbox = false,
    private transport: typeof fetch = fetch,
  ) {}
  async send(registration: PushRegistration, notification: Notification) {
    const response = await this.transport(
      `https://${
        this.sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com"
      }/3/device/${encodeURIComponent(registration.token)}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          authorization: `bearer ${await this.bearer()}`,
          "apns-topic": this.topic,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          aps: {
            alert: { title: titles[notification.kind] },
            sound: "default",
          },
          ...notification,
        }),
      },
    );
    await response.body?.cancel();
    if (!response.ok) throw new Error(`APNS ${response.status}`);
  }
}
export class FcmPushProvider implements PushProvider {
  constructor(
    private project: string,
    private accessToken: () => Promise<string>,
    private transport: typeof fetch = fetch,
  ) {}
  async send(registration: PushRegistration, notification: Notification) {
    const response = await this.transport(
      `https://fcm.googleapis.com/v1/projects/${
        encodeURIComponent(this.project)
      }/messages:send`,
      {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          authorization: `Bearer ${await this.accessToken()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: registration.token,
            notification: { title: titles[notification.kind] },
            data: Object.fromEntries(
              Object.entries(notification).filter(([, v]) => v !== undefined),
            ),
          },
        }),
      },
    );
    await response.body?.cancel();
    if (!response.ok) throw new Error(`FCM ${response.status}`);
  }
}
