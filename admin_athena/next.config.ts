import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pg and its peers are pure Node modules — never let webpack bundle
  // them into the edge runtime (which has no `fs`).
  serverExternalPackages: ["pg", "pg-native", "pg-connection-string", "@prisma/adapter-pg"],
};

export default nextConfig;
