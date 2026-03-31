import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    minimumCacheTTL: 60,
  },
};

export default nextConfig;
