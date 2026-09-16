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
  private cached?: { revision: string; snapshot: ServerSnapshot };
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
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.transport(new URL(path, this.baseUrl), {
      method,
      signal,
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
  async snapshot(): Promise<ServerSnapshot> {
    const { revision } = await this.revision();
    if (this.cached?.revision === revision) return this.cached.snapshot;
    const snapshot = await this.request<ServerSnapshot>("/api/snapshot");
    this.cached = { revision, snapshot };
    return snapshot;
  }
  async revision(signal?: AbortSignal): Promise<{ revision: string }> {
    const response = await this.request<{ revision: string }>(
      "/api/revision",
      "GET",
      undefined,
      undefined,
      signal,
    );
    if (typeof response.revision !== "string" || !response.revision) {
      throw new Error("Invalid server revision");
    }
    return response;
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
  // Each check can reach a different server instance. Revision is durable in PG.
  async subscribe(
    onChange: () => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    let previous: string | undefined;
    let attempt = 0;
    while (!signal.aborted) {
      let delay = 4000;
      try {
        const { revision } = await this.revision(
          AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        );
        if (signal.aborted) return;
        if (previous !== revision) {
          await onChange();
          previous = revision;
        }
        attempt = 0;
      } catch (error) {
        if (signal.aborted) return;
        if (
          error instanceof ServerApiError && [401, 403].includes(error.status)
        ) throw error;
        delay = Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5));
      }
      if (signal.aborted) return;
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, delay);
        signal.addEventListener("abort", finish, { once: true });
      });
    }
  }
}
