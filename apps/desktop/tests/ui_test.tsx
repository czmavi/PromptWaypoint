import { strict as assert } from "node:assert";
import { Window } from "happy-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { Editor } from "../src/components/Editor.tsx";
import { RepositoryForm } from "../src/components/RepositoryForm.tsx";
import { ProfileDiscovery } from "../src/components/ProfileDiscovery.tsx";
import { type UpdateBridge, Updates } from "../src/components/Updates.tsx";
import type {
  DiscoveredProviderProfile,
  ProviderProfile,
} from "../../../packages/core/main.ts";
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
Deno.test("updater deduplicates installation and restores the controller after a refused update", () =>
  withDOM(async (root) => {
    const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    let starts = 0;
    let stops = 0;
    let installs = 0;
    let reject!: (error: Error) => void;
    const bridge: UpdateBridge = {
      enabled: true,
      check: () =>
        Promise.resolve({
          version: "0.3.0",
          notes: "<script>untrusted</script>",
        }),
      install: () => {
        installs++;
        return new Promise((_, fail) => reject = fail);
      },
    };
    await act(async () => {
      render(
        <Updates
          bridge={bridge}
          controller={{
            start: () => {
              starts++;
              return Promise.resolve();
            },
            stop: () => {
              stops++;
            },
          }}
        />,
        root,
      );
      await flush();
    });
    await act(flush);
    assert.match(root.textContent!, /Version 0.3.0 is available/);
    assert.equal(root.querySelector("script"), null);
    await act(() => {
      const button = root.querySelector<HTMLButtonElement>("button.primary")!;
      button.click();
      button.click();
    });
    assert.equal(installs, 1);
    assert.equal(stops, 1);
    await act(async () => {
      reject(new Error("Finish or stop active tasks before updating"));
      await flush();
    });
    assert.equal(starts, 1);
    assert.match(root.textContent!, /Finish or stop active tasks/);
    assert.equal(
      root.querySelector<HTMLButtonElement>("button.primary")!.disabled,
      false,
    );
  }));
Deno.test("profile discovery scans on open, retries failures and imports a candidate only once", () =>
  withDOM(async (root) => {
    const candidate: DiscoveredProviderProfile = {
      provider: "codex",
      name: "Codex — Default",
      configDirectory: "/tmp/codex",
      source: "default",
    };
    const added: Omit<ProviderProfile, "id">[] = [];
    let failScan = true;
    let failAdd = true;
    let scans = 0;
    let refreshes = 0;
    const api = {
      discoverProfiles: () => {
        scans++;
        return failScan
          ? Promise.reject(new Error("offline"))
          : Promise.resolve({
            profiles: added.length ? [] : [candidate],
            warnings: [],
          });
      },
      addProfile: (profile: Omit<ProviderProfile, "id">) => {
        if (failAdd) return Promise.reject(new Error("offline"));
        added.push(profile);
        return Promise.resolve({ id: "new", ...profile });
      },
    };
    const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    await act(() => {
      render(
        <ProfileDiscovery
          api={api}
          online
          profilesVersion=""
          onAdded={() => {
            refreshes++;
            return Promise.resolve();
          }}
        />,
        root,
      );
    });
    await act(flush);
    assert.equal(scans, 1);
    assert.match(root.textContent!, /Could not discover profiles/);
    failScan = false;
    await act(() => {
      root.querySelector<HTMLButtonElement>("button")!.click();
    });
    await act(flush);
    assert.match(root.textContent!, /Codex — Default/);
    assert.match(root.textContent!, /have not been checked/);
    const add = () =>
      root.querySelector<HTMLButtonElement>(
        'button[aria-label="Add Codex — Default"]',
      )!.click();
    await act(async () => {
      add();
      await flush();
    });
    assert.match(root.textContent!, /Could not add this profile/);
    assert.equal(added.length, 0);
    failAdd = false;
    await act(async () => {
      add();
      add();
      await flush();
    });
    await act(flush);
    assert.deepEqual(added, [{
      provider: "codex",
      name: candidate.name,
      configDirectory: candidate.configDirectory,
      autoResume: false,
    }]);
    assert.equal(refreshes, 1);
    assert.match(root.textContent!, /No new profiles found/);
  }));

Deno.test("profile discovery does not scan offline and discards results from a disconnected agent", () =>
  withDOM(async (root) => {
    let scans = 0;
    let resolve!: (
      value: { profiles: DiscoveredProviderProfile[]; warnings: string[] },
    ) => void;
    const api = {
      discoverProfiles: () => {
        scans++;
        return new Promise<
          { profiles: DiscoveredProviderProfile[]; warnings: string[] }
        >((done) => resolve = done);
      },
      addProfile: (
        _profile: Omit<ProviderProfile, "id">,
      ): Promise<ProviderProfile> => Promise.reject(new Error("unused")),
    };
    const show = (online: boolean) =>
      render(
        <ProfileDiscovery
          api={api}
          online={online}
          profilesVersion=""
          onAdded={() => Promise.resolve()}
        />,
        root,
      );
    await act(() => show(false));
    assert.equal(scans, 0);
    assert.match(root.textContent!, /Connect the Local Agent/);
    await act(() => show(true));
    assert.equal(scans, 1);
    await act(() => show(false));
    await act(async () => {
      resolve({
        profiles: [{
          provider: "codex",
          name: "Stale profile",
          configDirectory: "/old",
          source: "default",
        }],
        warnings: [],
      });
      await Promise.resolve();
    });
    assert.ok(!root.textContent!.includes("Stale profile"));
    assert.match(root.textContent!, /Connect the Local Agent/);
  }));
Deno.test("repository picker preserves cancellation and custom names, and submits the selected absolute path", () =>
  withDOM(async (root, window) => {
    let selection: string | null = null;
    const defaults: (string | undefined)[] = [];
    const added: { name: string; localPath: string }[] = [];
    await act(() =>
      render(
        <RepositoryForm
          disabled={false}
          pickDirectory={(path) => {
            defaults.push(path);
            return Promise.resolve(selection);
          }}
          onAdd={(repository) => {
            added.push(repository);
            return Promise.resolve();
          }}
        />,
        root,
      )
    );
    const choose = () =>
      root.querySelector<HTMLButtonElement>('button[type="button"]')!.click();
    const path = () =>
      root.querySelector<HTMLInputElement>('input[name="path"]')!;
    const name = () =>
      root.querySelector<HTMLInputElement>('input[name="name"]')!;
    const submit = () =>
      root.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    assert.ok(path().readOnly);
    await act(async () => {
      choose();
      await Promise.resolve();
    });
    assert.equal(path().value, "");
    assert.ok(submit().disabled);
    selection = "/Users/developer/Projects/My Project";
    await act(async () => {
      choose();
      await Promise.resolve();
    });
    assert.equal(name().value, "My Project");
    assert.equal(path().value, selection);
    await act(() => fill(root, window, 'input[name="name"]', "Custom name"));
    selection = null;
    await act(async () => {
      choose();
      await Promise.resolve();
    });
    assert.equal(path().value, "/Users/developer/Projects/My Project");
    assert.equal(name().value, "Custom name");
    selection = "/Users/developer/Projects/Another project";
    await act(async () => {
      choose();
      await Promise.resolve();
    });
    assert.equal(defaults.at(-1), "/Users/developer/Projects/My Project");
    assert.equal(name().value, "Custom name");
    await act(async () => {
      submit().click();
      await Promise.resolve();
    });
    assert.deepEqual(added, [{ name: "Custom name", localPath: selection }]);
    assert.equal(path().value, "");
    assert.equal(name().value, "");
    assert.ok(submit().disabled);
  }));

Deno.test("repository picker reports failures, retains the selection for retry and prevents duplicate submissions", () =>
  withDOM(async (root) => {
    let pickerFails = true;
    let attempts = 0;
    await act(() =>
      render(
        <RepositoryForm
          disabled={false}
          pickDirectory={() =>
            pickerFails
              ? Promise.reject(new Error("Folder dialog unavailable"))
              : Promise.resolve("/tmp/project")}
          onAdd={() => {
            attempts++;
            return Promise.reject(new Error("Agent unavailable"));
          }}
        />,
        root,
      )
    );
    const choose = () =>
      root.querySelector<HTMLButtonElement>('button[type="button"]')!.click();
    await act(async () => {
      choose();
      await Promise.resolve();
    });
    assert.match(
      root.querySelector('[role="alert"]')!.textContent!,
      /Folder dialog unavailable/,
    );
    pickerFails = false;
    await act(async () => {
      choose();
      await Promise.resolve();
    });
    assert.equal(root.querySelector('[role="alert"]'), null);
    await act(async () => {
      const submit = root.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )!;
      submit.click();
      submit.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(attempts, 1);
    assert.match(
      root.querySelector('[role="alert"]')!.textContent!,
      /Agent unavailable/,
    );
    assert.equal(
      root.querySelector<HTMLInputElement>('input[name="path"]')!.value,
      "/tmp/project",
    );
  }));
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
