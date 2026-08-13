import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // tesseract.js loads its worker script via requires Next's file tracer can't
  // follow statically, so `output: "standalone"` silently drops files it needs
  // (bmp-js, etc). The Docker image installs a full node_modules instead of
  // relying on traced output — see Dockerfile.
  serverExternalPackages: ["tesseract.js", "fluent-ffmpeg", "msedge-tts", "bullmq", "ioredis", "web-push"],
  experimental: {
    // Next 16 renamed middlewareClientMaxBodySize to proxyClientMaxBodySize.
    // Keep this above the application-level 180 MiB aggregate file limit so
    // multipart boundaries and form fields are never truncated by proxy.ts.
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
