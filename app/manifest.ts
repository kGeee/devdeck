import type { MetadataRoute } from "next";

/**
 * Served at /manifest.webmanifest.
 *
 * The point of installing DevDeck is the standalone window and a dock icon —
 * it drives local processes, so "offline" is never a useful state. The service
 * worker exists to make it installable and to fail gracefully when the server
 * behind it is not running, not to cache the app's data.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DevDeck — local project workspace",
    short_name: "DevDeck",
    description:
      "Run, review and ship every local project: dev servers, git, pull requests, agents and project design graphs in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0b",
    theme_color: "#0a0a0b",
    orientation: "any",
    categories: ["developer", "productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
