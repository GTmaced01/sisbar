import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? "export" : undefined,
  images: {
    unoptimized: true,
    remotePatterns: [{ protocol: "https", hostname: "api.qrserver.com" }],
  },
};

export default nextConfig;
