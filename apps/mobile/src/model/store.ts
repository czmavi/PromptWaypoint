import type {
  PushRegistration,
  ServerSnapshot,
  Task,
} from "../../../../packages/core/main.ts";
import type {
  TaskAction,
  TaskInput,
  TaskPatch,
} from "../../../../packages/protocol/main.ts";
export type Mutation =
  & { id: string; taskId: string; error?: string; attempted?: boolean }
  & ({ kind: "create"; payload: TaskInput } | {
    kind: "edit";
    payload: TaskPatch;
  } | { kind: "action"; payload: TaskAction });
export interface CaptureInput {
  title: string;
  prompt: string;
  repositoryId: string;
  providerProfileId?: string;
  source?: "typed" | "speech" | "share";
  autoResume?: boolean;
}
export interface MobileData {
  snapshot: ServerSnapshot;
  mutations: Mutation[];
  drafts: Task[];
  lastSync?: string;
  push?: PushRegistration;
  pushSynced?: string;
  pushKey?: string;
}
export const emptySnapshot = (): ServerSnapshot => ({
  devices: [],
  repositories: [],
  profiles: [],
  tasks: [],
  dependencies: [],
  executions: [],
  sessions: [],
});
export class MobileStore {
  readonly key: string;
  constructor(private storage: Storage, scope: string) {
    this.key = `pmai.mobile.${scope}`;
  }
  read(): MobileData {
    const value = this.storage.getItem(this.key);
    return value
      ? JSON.parse(value)
      : { snapshot: emptySnapshot(), mutations: [], drafts: [] };
  }
  write(value: MobileData) {
    this.storage.setItem(this.key, JSON.stringify(value));
  }
  clear() {
    this.storage.removeItem(this.key);
  }
}
