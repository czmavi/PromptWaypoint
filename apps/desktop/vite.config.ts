import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [preact(), tailwindcss()],
  resolve: { dedupe: ["preact"] },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    fs: { allow: ["../.."] },
    proxy: {
      "/__agent": {
        target: "http://127.0.0.1:7431",
        ws: true,
        rewrite: (path) => path.replace(/^\/__agent/, ""),
        configure: (proxy) => {
          proxy.on(
            "proxyReq",
            (request) => request.setHeader("Origin", "tauri://localhost"),
          );
          proxy.on(
            "proxyReqWs",
            (request) => request.setHeader("Origin", "tauri://localhost"),
          );
        },
      },
    },
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
