const columns = [
  {
    status: "Running",
    tone: "running",
    tasks: [[
      "Add Keychain auth",
      "Codex · MacBook Air",
      "Working in a fresh session",
    ]],
  },
  {
    status: "Waiting",
    tone: "waiting",
    tasks: [[
      "Model downloader",
      "Claude Code · Desktop",
      "Waiting for provider capacity",
    ]],
  },
  {
    status: "Ready",
    tone: "ready",
    tasks: [[
      "Detect available RAM",
      "Codex · MacBook Air",
      "Ready for a focused run",
    ], ["Recommend a model", "Claude Code · Desktop", "Prompt saved"]],
  },
  {
    status: "Inbox",
    tone: "inbox",
    tasks: [["Multi-account login", "Datovka", "An idea for later"], [
      "Improve onboarding",
      "Datovka",
      "Prompt saved",
    ]],
  },
];

export function ProductPreview() {
  return (
    <figure
      class="product-preview"
      aria-label="Illustrative PM.ai task board, with sample tasks"
    >
      <div class="preview-toolbar">
        <span class="wordmark">
          PM<span>.ai</span>
        </span>
        <span class="toolbar-path">
          Workspace / <strong>Datovka</strong>
        </span>
        <span class="sample-label">Product preview</span>
      </div>
      <div class="board-heading">
        <div>
          <span class="eyebrow">YOUR NEXT SHIP STARTS HERE</span>
          <h2>Small tasks. Real progress.</h2>
        </div>
        <span class="device-pill">● MacBook Air · Online</span>
      </div>
      <div class="board">
        {columns.map((column) => (
          <section
            class={`board-column ${column.tone}`}
            key={column.status}
            aria-label={column.status}
          >
            <h3>
              <span class="status-dot" />
              {column.status}
              <span class="count">{column.tasks.length}</span>
            </h3>
            {column.tasks.map(([title, provider, note]) => (
              <article class="task-card" key={title}>
                <span class="task-marker" aria-hidden="true">
                  {column.tone === "running"
                    ? "↗"
                    : column.tone === "waiting"
                    ? "Ⅱ"
                    : "◇"}
                </span>
                <h4>{title}</h4>
                <p>{note}</p>
                <div class="task-meta">{provider}</div>
              </article>
            ))}
          </section>
        ))}
      </div>
      <figcaption>
        <span>One task. One clear instruction.</span>
        <span>Inbox → Ready → Queued → Running → Waiting → Done</span>
      </figcaption>
    </figure>
  );
}

export function PhonePreview() {
  return (
    <figure
      class="phone"
      aria-label="Illustrative mobile app with sample device and task counts"
    >
      <div class="phone-top" aria-hidden="true">
        <span>9:41</span>
        <span>● ▰</span>
      </div>
      <div class="phone-title">
        <span class="wordmark">
          PM<span>.ai</span>
        </span>
        <span class="avatar">M</span>
      </div>
      <p class="phone-greeting">Your work, in motion.</p>
      <div class="phone-stats">
        <div>
          <strong>2</strong>Running
        </div>
        <div>
          <strong>1</strong>Waiting
        </div>
        <div>
          <strong>8</strong>Ready
        </div>
      </div>
      <h3 class="eyebrow">DEVICES</h3>
      <div class="phone-device">
        <span>
          MacBook Air<small>2 repositories</small>
        </span>
        <span class="online">● Online</span>
      </div>
      <div class="phone-device">
        <span>
          DGX Spark<small>1 repository</small>
        </span>
        <span class="online">● Online</span>
      </div>
      <div class="phone-alert">
        <span class="eyebrow">AGENT NEEDS INPUT</span>
        <strong>Choose the sign-in flow</strong>
        <p>Datovka · Claude Code</p>
        <span>Reply and keep things moving ↗</span>
      </div>
      <div class="mock-button">+ New Task</div>
      <figcaption>Mobile product preview</figcaption>
    </figure>
  );
}

export function ArchitecturePreview() {
  return (
    <figure
      class="architecture"
      aria-label="Mobile and desktop connect to the PM.ai server. The server relays commands to the local agent, which runs Codex or Claude against local repositories."
    >
      <div class="architecture-clients">
        <div>Mobile app</div>
        <div>Desktop app</div>
      </div>
      <div class="connector">
        ↕ <span>Task content & status</span>
      </div>
      <div class="server-node">
        <strong>PM.ai Server</strong>
        <span>Sync · command relay · push</span>
      </div>
      <div class="connector">
        ↕ <span>Commands & execution updates</span>
      </div>
      <div class="local-boundary">
        <span class="eyebrow">ON EACH OF YOUR MACHINES</span>
        <div class="agent-node">Local PM.ai Agent</div>
        <div class="connector" aria-hidden="true">↓</div>
        <div class="providers">
          <span>Codex</span>
          <span>Claude Code</span>
        </div>
        <div class="connector" aria-hidden="true">↕</div>
        <div class="repo-node">Local repositories</div>
      </div>
      <figcaption>Simplified orchestration flow</figcaption>
    </figure>
  );
}
