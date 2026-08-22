import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This dashboard manages local processes; keep it server-only.
  reactStrictMode: true,
};

export default nextConfig;
