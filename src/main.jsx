import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register service worker for PWA installability and offline support.
// index.html is served network-first so new deployments are picked up
// immediately instead of staying on a stale cached shell.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // Only reload when an existing controller is replaced by a new version.
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        registration.update().catch(() => {});
      })
      .catch((error) => {
        console.log("Service Worker registration failed:", error);
      });
  });
}
