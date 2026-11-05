import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@crewline/core"],
  devIndicators: false,
};

export default nextConfig;
