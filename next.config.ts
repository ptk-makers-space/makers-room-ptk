import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep undici a real Node require; webpack chokes on its node: imports.
  serverExternalPackages: ["undici"],
};

export default nextConfig;
