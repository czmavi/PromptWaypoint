import type {
  PushRegistration,
  ServerDevice,
  ServerSnapshot,
  Task,
  User,
} from "../core/main.ts";
import type {
  ActionResult,
  StoredCommand,
  TaskAction,
  TaskInput,
  TaskPatch,
} from "../protocol/main.ts";
import type { TaskBatchInput } from "../protocol/batch.ts";
export class ServerApiError extends Error {
  constructor(public status: number, public detail?: string) {
    super(`Server API ${status}`);
  }
}
export class ServerClient {
  constructor(
    private baseUrl: string,
    private token: string,
    private transport: typeof fetch = fetch,
  ) {}
  private async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ): Promise<T> {
    const response = await this.transport(new URL(path, this.baseUrl), {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      let detail: string | undefined;
      if (response.status < 500) {
        try {
          const body = await response.json();
          if (typeof body.error === "string") detail = body.error.slice(0, 500);
        } catch { /* Non-JSON errors remain status-only. */ }
      } else await response.body?.cancel();
      throw new ServerApiError(response.status, detail);
    }
    return response.json();
  }
  login(secret: string): Promise<{ user: User; token: string }> {
    return this.request("/api/auth/dev-login", "POST", { secret });
  }
  logout(): Promise<{ ok: boolean }> {
    return this.request("/api/auth/logout", "POST");
  }
  snapshot(): Promise<ServerSnapshot> {
    return this.request("/api/snapshot");
  }
  registerDevice(
    device: Pick<ServerDevice, "id" | "name" | "platform">,
  ): Promise<{ device: ServerDevice; token: string }> {
    return this.request("/api/devices", "POST", device);
  }
  rotateDeviceToken(deviceId: string): Promise<{ token: string }> {
    return this.request(
      `/api/devices/${encodeURIComponent(deviceId)}/token`,
      "POST",
    );
  }
  revokeDeviceToken(deviceId: string): Promise<{ ok: boolean }> {
    return this.request(
      `/api/devices/${encodeURIComponent(deviceId)}/token`,
      "DELETE",
    );
  }
  createTask(task: TaskInput, key: string): Promise<Task> {
    return this.request("/api/tasks", "POST", task, key);
  }
  createTasks(
    input: TaskBatchInput,
    key: string,
  ): Promise<{ tasks: Task[]; references: Record<string, string> }> {
    return this.request("/api/tasks/batch", "POST", input, key);
  }
  editTask(taskId: string, patch: TaskPatch, key: string): Promise<Task> {
    return this.request(
      `/api/tasks/${encodeURIComponent(taskId)}`,
      "PATCH",
      patch,
      key,
    );
  }
  deleteTask(taskId: string, key: string): Promise<{ ok: boolean }> {
    return this.request(
      `/api/tasks/${encodeURIComponent(taskId)}`,
      "DELETE",
      undefined,
      key,
    );
  }
  task(taskId: string): Promise<Task> {
    return this.request(`/api/tasks/${encodeURIComponent(taskId)}`);
  }
  action(
    taskId: string,
    action: TaskAction,
    key: string,
  ): Promise<ActionResult> {
    return this.request(
      `/api/tasks/${encodeURIComponent(taskId)}/actions`,
      "POST",
      action,
      key,
    );
  }
  dependencies(
    taskId: string,
    dependsOn: string[],
    key: string,
  ): Promise<{ taskId: string; dependsOn: string[] }> {
    return this.request(
      `/api/tasks/${encodeURIComponent(taskId)}/dependencies`,
      "PUT",
      { dependsOn },
      key,
    );
  }
  commands(): Promise<StoredCommand[]> {
    return this.request("/api/commands");
  }
  registerPush(
    registration: PushRegistration,
    key: string,
  ): Promise<Pick<PushRegistration, "id" | "platform">> {
    return this.request("/api/push-registrations", "POST", registration, key);
  }
  removePush(id: string, key: string): Promise<{ ok: boolean }> {
    return this.request(
      `/api/push-registrations/${encodeURIComponent(id)}`,
      "DELETE",
      undefined,
      key,
    );
  }
  // fetch-based SSE supports Authorization on desktop/mobile; each change triggers one shared snapshot refresh.
  async subscribe(onChange: () => void, signal: AbortSignal): Promise<void> {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const response = await this.transport(
          new URL("/api/events", this.baseUrl),
          { headers: { Authorization: `Bearer ${this.token}` }, signal },
        );
        if (response.status === 401) throw new Error("Authentication expired");
        if (!response.ok || !response.body) {
          throw new Error("Realtime unavailable");
        }
        attempt = 0;
        let buffer = "";
        for await (
          const chunk of response.body.pipeThrough(new TextDecoderStream())
        ) {
          buffer += chunk;
          if (buffer.length > 1000000) {
            throw new Error("Invalid realtime frame");
          }
          let index: number;
          while ((index = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            if (frame.startsWith("event:")) onChange();
          }
        }
      } catch (error) {
        if (signal.aborted) return;
        if (
          error instanceof Error && error.message === "Authentication expired"
        ) throw error;
      }
      if (signal.aborted) return;
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(
          finish,
          Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)),
        );
        signal.addEventListener("abort", finish, { once: true });
      });
    }
  }
}
