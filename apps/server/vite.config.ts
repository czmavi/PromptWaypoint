import { fresh } from "@fresh/plugin-vite";
import { defineConfig, type Plugin } from "vite";
import { closeRuntime } from "./src/runtime.ts";

function controlPlane(): Plugin {
  return {
    name: "pmai:control-plane",
    configureServer(vite) {
      vite.httpServer?.once("close", () => {
        void closeRuntime();
      });
    },
    async hotUpdate({ file, server }) {
      if (server.environments.ssr.moduleGraph.getModulesByFile(file)?.size) {
        await closeRuntime();
      }
    },
    async writeBundle() {
      // Runtime-relative SQL files must also exist beside the bundled server.
      const destination = new URL(
        "./_fresh/server/migrations/",
        import.meta.url,
      );
      await Deno.mkdir(destination, { recursive: true });
      for await (
        const file of Deno.readDir(
          new URL("./src/db/migrations/", import.meta.url),
        )
      ) {
        if (file.isFile && file.name.endsWith(".sql")) {
          await Deno.copyFile(
            new URL(`./src/db/migrations/${file.name}`, import.meta.url),
            new URL(file.name, destination),
          );
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [controlPlane(), fresh()],
  server: {
    host: Deno.env.get("PMAI_SERVER_HOST") ?? "127.0.0.1",
    port: Number(Deno.env.get("PORT") ?? 8000),
    strictPort: true,
  },
});
