import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  transpilePackages: ["@life-os/ai", "@life-os/db"],
};

export default nextConfig;
