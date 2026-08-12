import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // tesseract.js loads its worker script via requires Next's file tracer can't
  // follow statically, so `output: "standalone"` silently drops files it needs
  // (bmp-js, etc). The Docker image installs a full node_modules instead of
  // relying on traced output — see Dockerfile.
  serverExternalPackages: ["tesseract.js", "fluent-ffmpeg", "msedge-tts"],
};

export default nextConfig;
