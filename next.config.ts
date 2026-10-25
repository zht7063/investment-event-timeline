import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep build-time type checking via the TS 5 compiler API. The experimental
  // CLI checker can lose child-process stdout in constrained build runners.
  experimental: { useTypeScriptCli: false },
};

export default nextConfig;
