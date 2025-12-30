import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Redirect old deep links to hash-based routes
const path = window.location.pathname;
if (path !== "/" && !window.location.hash) {
  window.location.replace("/#" + path);
}

createRoot(document.getElementById("root")!).render(<App />);
