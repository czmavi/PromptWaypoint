import {
  type Execution,
  now,
  type ProviderProfile,
  type Quota,
  type Repository,
  type Session,
  sessionKey,
} from "../../../packages/core/main.ts";
import {
  type AgentEvent,
  type Command,
  type CommandResult,
  parseCommand,
} from "../../../packages/protocol/main.ts";
import {
  type CodingAgentProvider,
  type Observation,
  ProviderError,
} from "../../../packages/provider-types/main.ts";
import { Store } from "./store.ts";
interface Journal {
  command: Command;
  result?: CommandResult;
  phase?: "accepted" | "submitting";
}
export class Agent {
  providers = new Map<string, CodingAgentProvider>();
  listeners = new Set<(event: AgentEvent) => void>();
  private tail: Promise<unknown> = Promise.resolve();
  private subscriptions = new Map<string, () => void>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    public store: Store,
    public factory: (profile: ProviderProfile) => CodingAgentProvider,
    public timeoutMs = 15000,
  ) {}
  private serial<T>(fn: () => Promise<T> | T): Promise<T> {
    const p = this.tail.then(fn);
    this.tail = p.catch(() => {});
    return p;
  }
  private async read<T>(fn: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ProviderError("timeout")),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  emit(type: string, data: unknown) {
    const e = this.store.event(type, data);
    queueMicrotask(() => {
      if (!this.store.get("outbox", e.id)) return;
      for (const listener of this.listeners) {
        try {
          listener(e);
        } catch { /* A disconnected client cannot roll back local state. */ }
      }
    });
  }
  provider(profile: ProviderProfile) {
    let p = this.providers.get(profile.id);
    if (!p) {
      p = this.factory(profile);
      this.providers.set(profile.id, p);
      this.subscriptions.set(
        profile.id,
        p.subscribe((s) => {
          void this.serial(async () => {
            if (s) this.observe(profile, s);
            else await this.refreshProfile(profile);
          }).catch(() => {});
        }),
      );
    }
    return p;
  }
  observe(profile: ProviderProfile, s: Observation): Session {
    const key = sessionKey(profile.id, s.id);
    const old = this.store.get<Session>("sessions", key);
    const repositories = this.store.all<Repository>("repositories").sort((
      a,
      b,
    ) => b.localPath.length - a.localPath.length);
    const repositoryId = repositories.find((r) =>
      s.cwd === r.localPath ||
      s.cwd.startsWith(r.localPath + (Deno.build.os === "windows" ? "\\" : "/"))
    )?.id;
    const session: Session = {
      ...s,
      providerProfileId: profile.id,
      provider: profile.provider,
      repositoryId,
      managed: old?.managed ?? false,
      origin: old?.origin ?? "external",
      taskId: old?.taskId,
    };
    this.store.transaction(() => {
      this.store.put("sessions", key, session);
      this.emit("session", session);
      for (const execution of this.store.all<Execution>("executions")) {
        if (
          execution.providerProfileId !== profile.id ||
          execution.sessionId !== s.id
        ) continue;
        if (["completed", "failed"].includes(execution.state)) continue;
        // An empty prepared session is not proof that a dispatched prompt ran.
        if (execution.state === "dispatching" && !s.turnId) continue;
        if (
          execution.turnId && s.turnId && execution.turnId !== s.turnId &&
          s.state !== "running"
        ) continue;
        execution.state = s.state;
        execution.turnId = s.turnId ?? execution.turnId;
        if (s.state === "running") execution.startedAt ??= now();
        if (["completed", "failed"].includes(s.state)) {
          execution.completedAt = now();
        }
        this.store.put("executions", execution.id, execution);
        this.emit("execution", execution);
      }
    });
    return session;
  }
  private unavailable(profile: ProviderProfile, error: unknown) {
    this.store.put("reconciliation", profile.id, {
      observedAt: now(),
      availability: "provider_unavailable",
      error: error instanceof ProviderError
        ? error.code
        : "provider_unavailable",
    });
    for (
      const s of this.store.all<Session>("sessions").filter((s) =>
        s.providerProfileId === profile.id
      )
    ) {
      this.observe(profile, {
        ...s,
        state: "unknown",
        availability: "provider_unavailable",
      });
    }
  }
  async refreshProfile(profile: ProviderProfile) {
    try {
      const p = this.provider(profile);
      if (p.capabilities.sessionDiscovery) {
        const sessions = await this.read(() => p.list());
        for (const s of sessions) {
          const old = this.store.get<Session>(
            "sessions",
            sessionKey(profile.id, s.id),
          );
          const needsInspect = !old || old.updatedAt !== s.updatedAt ||
            old.state !== s.state || old.availability !== "available" ||
            this.store.all<Execution>("executions").some((e) =>
              e.providerProfileId === profile.id && e.sessionId === s.id &&
              ["dispatching", "unknown"].includes(e.state)
            );
          this.observe(
            profile,
            needsInspect
              ? await this.read(() => p.inspect(s.id))
              : { ...old, observedAt: now() },
          );
        }
        const ids = new Set(sessions.map((s) => s.id));
        for (
          const old of this.store.all<Session>("sessions").filter((s) =>
            s.providerProfileId === profile.id && !ids.has(s.id)
          )
        ) this.observe(profile, await this.read(() => p.inspect(old.id)));
      } else {
        for (
          const old of this.store.all<Session>("sessions").filter((s) =>
            s.providerProfileId === profile.id
          )
        ) this.observe(profile, await this.read(() => p.inspect(old.id)));
      }
      const quota = await this.read(() => p.quota());
      this.store.put("metadata", `quota:${profile.id}`, quota);
      this.emit("quota", { providerProfileId: profile.id, quota });
      this.store.put("reconciliation", profile.id, {
        observedAt: now(),
        availability: "available",
        capabilities: p.capabilities,
      });
    } catch (e) {
      this.unavailable(profile, e);
    }
  }
  refresh(republish = false) {
    return this.serial(async () => {
      for (const p of this.store.all<ProviderProfile>("profiles")) {
        await this.refreshProfile(p);
      }
      // Publish durable execution snapshots after offline desktop drafts reach the server.
      if (republish) {
        for (const execution of this.store.all<Execution>("executions")) {
          this.emit("execution", execution);
        }
      }
    });
  }
  async start(intervalMs = 60000) {
    if (!Number.isFinite(intervalMs) || intervalMs < 100) {
      throw new Error("Invalid reconciliation interval");
    }
    await this.recover();
    await this.refresh();
    await this.autoResume();
    this.timer = setInterval(() => {
      void this.refresh().then(() => this.autoResume()).catch(() => {});
    }, intervalMs);
  }
  command(
    input: unknown,
    accepted: () => void = () => {},
  ): Promise<CommandResult> {
    const c = parseCommand(input);
    return this.serial(() => this.execute(c, accepted));
  }
  private async execute(
    c: Command,
    accepted: () => void,
  ): Promise<CommandResult> {
    const prior = this.store.get<Journal>("commands", c.commandId);
    if (prior) {
      if (JSON.stringify(prior.command) !== JSON.stringify(c)) {
        throw new Error("commandId reused with different payload");
      }
      accepted();
      return prior.result ??
        {
          commandId: c.commandId,
          status: "unknown",
          execution: this.store.get("executions", c.executionId),
          error: "Interrupted command; reconciliation required, never replayed",
        };
    }
    let execution = this.store.get<Execution>("executions", c.executionId);
    if (c.action === "run" && execution) {
      if (
        execution.taskId !== c.taskId ||
        execution.repositoryId !== c.repositoryId ||
        (c.providerProfileId &&
          c.providerProfileId !== execution.providerProfileId)
      ) throw new Error("executionId conflict");
      const result: CommandResult = {
        commandId: c.commandId,
        status: "completed",
        execution,
      };
      this.store.put("commands", c.commandId, { command: c, result });
      accepted();
      return result;
    }
    this.store.put("commands", c.commandId, { command: c, phase: "accepted" });
    accepted();
    let dispatched = false;
    try {
      if (
        c.action === "run" &&
        this.store.all<Execution>("executions").some((e) =>
          e.taskId === c.taskId && !["completed", "failed"].includes(e.state)
        )
      ) {
        throw new Error("Task already has an unfinished execution");
      }
      const repository = this.store.get<Repository>(
        "repositories",
        execution?.repositoryId ?? c.repositoryId ?? "",
      );
      const profileId = execution?.providerProfileId ?? c.providerProfileId ??
        repository?.defaultProviderProfileId;
      const profile = this.store.get<ProviderProfile>(
        "profiles",
        profileId ?? "",
      );
      if (!profile) throw new Error("Provider profile required");
      const p = this.provider(profile);
      if (
        execution && c.providerProfileId &&
        c.providerProfileId !== execution.providerProfileId
      ) throw new Error("Execution profile conflict");
      if (
        execution && c.action !== "run" &&
        ["completed", "failed"].includes(execution.state)
      ) throw new Error("Finished execution requires a new Run");
      if (repository && !(await Deno.stat(repository.localPath)).isDirectory) {
        throw new Error("Workspace unavailable");
      }
      let sessionId = execution?.sessionId ?? c.sessionId;
      let observed: Observation | undefined;
      if (sessionId) {
        observed = await this.read(() => p.inspect(sessionId!));
        this.observe(profile, observed);
        if (
          observed.availability !== "available" || observed.state === "unknown"
        ) throw new ProviderError("provider_unavailable");
        if (observed.state === "running" && c.action !== "stop") {
          const result: CommandResult = {
            commandId: c.commandId,
            status: "completed",
            execution: this.store.get("executions", c.executionId),
          };
          this.store.put("commands", c.commandId, { command: c, result });
          return result;
        }
      } else await this.read(() => p.list());
      if (c.action === "run") {
        if (!repository) throw new Error("Repository required");
        execution = {
          id: c.executionId,
          taskId: c.taskId!,
          deviceId: this.store.device.id,
          repositoryId: repository.id,
          providerProfileId: profile.id,
          state: "dispatching",
          dispatchedAt: now(),
          autoResume: c.autoResume ?? false,
        };
        this.store.transaction(() => {
          this.store.put("executions", execution!.id, execution);
          this.emit("execution", execution);
        });
        observed = await p.prepare(repository.localPath, execution.id);
        sessionId = observed.id;
        execution.sessionId = sessionId;
        this.store.transaction(() => {
          this.store.put("executions", execution!.id, execution);
          this.store.put("sessions", sessionKey(profile.id, sessionId!), {
            ...observed,
            providerProfileId: profile.id,
            provider: profile.provider,
            repositoryId: repository.id,
            managed: true,
            origin: "companion",
            taskId: c.taskId,
          });
        });
      }
      if (!sessionId) throw new Error("Session required");
      if (c.action === "stop") {
        if (!p.capabilities.stop) throw new ProviderError("unsupported");
        this.store.put("commands", c.commandId, {
          command: c,
          phase: "submitting",
        });
        dispatched = true;
        observed = await p.stop(sessionId);
      } else {
        if (
          c.action === "resume" && !p.capabilities.resume ||
          c.action === "sendPrompt" && !p.capabilities.sendPrompt
        ) throw new ProviderError("unsupported");
        this.store.put("commands", c.commandId, {
          command: c,
          phase: "submitting",
        });
        dispatched = true;
        observed = await p.prompt(
          sessionId,
          c.prompt ?? "Continue the interrupted task.",
          c.commandId,
        );
      }
      this.observe(profile, observed);
      const result: CommandResult = {
        commandId: c.commandId,
        status: "completed",
        execution: this.store.get("executions", c.executionId),
      };
      this.store.put("commands", c.commandId, { command: c, result });
      this.emit("commandResult", result);
      return result;
    } catch (e) {
      if (!dispatched && c.action === "run" && execution) {
        execution.state = "failed";
        execution.error = "Prompt was not submitted";
        this.store.put("executions", execution.id, execution);
        this.emit("execution", execution);
      }
      const error = e instanceof ProviderError
        ? e.code
        : e instanceof Error
        ? e.message
        : "Command failed";
      const result: CommandResult = {
        commandId: c.commandId,
        status: dispatched ? "unknown" : "failed",
        taskState: !dispatched && c.action === "run" ? "ready" : undefined,
        error,
        execution: this.store.get("executions", c.executionId),
      };
      this.store.put("commands", c.commandId, { command: c, result });
      this.emit("commandResult", result);
      return result;
    }
  }
  recover() {
    return this.serial(() => {
      for (const journal of this.store.all<Journal>("commands")) {
        if (journal.result || journal.phase !== "accepted") continue;
        const execution = this.store.get<Execution>(
          "executions",
          journal.command.executionId,
        );
        this.store.transaction(() => {
          if (execution?.state === "dispatching") {
            execution.state = "failed";
            execution.error = "Restart before prompt submission";
            this.store.put("executions", execution.id, execution);
            this.emit("execution", execution);
          }
          const result: CommandResult = {
            commandId: journal.command.commandId,
            status: "failed",
            error: "Prompt was not submitted",
            taskState: journal.command.action === "run" ? "ready" : undefined,
            execution,
          };
          this.store.put("commands", journal.command.commandId, {
            ...journal,
            result,
          });
          this.emit("commandResult", result);
        });
      }
    });
  }
  async autoResume() {
    for (const e of this.store.all<Execution>("executions")) {
      const profile = this.store.get<ProviderProfile>(
        "profiles",
        e.providerProfileId,
      );
      if (
        e.state !== "waiting_quota" || !e.autoResume || !profile?.autoResume ||
        !this.provider(profile).capabilities.quotaInspection
      ) continue;
      const quota = this.store.get<Quota>("metadata", `quota:${profile.id}`);
      if (
        quota?.state !== "available" ||
        Date.now() - Date.parse(quota.observedAt) > this.timeoutMs
      ) continue;
      await this.command({
        action: "resume",
        commandId: `quota:${e.id}:${e.turnId ?? e.dispatchedAt}`,
        executionId: e.id,
      });
    }
  }
  async close() {
    clearInterval(this.timer);
    await this.tail;
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    await Promise.all([...this.providers.values()].map((p) => p.close()));
  }
}
