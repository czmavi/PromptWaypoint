import { strict as assert } from "node:assert";
import { Window } from "happy-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { Editor } from "../src/components/Editor.tsx";
import { draft, fixture } from "./fixture.ts";
import { QuotaDisplay, StatusBadge } from "../../../packages/ui/main.ts";
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
  assert.ok(input, selector);
  input.value = value;
  input.dispatchEvent(
    new window.Event("input", { bubbles: true }) as unknown as Event,
  );
}
Deno.test("quick capture saves multiline idea from the UI and edits it without duplication", () =>
  withDOM(async (root, window) => {
    const f = fixture();
    await f.controller.refresh();
    let closed = 0;
    await act(() =>
      render(
        <Editor controller={f.controller} quick onClose={() => closed++} />,
        root,
      )
    );
    await act(() =>
      fill(root, window, 'input[aria-label="Title"]', draft.title)
    );
    await act(() => fill(root, window, "textarea", draft.prompt));
    await act(async () => {
      root.querySelector<HTMLFormElement>("form")!.dispatchEvent(
        new window.Event("submit", {
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
      await Promise.resolve();
    });
    assert.equal(closed, 1);
    assert.equal(f.controller.tasks[0].prompt, draft.prompt);
    const task = f.controller.tasks[0];
    await act(() =>
      render(
        <Editor
          key="edit"
          controller={f.controller}
          task={task}
          onClose={() => closed++}
        />,
        root,
      )
    );
    await act(() =>
      fill(root, window, 'input[aria-label="Title"]', "Edited in UI")
    );
    await act(async () => {
      root.querySelector<HTMLFormElement>("form")!.dispatchEvent(
        new window.Event("submit", {
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
      await Promise.resolve();
    });
    assert.equal(f.controller.tasks.length, 1);
    assert.equal(f.controller.tasks[0].title, "Edited in UI");
  }));
Deno.test("quick capture Run button double click creates one task and one execution", () =>
  withDOM(async (root, window) => {
    const f = fixture();
    await f.controller.refresh();
    let done!: () => void;
    const finished = new Promise<void>((resolve) => done = resolve);
    await act(() =>
      render(<Editor controller={f.controller} quick onClose={done} />, root)
    );
    await act(() =>
      fill(root, window, 'input[aria-label="Title"]', draft.title)
    );
    await act(() => fill(root, window, "textarea", draft.prompt));
    await act(async () => {
      const button = [...root.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Run Now")
      )!;
      button.click();
      button.click();
      await finished;
    });
    assert.equal(f.controller.tasks.length, 1);
    assert.equal(f.commands.length, 1);
  }));
Deno.test("quota and waiting badges render truthful labels without invented percentages", () =>
  withDOM(async (root) => {
    await act(() =>
      render(
        <>
          <QuotaDisplay
            quota={{ state: "unknown", observedAt: new Date().toISOString() }}
          />
          <StatusBadge status="waiting_input" />
          <StatusBadge status="waiting_quota" />
        </>,
        root,
      )
    );
    assert.match(root.textContent!, /Quota state unknown/);
    assert.match(root.textContent!, /Needs input/);
    assert.match(root.textContent!, /Waiting for quota/);
    assert.ok(!root.textContent!.includes("%"));
  }));
