import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle at .next/standalone/server.js
  // so the Electron main process can spawn it as a child Node.js process.
  output: "standalone",

  allowedDevOrigins: ["192.168.1.44"],
};

export default nextConfig;