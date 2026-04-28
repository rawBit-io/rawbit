import fs from "fs";
import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("./package.json", import.meta.url), "utf8")
);

const appVersion =
  process.env.RAWBIT_APP_VERSION ??
  process.env.GIT_COMMIT ??
  packageJson.version ??
  "dev";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      events: path.resolve(__dirname, "./node_modules/events/events.js"),
    },
  },
  optimizeDeps: {
    include: ["events"],
  },
  server: {
    port: 3041,
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
});
