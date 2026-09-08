import type { ComponentChildren, JSX } from "preact";
import type { Quota, TaskStatus } from "../core/main.ts";
export const statusLabels: Record<TaskStatus, string> = {
  inbox: "Inbox",
  ready: "Ready",
  queued: "Queued",
  dispatching: "Starting",
  running: "Running",
  waiting_input: "Needs input",
  waiting_quota: "Waiting for quota",
  completed: "Done",
  failed: "Failed",
  unknown: "Unknown",
};
export function StatusBadge({ status }: { status: TaskStatus }): JSX.Element {
  return (
    <span class={`status-badge status-${status}`}>
      <span aria-hidden="true" class="status-dot" />
      {statusLabels[status]}
    </span>
  );
}
export function ProviderBadge(
  { provider, name }: { provider?: string; name?: string },
): JSX.Element {
  return (
    <span class="provider-badge">
      <span class="provider-mark" aria-hidden="true">
        {provider === "claude" ? "✳" : "◎"}
      </span>
      {name ?? (provider === "claude" ? "Claude" : "Codex")}
    </span>
  );
}
export function QuotaDisplay(
  { quota, available }: { quota?: Quota; available?: boolean },
): JSX.Element {
  return (
    <span class="quota-display">
      {quota?.state === "exhausted"
        ? "Waiting for provider capacity"
        : quota?.usedPercent !== undefined
        ? `${quota.usedPercent}% used`
        : available === false
        ? "Provider unavailable"
        : quota?.state === "available"
        ? "Available"
        : "Quota state unknown"}
      {quota?.resetsAt && (
        <small>
          Resets {new Date(quota.resetsAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </small>
      )}
    </span>
  );
}
export function DeviceStatus(
  { name, online, local = false }: {
    name: string;
    online: boolean;
    local?: boolean;
  },
): JSX.Element {
  return (
    <span class="device-status">
      <span class={`presence ${online ? "online" : ""}`} aria-hidden="true" />
      {name}
      {local && <small>This device</small>}
      <span class="sr-only">{online ? "online" : "offline"}</span>
    </span>
  );
}
export function TaskPrompt({ prompt }: { prompt: string }): JSX.Element {
  return <div class="task-prompt">{prompt}</div>;
}
export function TaskCard(
  { title, status, selected = false, onSelect, children }: {
    title: string;
    status: TaskStatus;
    selected?: boolean;
    onSelect: () => void;
    children?: ComponentChildren;
  },
): JSX.Element {
  return (
    <button
      type="button"
      class={`task-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span class={`task-check task-check-${status}`} aria-hidden="true">
        {status === "completed" ? "✓" : status === "running" ? "↗" : ""}
      </span>
      <span class="task-card-content">
        <strong>{title}</strong>
        <span class="task-card-meta">{children}</span>
      </span>
      <StatusBadge status={status} />
    </button>
  );
}
