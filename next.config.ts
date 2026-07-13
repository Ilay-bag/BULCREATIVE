import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // native canvas binding must be required at runtime, not bundled by webpack
  serverExternalPackages: ["@napi-rs/canvas"],
  // Allow large creative uploads through server actions / route handlers
  experimental: {
    serverActions: { bodySizeLimit: "15mb" },
  },
};

export default nextConfig;
