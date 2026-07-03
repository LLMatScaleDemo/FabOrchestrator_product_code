import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // This app deploys as its own standalone zip (single lockfile). Pin the
  // tracing/workspace root to this dir so local monorepo checkouts don't infer
  // the parent folder as root (harmless warning) and match production layout.
  outputFileTracingRoot: path.join(__dirname),
  // pg and its peers are pure Node modules — never let webpack bundle
  // them into the edge runtime (which has no `fs`).
  serverExternalPackages: ["pg", "pg-native", "pg-connection-string", "@prisma/adapter-pg"],
};

export default nextConfig;
