import { strict as assert } from "node:assert";
import { Window } from "happy-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { Capture } from "../src/components/Capture.tsx";
import { TaskDetail } from "../src/components/TaskDetail.tsx";
import { capture, fixture } from "./fixture.ts";
async function withDOM(
  fn: (root: HTMLElement, window: Window) => Promise<void>,
) {
  const window = new Window({ url: "http://localhost" });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    value: window.document,
    configurable: true,
  });
  const root = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(root as never);
  try {
    await fn(root, window);
  } finally {
    render(null, root);
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
    await window.happyDOM.close();
  }
}
function fill(
  root: HTMLElement,
  window: Window,
  selector: string,
  value: string,
) {
  const input = root.querySelector<HTMLInputElement>(selector)!;
  assert.ok(input);
  input.value = value;
  input.dispatchEvent(
    new window.Event("input", { bubbles: true }) as unknown as Event,
  );
}
Deno.test("mobile quick capture UI saves offline paragraphs with one tap", () =>
  withDOM(async (root, window) => {
    const f = fixture();
    await f.controller.sync();
    f.offline(true);
    await f.controller.sync();
    let id = "";
    await act(() =>
      render(
        <Capture
          controller={f.controller}
          onDone={(value) => id = value}
          onCancel={() => {}}
        />,
        root,
      )
    );
    await act(() =>
      fill(root, window, 'input[aria-label="Title"]', capture.title)
    );
    await act(() => fill(root, window, "textarea", capture.prompt));
    await act(() =>
      void root.querySelector<HTMLFormElement>("form")!.dispatchEvent(
        new window.Event("submit", {
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      )
    );
    assert.equal(f.controller.task(id)?.prompt, capture.prompt);
    assert.equal(f.controller.data.mutations.length, 1);
    const run = [...root.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Run Now")
    )!;
    assert.equal(run.disabled, true);
  }));
Deno.test("mobile Quick Capture Run double tap sends one creation and one action", () =>
  withDOM(async (root, window) => {
    const f = fixture();
    await f.controller.sync();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => finish = resolve);
    await act(() =>
      render(
        <Capture
          controller={f.controller}
          onDone={finish}
          onCancel={() => {}}
        />,
        root,
      )
    );
    await act(() =>
      fill(root, window, 'input[aria-label="Title"]', capture.title)
    );
    await act(() => fill(root, window, "textarea", capture.prompt));
    await act(async () => {
      const button = [...root.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Run Now")
      )!;
      button.click();
      button.click();
      await done;
    });
    assert.equal(f.snapshot.tasks.length, 1);
    assert.equal(f.calls.filter((c) => c.kind === "action").length, 1);
  }));
Deno.test("mobile WAITING_INPUT detail displays assistant context and submits reply once", () =>
  withDOM(async (root, window) => {
    const f = fixture();
    await f.controller.sync();
    const t = f.controller.capture(capture);
    await f.controller.sync();
    f.snapshot.tasks[0].status = "waiting_input";
    const at = new Date().toISOString();
    f.snapshot.executions = [{
      id: "e",
      taskId: t.id,
      deviceId: "mac",
      repositoryId: "repo",
      providerProfileId: "personal",
      sessionId: "s",
      state: "waiting_input",
      dispatchedAt: at,
      autoResume: false,
    }];
    f.snapshot.sessions = [{
      id: "s",
      deviceId: "mac",
      providerProfileId: "personal",
      provider: "codex",
      cwd: "/tmp",
      state: "waiting_input",
      observedAt: at,
      updatedAt: at,
      managed: true,
      origin: "companion",
      availability: "available",
      stale: false,
      lastMessage: "Which format should I use?",
    }];
    await f.controller.sync();
    await act(() =>
      render(
        <TaskDetail
          controller={f.controller}
          task={f.controller.task(t.id)!}
          onBack={() => {}}
          onEdit={() => {}}
          onSession={() => {}}
        />,
        root,
      )
    );
    assert.match(root.textContent!, /Agent needs input/);
    assert.match(root.textContent!, /Which format should I use/);
    await act(() =>
      fill(root, window, "#agent-reply", "Use JSON\nKeep Unicode")
    );
    await act(async () => {
      const button = [...root.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Send reply")
      )!;
      button.click();
      button.click();
      await f.controller.sync();
    });
    assert.equal(f.calls.filter((c) => c.kind === "action").length, 1);
    assert.deepEqual(f.calls.find((c) => c.kind === "action")?.payload, {
      action: "sendPrompt",
      prompt: "Use JSON\nKeep Unicode",
    });
  }));
Deno.test("mobile WAITING_QUOTA shows capacity fallback and real reset only", () =>
  withDOM(async (root) => {
    const f = fixture();
    await f.controller.sync();
    const t = f.controller.capture({ ...capture, autoResume: true });
    await f.controller.sync();
    const task = {
      ...f.controller.task(t.id)!,
      status: "waiting_quota" as const,
      autoResume: true,
    };
    await act(() =>
      render(
        <TaskDetail
          controller={f.controller}
          task={task}
          onBack={() => {}}
          onEdit={() => {}}
          onSession={() => {}}
        />,
        root,
      )
    );
    assert.match(root.textContent!, /Waiting for provider capacity/);
    assert.match(root.textContent!, /Auto-resume enabled/);
    assert.ok(!root.textContent!.includes("%"));
    f.controller.snapshot.profiles[0].quota = {
      state: "exhausted",
      observedAt: new Date().toISOString(),
      resetsAt: "2026-09-07T14:32:00Z",
    };
    await act(() =>
      render(
        <TaskDetail
          controller={f.controller}
          task={task}
          onBack={() => {}}
          onEdit={() => {}}
          onSession={() => {}}
        />,
        root,
      )
    );
    assert.match(root.textContent!, /Resume expected after/);
  }));
