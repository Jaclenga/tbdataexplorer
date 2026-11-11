import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadAppData } from "./services/load-app-data";
import "./styles.css";

const root = document.getElementById("root")!;
// Static links remain usable while the application loads. Controls need React
// handlers, so prevent edits that would otherwise be lost at the handoff.
for (const control of root.querySelectorAll("input,select,button")) {
  control.setAttribute("disabled", "");
}
const controller = new AbortController();
loadAppData(import.meta.env.BASE_URL, controller.signal).then(
  (initialData) => createRoot(root).render(<StrictMode><App initialData={initialData} /></StrictMode>),
  (error: unknown) => createRoot(root).render(<StrictMode><App error={error instanceof Error ? error.message : String(error)} /></StrictMode>),
);
