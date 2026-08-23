import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This dashboard manages local processes; keep it server-only.
  reactStrictMode: true,

  // Without this, Next walks up looking for a lockfile and settles on the home
  // directory, because a stray ~/bun.lock sits there with no package.json next
  // to it. Output file tracing would then treat all of $HOME as the workspace.
  outputFileTracingRoot: path.resolve(process.cwd()),

  // A production build and `next dev` both write to .next by default, and a
  // build run while the dev server is up corrupts it for both — the build fails
  // collecting page data while dev regenerates underneath it. Pointing the
  // production build at its own directory lets the two coexist.
  distDir: process.env.DEVDECK_DIST_DIR || ".next",
};

export default nextConfig;
