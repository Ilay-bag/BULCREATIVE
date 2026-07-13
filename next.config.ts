import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow large creative uploads through server actions / route handlers
  experimental: {
    serverActions: { bodySizeLimit: "15mb" },
  },
};

export default nextConfig;
