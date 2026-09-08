import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;
export default defineConfig({
  plugins: [preact(), tailwindcss()],
  resolve: { dedupe: ["preact"] },
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: 1431 } : undefined,
    fs: { allow: ["../.."] },
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
