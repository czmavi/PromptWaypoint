import type {
  Device,
  Execution,
  ProviderProfile,
  Repository,
  Session,
} from "../core/main.ts";
import type { Command, CommandResult } from "../protocol/main.ts";
import type { ProviderCapabilities } from "../provider-types/main.ts";
export interface LocalState {
  device: Device;
  repositories: Repository[];
  profiles: (ProviderProfile & { capabilities: ProviderCapabilities })[];
  sessions: Session[];
  executions: Execution[];
}
export class LocalAgentClient {
  constructor(
    private baseUrl: string,
    private token: string,
    private transport: typeof fetch = fetch,
  ) {}
  private async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const r = await this.transport(new URL(path, this.baseUrl), {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Local Agent: ${r.status}`);
    return r.json();
  }
  state(): Promise<LocalState> {
    return this.request<LocalState>("/state");
  }
  command(command: Command): Promise<CommandResult> {
    return this.request<CommandResult>("/commands", "POST", command);
  }
  refresh(): Promise<unknown> {
    return this.request("/refresh", "POST");
  }
  addRepository(
    repository: Pick<
      Repository,
      "name" | "localPath" | "defaultProviderProfileId"
    >,
  ): Promise<Repository> {
    return this.request<Repository>("/repositories", "POST", repository);
  }
  addProfile(profile: Omit<ProviderProfile, "id">): Promise<ProviderProfile> {
    return this.request<ProviderProfile>("/profiles", "POST", profile);
  }
  updateProfile(
    id: string,
    patch: Partial<Pick<ProviderProfile, "name" | "autoResume">>,
  ): Promise<ProviderProfile> {
    return this.request<ProviderProfile>(
      `/profiles/${encodeURIComponent(id)}`,
      "PATCH",
      patch,
    );
  }
  updateRepository(
    id: string,
    patch: { name?: string; defaultProviderProfileId?: string | null },
  ): Promise<Repository> {
    return this.request<Repository>(
      `/repositories/${encodeURIComponent(id)}`,
      "PATCH",
      patch,
    );
  }
  removeRepository(id: string): Promise<unknown> {
    return this.request(`/repositories/${encodeURIComponent(id)}`, "DELETE");
  }
  removeProfile(id: string): Promise<unknown> {
    return this.request(`/profiles/${encodeURIComponent(id)}`, "DELETE");
  }
  events(): WebSocket {
    const url = new URL("/events", this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return new WebSocket(url, ["pmai-events", `pmai-auth.${this.token}`]);
  }
}
export { ServerClient } from "./server.ts";
