import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Redirect old deep links to hash-based routes (only if not already on hash route)
const path = window.location.pathname;
if (path !== "/" && path !== "/index.html" && !window.location.hash) {
  window.location.replace("/#" + path);
} else {
  // Only render the app if we're not redirecting
  const rootElement = document.getElementById("root");
  if (rootElement) {
    try {
      createRoot(rootElement).render(<App />);
    } catch (error) {
      console.error("Failed to render app:", error);
      rootElement.innerHTML = `
        <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #1a1a2e; color: white; font-family: system-ui, sans-serif; padding: 20px; text-align: center;">
          <div>
            <h1 style="font-size: 24px; margin-bottom: 16px;">Failed to load application</h1>
            <p style="color: #888; margin-bottom: 16px;">Please try refreshing the page.</p>
            <button onclick="window.location.reload()" style="padding: 8px 16px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">
              Refresh
            </button>
          </div>
        </div>
      `;
    }
  } else {
    console.error("Root element not found");
  }
}
