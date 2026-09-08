import { now, type Quota } from "../../../../packages/core/main.ts";
import {
  type CodingAgentProvider,
  type Observation,
  ProviderError,
} from "../../../../packages/provider-types/main.ts";
export class FakeCodingAgentProvider implements CodingAgentProvider {
  capabilities = {
    sessionDiscovery: true,
    resume: true,
    sendPrompt: true,
    stop: true,
    liveSteering: false,
    quotaInspection: true,
    quotaResetTime: true,
    completionEvents: true,
  };
  sessions = new Map<string, Observation>();
  quotaState: Quota = { state: "available", observedAt: now() };
  prompts = 0;
  prepares = 0;
  inspections = 0;
  error?: "timeout" | "provider_unavailable";
  crashAfterPrompt = false;
  onPrepare?: () => void;
  private listeners = new Set<(s?: Observation) => void>();
  private check() {
    if (this.error) throw new ProviderError(this.error);
  }
  list() {
    this.check();
    return Promise.resolve(
      [...this.sessions.values()].map((s) => structuredClone(s)),
    );
  }
  inspect(id: string) {
    this.check();
    this.inspections++;
    const s = this.sessions.get(id);
    if (!s) throw new ProviderError("provider_unavailable");
    return Promise.resolve({ ...s, observedAt: now() });
  }
  external(id: string = crypto.randomUUID(), cwd = "/tmp") {
    const s: Observation = {
      id,
      cwd,
      state: "waiting_input",
      availability: "available",
      observedAt: now(),
      updatedAt: now(),
    };
    this.sessions.set(id, s);
    return s;
  }
  prepare(cwd: string, _executionId: string) {
    this.check();
    this.prepares++;
    this.onPrepare?.();
    return Promise.resolve(this.external(crypto.randomUUID(), cwd));
  }
  async prompt(id: string, _prompt: string, _commandId: string) {
    this.check();
    this.prompts++;
    const s = {
      ...await this.inspect(id),
      state: "running" as const,
      turnId: crypto.randomUUID(),
      updatedAt: now(),
    };
    this.sessions.set(id, s);
    if (this.crashAfterPrompt) throw new ProviderError("timeout");
    return s;
  }
  async stop(id: string) {
    const s = { ...await this.inspect(id), state: "waiting_input" as const };
    this.sessions.set(id, s);
    return s;
  }
  quota() {
    this.check();
    return Promise.resolve({ ...this.quotaState, observedAt: now() });
  }
  event(id: string, state: Observation["state"]) {
    const s = { ...this.sessions.get(id)!, state, updatedAt: now() };
    this.sessions.set(id, s);
    for (const listener of this.listeners) listener(s);
  }
  subscribe(listener: (s?: Observation) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  close() {
    return Promise.resolve();
  }
}
