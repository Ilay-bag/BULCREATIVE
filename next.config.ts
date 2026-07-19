import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // native canvas binding must be required at runtime, not bundled by webpack
  serverExternalPackages: ["@napi-rs/canvas"],
  // ensure the overlay engine's fonts and the skill prompts ship with the
  // serverless functions on Vercel (they are read from disk at runtime)
  outputFileTracingIncludes: {
    // overlay compositing needs the fonts
    "/api/image": ["./public/fonts/**"],
    // every model-driven route reads skill prompts from disk
    "/api/analyze": ["./skills/**"],
    "/api/plan": ["./skills/**"],
    "/api/design-new": ["./skills/**"],
    "/api/chat": ["./skills/**"],
    "/api/rewrite": ["./skills/**"],
    "/api/score": ["./skills/**"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "15mb" },
  },
};

export default nextConfig;
