"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production only.
 *
 * A service worker in front of `next dev` caches build assets whose URLs are
 * not content-hashed the way production's are, which serves stale chunks after
 * an HMR update — a genuinely confusing failure. So dev does the opposite:
 * it actively unregisters any worker left behind by a production run, rather
 * than letting one poison the dev session.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => void r.unregister()))
        .catch(() => {});
      return;
    }

    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failing only costs installability; the app still works.
      });
    };

    // Wait for load so registration never competes with the first paint.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
