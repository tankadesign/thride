import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "@/app/App";

// No StrictMode: its double-mount semantics race the async WebGPU renderer
// init/dispose on a shared canvas (and double-run dockview layout building).
createRoot(document.getElementById("root")!).render(<App />);
