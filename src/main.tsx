import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@xyflow/react/dist/style.css";
import "./index.css";
import { ThemeProvider } from "./components/layout/theme-provider";
import { patchResizeObserver } from "./lib/patchResizeObserver";
import { isSafariBrowser } from "./lib/device";

if (typeof window !== "undefined") {
  patchResizeObserver();
  window.__RAWBIT_VERSION__ = __APP_VERSION__;
  // Persistent engine flag (set once, before any render) so WebKit-only
  // drag-performance CSS is armed without a per-drag timing race.
  if (isSafariBrowser()) {
    document.body.dataset.engineWebkit = "true";
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="app-theme">
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
