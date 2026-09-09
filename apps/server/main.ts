import { createRuntime } from "./src/runtime.ts";

// Fresh/Vite imports this entry; only the framework owns the HTTP listener.
const runtime = await createRuntime();
export const app = runtime.app;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void runtime.close();
  });
}
