import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // This app deploys as its own standalone zip (single lockfile). Pin the
  // tracing/workspace root to this dir so local monorepo checkouts don't infer
  // the parent folder as root (harmless warning) and match production layout.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
